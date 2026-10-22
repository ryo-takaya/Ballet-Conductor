import Stripe from "stripe";

// Stripe での支払い。キーはローカルでは .env から compose.yaml 経由、本番では Workers の Secrets から受け取る。
// キーがない環境でも API 自体は起動し、支払いが必要な操作だけがエラーになる。

/** Stripe の呼び出しのうち、このアプリで使うものだけ（テストではこれを差し替える） */
export type StripeClient = {
  checkout: {
    sessions: {
      create: Stripe["checkout"]["sessions"]["create"];
      retrieve: Stripe["checkout"]["sessions"]["retrieve"];
      expire: Stripe["checkout"]["sessions"]["expire"];
    };
  };
  refunds: { create: Stripe["refunds"]["create"] };
};

let client: StripeClient | null | undefined;

/** Stripe のクライアント。STRIPE_SECRET_KEY がなければ null */
export function getStripe(): StripeClient | null {
  if (client === undefined) {
    const key = process.env.STRIPE_SECRET_KEY?.trim();
    client = key ? new Stripe(key) : null;
  }
  return client;
}

/** テスト用に Stripe のクライアントを差し替える（undefined で環境変数から作り直す） */
export function setStripeForTest(next: StripeClient | null | undefined) {
  client = next;
}

/** Webhook の署名を確かめてイベントを取り出す。秘密鍵がない・署名が合わないときは例外 */
export async function constructWebhookEvent(rawBody: string, signature: string): Promise<Stripe.Event> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET が設定されていません。");
  // 署名の確認だけなら API キーは要らないので、ここでは鍵なしのインスタンスを使う。
  // Workers では同期版（constructEvent）が使えないので、非同期版を使う
  return Stripe.webhooks.constructEventAsync(rawBody, signature, secret);
}

/** CD 1 枚の料金（税込・送料込、円）。CD_PRICE_JPY で変えられる */
export function cdPriceJpy(): number {
  const value = Number(process.env.CD_PRICE_JPY ?? 3000);
  // Stripe の円の最低金額は 50 円
  return Number.isInteger(value) && value >= 50 ? value : 3000;
}

export const paymentsUnavailable = {
  error: "いまは支払いを受け付けられません（決済の設定がされていません）。時間をおいてもう一度お試しください。",
};
