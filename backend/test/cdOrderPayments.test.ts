// CD の依頼の支払い（Stripe）の確認。Stripe の API はモックに差し替え、Webhook は本物と同じ形式の署名をつけて送る。
// 開発用の DB（docker compose の db）に、テスト用の利用者を作って確かめ、最後に消す。
// 実行: docker compose exec backend npm test
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import Stripe from "stripe";
import app from "../src/app.js";
import { createToken } from "../src/auth.js";
import { db } from "../src/db.js";
import { setStripeForTest, type StripeClient } from "../src/stripe.js";

const WEBHOOK_SECRET = "whsec_test_dummy_for_unit_tests";
process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
const RETURN_BASE_URL = "http://localhost:3100";

type FakeSession = { id: string; url: string; status: "open" | "complete" | "expired"; params: unknown };

/** Stripe のモック。作った Checkout セッションと、返金・期限切れの呼び出しを記録する */
function createFakeStripe() {
  const sessions = new Map<string, FakeSession>();
  const refunds: { params: unknown; idempotencyKey?: string }[] = [];
  const expired: string[] = [];
  let seq = 0;
  const client = {
    checkout: {
      sessions: {
        create: async (params: unknown) => {
          const id = `cs_test_${++seq}_${Date.now()}`;
          const session: FakeSession = { id, url: `https://checkout.stripe.com/c/pay/${id}`, status: "open", params };
          sessions.set(id, session);
          return session;
        },
        retrieve: async (id: string) => sessions.get(id)!,
        expire: async (id: string) => {
          expired.push(id);
          sessions.get(id)!.status = "expired";
          return sessions.get(id)!;
        },
      },
    },
    refunds: {
      create: async (params: unknown, options?: { idempotencyKey?: string }) => {
        refunds.push({ params, idempotencyKey: options?.idempotencyKey });
        return { id: `re_test_${refunds.length}` };
      },
    },
  };
  return { client: client as unknown as StripeClient, sessions, refunds, expired };
}

let fake = createFakeStripe();
let userId: number;
let musicId: number;
let trackId: number;
let addressId: number;
let token: string;

function api(path: string, init: { method?: string; body?: unknown } = {}) {
  return app.request(`/api${path}`, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

/** Stripe と同じ形式で署名した Webhook を送る */
function sendWebhook(type: string, object: Record<string, unknown>, eventId = `evt_${Math.random()}`) {
  const payload = JSON.stringify({ id: eventId, object: "event", type, data: { object } });
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  return app.request("/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": signature, "Content-Type": "application/json" },
    body: payload,
  });
}

async function createOrder() {
  const res = await api("/cd-orders", {
    method: "POST",
    body: { trackId, shippingAddressId: addressId, returnBaseUrl: RETURN_BASE_URL },
  });
  assert.equal(res.status, 201, await res.clone().text());
  const body = (await res.json()) as { order: { id: number; status: string }; checkoutUrl: string };
  const [payments] = await db.execute<RowDataPacket[]>(
    "SELECT * FROM cd_order_payments WHERE cd_order_id = ? ORDER BY id DESC",
    [body.order.id],
  );
  return { ...body, sessionId: payments[0]!.stripe_checkout_session_id as string };
}

async function getOrder(id: number) {
  const res = await api(`/cd-orders/${id}`);
  assert.equal(res.status, 200);
  return ((await res.json()) as { order: any }).order as {
    status: string;
    paymentStatus: string | null;
    price: { amount: number; currency: string };
    events: { event: string; note: string | null }[];
  };
}

const eventsOf = async (id: number) => (await getOrder(id)).events.map((e) => e.event);

before(async () => {
  const [u] = await db.execute<ResultSetHeader>("INSERT INTO users (name) VALUES ('支払いテスト')");
  userId = u.insertId;
  const [m] = await db.execute<ResultSetHeader>("INSERT INTO musics (name, url) VALUES ('支払いテストの曲', '')");
  musicId = m.insertId;
  const [t] = await db.execute<ResultSetHeader>("INSERT INTO tracks (user_id, name) VALUES (?, '発表会')", [userId]);
  trackId = t.insertId;
  await db.execute("INSERT INTO track_musics (track_id, music_id, position) VALUES (?, ?, 1)", [trackId, musicId]);
  const [a] = await db.execute<ResultSetHeader>(
    `INSERT INTO shipping_addresses (user_id, recipient_name, postal_code, prefecture, city, address_line1, is_default)
     VALUES (?, 'テスト 花子', '100-0001', '東京都', '千代田区', '千代田1-1', TRUE)`,
    [userId],
  );
  addressId = a.insertId;
  token = await createToken(userId);
});

