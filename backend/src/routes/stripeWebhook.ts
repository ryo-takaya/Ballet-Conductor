import { Hono } from "hono";
import type Stripe from "stripe";
import { handleCheckoutExpired, handleCheckoutPaid } from "../cdOrderPayments.js";
import { constructWebhookEvent } from "../stripe.js";

// Stripe からの通知（Webhook）。支払い済みにするのはここだけで、支払い後に戻ってくる画面では記録しない
const stripeWebhook = new Hono();

stripeWebhook.post("/", async (c) => {
  if (!process.env.STRIPE_WEBHOOK_SECRET?.trim()) {
    console.error("[stripe] STRIPE_WEBHOOK_SECRET が設定されていないため、Webhook を受け付けられません。");
    return c.json({ error: "Webhook の設定がされていません。" }, 503);
  }
  // 署名は受け取ったままの本文で確かめる（JSON として読み直すと検証できない）
  const rawBody = await c.req.text();
  let event: Stripe.Event;
  try {
    event = await constructWebhookEvent(rawBody, c.req.header("stripe-signature") ?? "");
  } catch {
    return c.json({ error: "署名を確認できませんでした。" }, 400);
  }

  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const session = event.data.object;
      // カード払いは completed の時点で paid。後払い系は async_payment_succeeded を待つ
      if (session.payment_status === "paid") {
        const paymentIntent = session.payment_intent;
        await handleCheckoutPaid(session.id, typeof paymentIntent === "string" ? paymentIntent : (paymentIntent?.id ?? null));
      }
      break;
    }
    case "checkout.session.expired":
      await handleCheckoutExpired(event.data.object.id);
      break;
  }
  return c.json({ received: true });
});

export default stripeWebhook;
