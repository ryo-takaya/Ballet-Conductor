import { AsyncLocalStorage } from "node:async_hooks";
import mysql, { type Pool } from "mysql2/promise";

export type DbConfig = { host: string; port: number; database: string; user: string; password: string };

/** MySQL への接続プールを作る（接続は使うときに初めて張られる） */
function createDbPool(config: DbConfig, options: { disableEval?: boolean } = {}): Pool {
  const pool = mysql.createPool({
    ...config,
    connectionLimit: 5,
    timezone: "Z",
    // Cloudflare Workers では eval が使えないので、mysql2 の高速化用のコード生成を止める
    disableEval: options.disableEval,
  });
  // 日時は UTC で読み書きする（DB サーバーのタイムゾーンが日本時間でもずれないように、接続ごとにそろえる）
  pool.pool.on("connection", (conn) => {
    conn.query("SET time_zone = '+00:00'");
  });
  return pool;
}

// Node.js（ローカル開発・テスト）で使う接続プール。接続先は環境変数（compose.yaml で設定）から読む
let nodePool: Pool | undefined;
function getNodePool(): Pool {
  nodePool ??= createDbPool({
    host: process.env.DB_HOST ?? "localhost",
    port: Number(process.env.DB_PORT ?? 3306),
    database: process.env.DB_NAME ?? "ballet_conductor",
    user: process.env.DB_USER ?? "ballet",
    password: process.env.DB_PASSWORD ?? "ballet",
  });
  return nodePool;
}

// Workers では接続をリクエストをまたいで使い回せないので、リクエストごとにプールを作ってここに入れる
const requestPool = new AsyncLocalStorage<Pool>();

/**
 * DB への接続プール。いまのリクエスト用のプールがあればそれを、なければ Node.js 用のプールを使う。
 * 呼び出し側はどちらで動いているかを気にせず db.execute() などを使える
 */
export const db: Pool = new Proxy({} as Pool, {
  get(_, prop) {
    const pool = requestPool.getStore() ?? getNodePool();
    const value = Reflect.get(pool, prop, pool);
    return typeof value === "function" ? value.bind(pool) : value;
  },
});

/**
 * fn の中の db をこのリクエスト専用のプールにする（Workers 用）。
 * 終わったらプールを閉じる。閉じる処理は defer に渡し、レスポンスを待たせない
 */
export async function withRequestDb<T>(
  config: DbConfig,
  fn: () => Promise<T>,
  defer: (promise: Promise<unknown>) => void,
): Promise<T> {
  const pool = createDbPool(config, { disableEval: true });
  try {
    return await requestPool.run(pool, fn);
  } finally {
    defer(pool.end().catch((err) => console.error("[db] 接続を閉じられませんでした", err)));
  }
}

/** DB に接続できるかを確かめる */
export async function pingDb(): Promise<boolean> {
  try {
    await db.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
