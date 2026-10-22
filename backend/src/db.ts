import mysql from "mysql2/promise";

// MySQL への接続プール。接続先は環境変数（compose.yaml で設定）から読む
export const db = mysql.createPool({
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 3306),
  database: process.env.DB_NAME ?? "ballet_conductor",
  user: process.env.DB_USER ?? "ballet",
  password: process.env.DB_PASSWORD ?? "ballet",
  connectionLimit: 5,
  timezone: "Z",
});

// 日時は UTC で読み書きする（DB サーバーのタイムゾーンが日本時間でもずれないように、接続ごとにそろえる）
db.pool.on("connection", (conn) => {
  conn.query("SET time_zone = '+00:00'");
});

/** DB に接続できるかを確かめる */
export async function pingDb(): Promise<boolean> {
  try {
    await db.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
