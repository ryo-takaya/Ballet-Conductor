// 呼び出しを許可するフロントの URL（ローカルの開発サーバーと GitHub Pages）。compose.yaml の CORS_ORIGINS で設定する
export const allowedOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:3100,https://ryo-takaya.github.io")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

/**
 * 支払いのあとに戻ってくるフロントの URL（例: https://ryo-takaya.github.io/Ballet-Conductor）を確かめる。
 * 許可したフロント以外へは戻さない。正しければ末尾の / を除いて返す
 */
export function toReturnBaseUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (!allowedOrigins.includes(url.origin) || url.search || url.hash) return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}