beforeEach(() => {
  fake = createFakeStripe();
  setStripeForTest(fake.client);
});

after(async () => {
  setStripeForTest(undefined);
  await db.execute("DELETE FROM users WHERE id = ?", [userId]);
  await db.execute("DELETE FROM musics WHERE id = ?", [musicId]);
  await db.end();
});

describe("料金と支払いの開始", () => {
  test("料金を返す（既定 3000 円）", async () => {
    const res = await api("/cd-orders/price");
    assert.deepEqual(await res.json(), { price: { amount: 3000, currency: "jpy" }, paymentsEnabled: true });
  });

  test("Stripe のキーがないときは 503 で、依頼は作らない", async () => {
    setStripeForTest(null);
    const [before] = await db.execute<RowDataPacket[]>("SELECT COUNT(*) AS n FROM cd_orders WHERE user_id = ?", [userId]);
    const res = await api("/cd-orders", {
      method: "POST",
      body: { trackId, shippingAddressId: addressId, returnBaseUrl: RETURN_BASE_URL },
    });
    assert.equal(res.status, 503);
    const [afterRows] = await db.execute<RowDataPacket[]>("SELECT COUNT(*) AS n FROM cd_orders WHERE user_id = ?", [
      userId,
    ]);
    assert.equal(afterRows[0]!.n, before[0]!.n);
    // 一覧などほかの機能は動く
    assert.equal((await api("/cd-orders")).status, 200);
  });

  test("許可していない戻り先は受け付けない", async () => {
    const res = await api("/cd-orders", {
      method: "POST",
      body: { trackId, shippingAddressId: addressId, returnBaseUrl: "https://evil.example.com" },
    });
    assert.equal(res.status, 400);
  });

  test("Stripe でエラーになったら、依頼ごと保存しない", async () => {
    fake.client.checkout.sessions.create = (async () => {
      throw new Error("Stripe is down");
    }) as never;
    const [before] = await db.execute<RowDataPacket[]>("SELECT COUNT(*) AS n FROM cd_orders WHERE user_id = ?", [userId]);
    const res = await api("/cd-orders", {
      method: "POST",
      body: { trackId, shippingAddressId: addressId, returnBaseUrl: RETURN_BASE_URL },
    });
    assert.equal(res.status, 502);
    const [afterRows] = await db.execute<RowDataPacket[]>("SELECT COUNT(*) AS n FROM cd_orders WHERE user_id = ?", [
      userId,
    ]);
    assert.equal(afterRows[0]!.n, before[0]!.n);
  });
});

