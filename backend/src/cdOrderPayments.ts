import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { db } from "./db.js";
import { getStripe, type StripeClient } from "./stripe.js";

// CD の依頼の支払い（Stripe Checkout）まわり。依頼の画面の API と Webhook の両方から使う。
// 状態の流れ: awaiting_payment →（支払い）paid → requested → …、未払いのまま期限切れなら cancelled、
// 支払い後に取り消すと cancelled → refunded

export const ORDER_EVENTS = [
  "awaiting_payment",
  "paid",
  "requested",
  "accepted",
  "in_production",
  "shipped",
  "cancelled",
  "refunded",
] as const;
export type OrderEvent = (typeof ORDER_EVENTS)[number];

export type PaymentStatus = "pending" | "paid" | "expired" | "refunded";

type PaymentRow = RowDataPacket & {
  id: number;
  cd_order_id: number;
  amount: number;
  currency: string;
  stripe_checkout_session_id: string;
  stripe_payment_intent_id: string | null;
  status: PaymentStatus;
};

export async function latestEvent(conn: PoolConnection, orderId: number): Promise<OrderEvent | null> {
  const [rows] = await conn.execute<RowDataPacket[]>(
    "SELECT event FROM cd_order_events WHERE cd_order_id = ? ORDER BY created_at DESC, id DESC LIMIT 1",
    [orderId],
  );
  return (rows[0]?.event as OrderEvent | undefined) ?? null;
}

export async function addEvents(conn: PoolConnection, orderId: number, events: OrderEvent[], note: string | null = null) {
  for (const event of events) {
    await conn.execute("INSERT INTO cd_order_events (cd_order_id, event, note) VALUES (?, ?, ?)", [orderId, event, note]);
  }
}

/** トランザクションの中で処理する（途中で失敗したらすべて元に戻す） */
export async function inTransaction<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/** 依頼の行をロックする。同じ依頼への支払いの通知と取り消しが同時に来ても、順番に処理されるようにする */
export async function lockOrder(conn: PoolConnection, orderId: number) {
  await conn.execute("SELECT id FROM cd_orders WHERE id = ? FOR UPDATE", [orderId]);
}

type CheckoutOrder = { id: number; trackName: string; amount: number; currency: string };

/** Stripe Checkout のセッションを作り、支払いの行（pending）を足す。戻り値は支払い画面の URL */
export async function startCheckout(
  conn: PoolConnection,
  stripe: StripeClient,
  order: CheckoutOrder,
  returnBaseUrl: string,
): Promise<string> {
  const back = `${returnBaseUrl}/orders/detail/?id=${order.id}`;
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    locale: "ja",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: order.currency,
          unit_amount: order.amount,
          product_data: { name: `CD「${order.trackName}」`, description: "税込・送料込" },
        },
      },
    ],
    client_reference_id: String(order.id),
    metadata: { cdOrderId: String(order.id) },
    payment_intent_data: { metadata: { cdOrderId: String(order.id) } },
    success_url: `${back}&checkout=success`,
    cancel_url: `${back}&checkout=cancel`,
  });
  if (!session.url) throw new Error("Stripe Checkout の URL を受け取れませんでした。");
  await conn.execute<ResultSetHeader>(
    `INSERT INTO cd_order_payments (cd_order_id, amount, currency, stripe_checkout_session_id, status)
     VALUES (?, ?, ?, ?, 'pending')`,
    [order.id, order.amount, order.currency, session.id],
  );
  return session.url;
}

/**
 * Checkout セッションの支払いの行を、依頼の行をロックしてから読み直して返す。
 * ロックの順番（依頼 → 支払い）を取り消しの処理とそろえて、デッドロックを避ける
 */
