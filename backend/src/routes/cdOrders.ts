import { Hono } from "hono";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { z } from "zod";
import { requireAuth } from "../auth.js";
import {
  addEvents,
  findPayments,
  inTransaction,
  latestEvent,
  lockOrder,
  refundPayment,
  startCheckout,
  type OrderEvent,
  type PaymentStatus,
} from "../cdOrderPayments.js";
import { db } from "../db.js";
import { toReturnBaseUrl } from "../origins.js";
import { cdPriceJpy, getStripe, paymentsUnavailable } from "../stripe.js";
import { validateJson } from "../validate.js";

/** 依頼した時点のトラックの中身 */
type TrackSnapshot = {
  musics: {
    position: number;
    musicId: number;
    name: string;
    url: string;
    edits: { startSecond: number; endSecond: number; tempo: number }[];
  }[];
};

// 支払いのあとに戻ってくるフロントの URL（オリジン + basePath）
const returnBaseUrlSchema = z.string().transform((value, ctx) => {
  const url = toReturnBaseUrl(value);
  if (!url) ctx.addIssue({ code: "custom", message: "戻り先の URL が正しくありません。" });
  return url ?? "";
});

const orderSchema = z.object({
  trackId: z.number().int().positive(),
  shippingAddressId: z.number().int().positive("送付先を選んでください。"),
  returnBaseUrl: returnBaseUrlSchema,
});

const checkoutSchema = z.object({ returnBaseUrl: returnBaseUrlSchema });

const cdOrders = new Hono<{ Variables: { userId: number } }>();

cdOrders.use("*", requireAuth);

/** トラックの中身（曲・順番・変更区間）をいまの状態で写し取る */
async function snapshotTrack(trackId: number): Promise<TrackSnapshot> {
  const [musics] = await db.execute<RowDataPacket[]>(
    `SELECT tm.id AS trackMusicId, m.id AS musicId, m.name, m.url
       FROM track_musics tm JOIN musics m ON m.id = tm.music_id
      WHERE tm.track_id = ?
      ORDER BY tm.position, tm.id`,
    [trackId],
  );
  const [edits] = await db.execute<RowDataPacket[]>(
    `SELECT e.track_music_id, e.start_second, e.end_second, e.tempo
       FROM edit_musics e JOIN track_musics tm ON tm.id = e.track_music_id
      WHERE tm.track_id = ?
      ORDER BY e.start_second`,
    [trackId],
  );
  return {
    musics: musics.map((m, i) => ({
      position: i + 1,
      musicId: m.musicId,
      name: m.name,
      url: m.url,
      edits: edits
        .filter((e) => e.track_music_id === m.trackMusicId)
        .map((e) => ({ startSecond: e.start_second, endSecond: e.end_second, tempo: e.tempo })),
    })),
  };
}

// 一番新しいイベントを「いまの状態」として一緒に返す
const LATEST_EVENT = `(SELECT ev.event FROM cd_order_events ev WHERE ev.cd_order_id = o.id ORDER BY ev.created_at DESC, ev.id DESC LIMIT 1)`;
// 一番新しい支払いの状態（有料化する前の依頼は支払いがないので NULL）
const LATEST_PAYMENT = `(SELECT p.status FROM cd_order_payments p WHERE p.cd_order_id = o.id ORDER BY p.id DESC LIMIT 1)`;
const ORDER_COLUMNS = `${LATEST_EVENT} AS status, ${LATEST_PAYMENT} AS payment_status`;

/** 画面に出す支払いの状態。Stripe 側の pending（支払い画面を開いている）は「未払い」として返す */
const PAYMENT_STATUS: Record<PaymentStatus, "unpaid" | "paid" | "expired" | "refunded"> = {
  pending: "unpaid",
  paid: "paid",
  expired: "expired",
  refunded: "refunded",
};

function toOrder(r: RowDataPacket) {
  return {
    id: r.id as number,
    trackId: r.track_id as number | null,
    trackName: r.track_name as string,
    status: r.status as OrderEvent,
    createdAt: r.created_at as string,
    musicCount: ((typeof r.track_snapshot === "string" ? JSON.parse(r.track_snapshot) : r.track_snapshot) as TrackSnapshot)
      .musics.length,
    /** 依頼した時点の金額（税込・送料込）。有料化する前の依頼は 0 */
    price: { amount: r.price_amount as number, currency: r.currency as string },
    paymentStatus: r.payment_status ? PAYMENT_STATUS[r.payment_status as PaymentStatus] : null,
  };
}

const notFound = { error: "CD の依頼が見つかりません。" };