describe("支払い → 依頼済み → 取り消し → 返金", () => {
  test("一連の流れ", async () => {
    const { order, checkoutUrl, sessionId } = await createOrder();
    assert.equal(order.status, "awaiting_payment");
    assert.equal(checkoutUrl, fake.sessions.get(sessionId)!.url);
    const params = fake.sessions.get(sessionId)!.params as any;
    assert.equal(params.line_items[0].price_data.unit_amount, 3000);
    assert.equal(params.success_url, `${RETURN_BASE_URL}/orders/detail/?id=${order.id}&checkout=success`);

    let detail = await getOrder(order.id);
    assert.deepEqual(detail.price, { amount: 3000, currency: "jpy" });
    assert.equal(detail.paymentStatus, "unpaid");

    // 署名が合わない通知は受け付けない
    const forged = await app.request("/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "t=1,v1=deadbeef" },
      body: JSON.stringify({ type: "checkout.session.completed" }),
    });
    assert.equal(forged.status, 400);
    assert.equal(detail.status, "awaiting_payment");

    // 同じ通知が 2 回来ても 1 回だけ記録する
    const session = { id: sessionId, object: "checkout.session", payment_status: "paid", payment_intent: "pi_test_1" };
    assert.equal((await sendWebhook("checkout.session.completed", session, "evt_same")).status, 200);
    assert.equal((await sendWebhook("checkout.session.completed", session, "evt_same")).status, 200);
    detail = await getOrder(order.id);
    assert.equal(detail.status, "requested");
    assert.equal(detail.paymentStatus, "paid");
    assert.deepEqual(await eventsOf(order.id), ["awaiting_payment", "paid", "requested"]);

    // 取り消すと全額返金する
    const res = await api(`/cd-orders/${order.id}/cancel`, { method: "POST" });
    assert.equal(res.status, 200);
    assert.equal(fake.refunds.length, 1);
    assert.deepEqual(fake.refunds[0]!.params, { payment_intent: "pi_test_1" });
    assert.ok(fake.refunds[0]!.idempotencyKey);
    detail = await getOrder(order.id);
    assert.equal(detail.status, "refunded");
    assert.equal(detail.paymentStatus, "refunded");
    assert.deepEqual(await eventsOf(order.id), ["awaiting_payment", "paid", "requested", "cancelled", "refunded"]);

    // 2 回目の取り消しはできず、返金も増えない
    assert.equal((await api(`/cd-orders/${order.id}/cancel`, { method: "POST" })).status, 409);
    assert.equal(fake.refunds.length, 1);
  });

  test("受け付けたあとは取り消せない", async () => {
    const { order, sessionId } = await createOrder();
    await sendWebhook("checkout.session.completed", { id: sessionId, payment_status: "paid", payment_intent: "pi_x" });
    await db.execute("INSERT INTO cd_order_events (cd_order_id, event) VALUES (?, 'accepted')", [order.id]);
    assert.equal((await api(`/cd-orders/${order.id}/cancel`, { method: "POST" })).status, 409);
    assert.equal(fake.refunds.length, 0);
  });
});

describe("未払いのとき", () => {
  test("期限切れの通知で取り消しになる（2 回来ても 1 回だけ）", async () => {
    const { order, sessionId } = await createOrder();
    await sendWebhook("checkout.session.expired", { id: sessionId, status: "expired" });
    await sendWebhook("checkout.session.expired", { id: sessionId, status: "expired" });
    const detail = await getOrder(order.id);
    assert.equal(detail.status, "cancelled");
    assert.equal(detail.paymentStatus, "expired");
    assert.deepEqual(await eventsOf(order.id), ["awaiting_payment", "cancelled"]);
  });

  test("支払いに進むで、開いたままの支払い画面に戻れる。期限が切れていれば新しく作る", async () => {
    const { order, checkoutUrl, sessionId } = await createOrder();
    let res = await api(`/cd-orders/${order.id}/checkout`, { method: "POST", body: { returnBaseUrl: RETURN_BASE_URL } });
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { checkoutUrl: string }).checkoutUrl, checkoutUrl);

    // Stripe 側では期限切れになったが、通知がまだ来ていない
    fake.sessions.get(sessionId)!.status = "expired";
    res = await api(`/cd-orders/${order.id}/checkout`, { method: "POST", body: { returnBaseUrl: RETURN_BASE_URL } });
    const newUrl = ((await res.json()) as { checkoutUrl: string }).checkoutUrl;
    assert.notEqual(newUrl, checkoutUrl);

    // あとから古いセッションの期限切れの通知が来ても、新しい支払い画面があるので取り消しにはしない
    await sendWebhook("checkout.session.expired", { id: sessionId });
    assert.equal((await getOrder(order.id)).status, "awaiting_payment");
  });

  test("取り消すと支払い画面を閉じる。そのあとに支払いが来たら返金する", async () => {
    const { order, sessionId } = await createOrder();
    assert.equal((await api(`/cd-orders/${order.id}/cancel`, { method: "POST" })).status, 200);
    assert.deepEqual(fake.expired, [sessionId]);
    assert.equal((await getOrder(order.id)).status, "cancelled");
    assert.equal(fake.refunds.length, 0);

    // 行き違いで支払いが完了していた場合
    const session = { id: sessionId, payment_status: "paid", payment_intent: "pi_late" };
    await sendWebhook("checkout.session.completed", session);
    await sendWebhook("checkout.session.completed", session);
    assert.equal(fake.refunds.length, 1);
    assert.deepEqual(await eventsOf(order.id), ["awaiting_payment", "cancelled", "paid", "refunded"]);
  });
});