async function lockPaymentBySession(conn: PoolConnection, sessionId: string) {
  const sql = "SELECT * FROM cd_order_payments WHERE stripe_checkout_session_id = ?";
  const [found] = await conn.execute<PaymentRow[]>(sql, [sessionId]);
  if (!found[0]) return null;
  await lockOrder(conn, found[0].cd_order_id);
  const [rows] = await conn.execute<PaymentRow[]>(`${sql} FOR UPDATE`, [sessionId]);
  return rows[0] ?? null;
}

export async function findPayments(conn: PoolConnection, orderId: number, status: PaymentStatus) {
  const [rows] = await conn.execute<PaymentRow[]>(
    "SELECT * FROM cd_order_payments WHERE cd_order_id = ? AND status = ? ORDER BY id DESC",
    [orderId, status],
  );
  return rows;
}

/** 支払い済みの代金を Stripe で全額返金し、支払いの行を refunded にする */
export async function refundPayment(conn: PoolConnection, stripe: StripeClient, payment: PaymentRow) {
  if (!payment.stripe_payment_intent_id) throw new Error(`支払い ${payment.id} の PaymentIntent がありません。`);
  // 同じ支払いを二重に返金しないよう、冪等キーをつける（再実行しても Stripe 側で 1 回になる）
  const refund = await stripe.refunds.create(
    { payment_intent: payment.stripe_payment_intent_id },
    { idempotencyKey: `cd-order-payment-${payment.id}-refund` },
  );
  await conn.execute("UPDATE cd_order_payments SET status = 'refunded', stripe_refund_id = ? WHERE id = ?", [
    refund.id,
    payment.id,
  ]);
}

/**
 * 支払いが完了した（checkout.session.completed）。同じ通知が何度来ても 1 回だけ記録する。
 * 支払いを待っている依頼なら paid → requested にする。取り消したあとに支払われた場合は返金する
 */
export async function handleCheckoutPaid(sessionId: string, paymentIntentId: string | null) {
  await inTransaction(async (conn) => {
    const payment = await lockPaymentBySession(conn, sessionId);
    if (!payment) {
      console.warn(`[stripe] 知らない Checkout セッションの支払い通知です: ${sessionId}`);
      return;
    }

    if (payment.status === "pending" || payment.status === "expired") {
      await conn.execute(
        "UPDATE cd_order_payments SET status = 'paid', stripe_payment_intent_id = ? WHERE id = ?",
        [paymentIntentId, payment.id],
      );
      payment.status = "paid";
      payment.stripe_payment_intent_id = paymentIntentId;
      const latest = await latestEvent(conn, payment.cd_order_id);
      await addEvents(conn, payment.cd_order_id, latest === "awaiting_payment" ? ["paid", "requested"] : ["paid"]);
    }

    // 取り消し済みの依頼に支払いが来たとき（最新が paid のまま）は返金する。返金に失敗したら例外にして、Stripe に通知を再送させる
    if (payment.status === "paid" && (await latestEvent(conn, payment.cd_order_id)) === "paid") {
      const stripe = getStripe();
      if (!stripe) throw new Error("STRIPE_SECRET_KEY がないため返金できません。");
      await refundPayment(conn, stripe, payment);
      await addEvents(conn, payment.cd_order_id, ["refunded"], "取り消したあとに支払いがあったため返金しました");
    }
  });
}

/** 支払いの期限が切れた（checkout.session.expired）。ほかに支払い中のものがなければ、依頼を取り消しにする */
export async function handleCheckoutExpired(sessionId: string) {
  await inTransaction(async (conn) => {
    const payment = await lockPaymentBySession(conn, sessionId);
    if (!payment || payment.status !== "pending") return;

    await conn.execute("UPDATE cd_order_payments SET status = 'expired' WHERE id = ?", [payment.id]);
    const stillPending = await findPayments(conn, payment.cd_order_id, "pending");
    if (stillPending.length === 0 && (await latestEvent(conn, payment.cd_order_id)) === "awaiting_payment") {
      await addEvents(conn, payment.cd_order_id, ["cancelled"], "支払いの期限が切れました");
    }
  });
}