// 自分の依頼の一覧（新しい順）
cdOrders.get("/", async (c) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT o.id, o.track_id, o.track_name, o.track_snapshot, o.price_amount, o.currency, o.created_at, ${ORDER_COLUMNS}
       FROM cd_orders o WHERE o.user_id = ? ORDER BY o.id DESC`,
    [c.var.userId],
  );
  return c.json({ orders: rows.map(toOrder) });
});

async function findOwnOrder(orderId: number, userId: number) {
  if (!Number.isInteger(orderId) || orderId <= 0) return null;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT o.*, ${ORDER_COLUMNS} FROM cd_orders o WHERE o.id = ? AND o.user_id = ?`,
    [orderId, userId],
  );
  const r = rows[0];
  if (!r) return null;
  const [events] = await db.execute<RowDataPacket[]>(
    "SELECT event, note, created_at FROM cd_order_events WHERE cd_order_id = ? ORDER BY created_at, id",
    [orderId],
  );
  return {
    ...toOrder(r),
    track: (typeof r.track_snapshot === "string" ? JSON.parse(r.track_snapshot) : r.track_snapshot) as TrackSnapshot,
    shippingAddress: {
      recipientName: r.recipient_name as string,
      postalCode: r.postal_code as string,
      prefecture: r.prefecture as string,
      city: r.city as string,
      addressLine1: r.address_line1 as string,
      addressLine2: r.address_line2 as string | null,
    },
    events: events.map((e) => ({ event: e.event as OrderEvent, note: e.note as string | null, createdAt: e.created_at })),
  };
}

// CD 1 枚の料金と、いま支払いを受け付けられるか（確認画面に出す）
cdOrders.get("/price", (c) =>
  c.json({ price: { amount: cdPriceJpy(), currency: "jpy" }, paymentsEnabled: getStripe() !== null }),
);

// 依頼の詳細（依頼した時点の中身と送付先、状態の履歴）
cdOrders.get("/:id", async (c) => {
  const order = await findOwnOrder(Number(c.req.param("id")), c.var.userId);
  if (!order) return c.json(notFound, 404);
  return c.json({ order });
});


const checkoutFailed = { error: "支払いの画面を用意できませんでした。時間をおいてもう一度お試しください。" };

// CD の作成を依頼する。トラックの中身・送付先・いまの料金を写して「支払い待ち」で保存し、
// Stripe Checkout の支払い画面の URL を返す（支払いが済むと Webhook で「依頼済み」になる）
cdOrders.post("/", validateJson(orderSchema), async (c) => {
  const { trackId, shippingAddressId, returnBaseUrl } = c.req.valid("json");
  const userId = c.var.userId;

  const stripe = getStripe();
  if (!stripe) return c.json(paymentsUnavailable, 503);

  const [tracks] = await db.execute<RowDataPacket[]>("SELECT id, name FROM tracks WHERE id = ? AND user_id = ?", [
    trackId,
    userId,
  ]);
  const track = tracks[0];
  if (!track) return c.json({ error: "トラックが見つかりません。" }, 404);

  const [addresses] = await db.execute<RowDataPacket[]>(
    "SELECT * FROM shipping_addresses WHERE id = ? AND user_id = ?",
    [shippingAddressId, userId],
  );
  const address = addresses[0];
  if (!address) return c.json({ error: "送付先が見つかりません。" }, 404);

  const snapshot = await snapshotTrack(track.id);
  if (snapshot.musics.length === 0) {
    return c.json({ error: "曲が入っていないトラックは依頼できません。" }, 400);
  }

  const amount = cdPriceJpy();
  let created: { orderId: number; checkoutUrl: string };
  try {
    // 支払い画面を用意できなかったときは、依頼ごと保存しない
    created = await inTransaction(async (conn) => {
      const [result] = await conn.execute<ResultSetHeader>(
        `INSERT INTO cd_orders
           (user_id, track_id, track_name, track_snapshot,
            recipient_name, postal_code, prefecture, city, address_line1, address_line2, price_amount, currency)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'jpy')`,
        [
          userId,
          track.id,
          track.name,
          JSON.stringify(snapshot),
          address.recipient_name,
          address.postal_code,
          address.prefecture,
          address.city,
          address.address_line1,
          address.address_line2,
          amount,
        ],
      );
      const orderId = result.insertId;
      await addEvents(conn, orderId, ["awaiting_payment"]);
      const checkoutUrl = await startCheckout(
        conn,
        stripe,
        { id: orderId, trackName: track.name, amount, currency: "jpy" },
        returnBaseUrl,
      );
      return { orderId, checkoutUrl };
    });
  } catch (err) {
    console.error(err);
    return c.json(checkoutFailed, 502);
  }
  return c.json({ order: await findOwnOrder(created.orderId, userId), checkoutUrl: created.checkoutUrl }, 201);
});

