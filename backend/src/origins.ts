import { getContext } from "hono/context-storage";

/**
 * 呼び出しを許可するフロントの URL（ローカルの開発サーバーなど）。compose.yaml や wrangler.jsonc の CORS_ORIGINS で設定する。
 * 本番はフロントと API が同じドメインなので、ここに入れなくても動く
 */
export function allowedOrigins(): string[] {
  return (process.env.CORS_ORIGINS ?? "http://localhost:3100")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

/** いま処理しているリクエストの宛先（API 自身）の origin。リクエストの外では null */
function selfOrigin(): string | null {
  try {
    return new URL(getContext().req.url).origin;
  } catch {
    return null;
  }
}

/**
 * 支払いのあとに戻ってくるフロントの URL（例: https://ballet-conductor.example.workers.dev）を確かめる。
 * 許可したフロントか API と同じドメイン以外へは戻さない。正しければ末尾の / を除いて返す
 */
export function toReturnBaseUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const allowed = url.origin === selfOrigin() || allowedOrigins().includes(url.origin);
  if (!allowed || url.search || url.hash) return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}