// 支払い待ちの依頼の支払いを再開する。開いたままの支払い画面があればその URL、期限が切れていれば新しく作る
cdOrders.post("/:id/checkout", validateJson(checkoutSchema), async (c) => {
  const userId = c.var.userId;
  const order = await findOwnOrder(Number(c.req.param("id")), userId);
  if (!order) return c.json(notFound, 404);
  if (order.status !== "awaiting_payment") return c.json({ error: "この依頼は支払いを待っていません。" }, 409);
  const stripe = getStripe();
  if (!stripe) return c.json(paymentsUnavailable, 503);

  try {
    const result = await inTransaction(async (conn) => {
      await lockOrder(conn, order.id);
      if ((await latestEvent(conn, order.id)) !== "awaiting_payment") return { conflict: true } as const;
      for (const payment of await findPayments(conn, order.id, "pending")) {
        const session = await stripe.checkout.sessions.retrieve(payment.stripe_checkout_session_id);
        if (session.status === "open" && session.url) return { checkoutUrl: session.url };
        if (session.status === "complete") return { completing: true } as const;
        // 期限切れの通知がまだ来ていないもの。ここで期限切れにしておき、あとで通知が来ても取り消しにはしない
        await conn.execute("UPDATE cd_order_payments SET status = 'expired' WHERE id = ?", [payment.id]);
      }
      const checkoutUrl = await startCheckout(
        conn,
        stripe,
        { id: order.id, trackName: order.trackName, amount: order.price.amount, currency: order.price.currency },
        c.req.valid("json").returnBaseUrl,
      );
      return { checkoutUrl };
    });
    if ("conflict" in result) return c.json({ error: "この依頼は支払いを待っていません。" }, 409);
    if ("completing" in result) {
      return c.json({ error: "支払いは済んでいます。反映されるまで少しお待ちください。" }, 409);
    }
    return c.json({ checkoutUrl: result.checkoutUrl });
  } catch (err) {
    console.error(err);
    return c.json(checkoutFailed, 502);
  }
});

// 依頼を取り消す。支払い待ちなら支払い画面を閉じて取り消し、支払い済みで受付前（依頼済み）なら全額返金して取り消す
cdOrders.post("/:id/cancel", async (c) => {
  const userId = c.var.userId;
  const order = await findOwnOrder(Number(c.req.param("id")), userId);
  if (!order) return c.json(notFound, 404);
  if (order.status === "cancelled" || order.status === "refunded") {
    return c.json({ error: "この依頼はすでに取り消されています。" }, 409);
  }
  if (order.status !== "requested" && order.status !== "awaiting_payment") {
    return c.json({ error: "受け付けたあとの依頼は、この画面からは取り消せません。" }, 409);
  }
  const stripe = getStripe();

  let outcome: "ok" | "conflict" | "completing";
  try {
    outcome = await inTransaction(async (conn) => {
      await lockOrder(conn, order.id);
      const latest = await latestEvent(conn, order.id);

      if (latest === "awaiting_payment") {
        // 開いている支払い画面を Stripe 側で閉じてから取り消す（閉じたあとは支払えない）
        for (const payment of await findPayments(conn, order.id, "pending")) {
          if (!stripe) throw new Error("STRIPE_SECRET_KEY がないため、支払い画面を閉じられません。");
          const session = await stripe.checkout.sessions.retrieve(payment.stripe_checkout_session_id);
          if (session.status === "complete") return "completing";
          if (session.status === "open") await stripe.checkout.sessions.expire(session.id);
          await conn.execute("UPDATE cd_order_payments SET status = 'expired' WHERE id = ?", [payment.id]);
        }
        await addEvents(conn, order.id, ["cancelled"]);
        return "ok";
      }

      if (latest === "requested") {
        const [paid] = await findPayments(conn, order.id, "paid");
        if (!paid) {
          // 有料化する前の依頼（支払いなし）
          await addEvents(conn, order.id, ["cancelled"]);
          return "ok";
        }
        if (!stripe) throw new Error("STRIPE_SECRET_KEY がないため返金できません。");
        await refundPayment(conn, stripe, paid);
        await addEvents(conn, order.id, ["cancelled"]);
        await addEvents(conn, order.id, ["refunded"], `${paid.amount.toLocaleString("ja-JP")} 円を返金しました`);
        return "ok";
      }
      return "conflict";
    });
  } catch (err) {
    console.error(err);
    return c.json({ error: "取り消しの手続きができませんでした。時間をおいてもう一度お試しください。" }, 502);
  }
  if (outcome === "completing") {
    return c.json({ error: "支払いの手続きが済んだところです。反映されてから、もう一度取り消してください。" }, 409);
  }
  if (outcome === "conflict") return c.json({ error: "この依頼の状態が変わったため、取り消せませんでした。" }, 409);
  return c.json({ order: await findOwnOrder(order.id, userId) });
});

export default cdOrders;
