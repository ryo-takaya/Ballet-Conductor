import { serve } from "@hono/node-server";
import app from "./app.js";

// ローカル開発用の Node.js サーバー
const port = Number(process.env.PORT ?? 8787);

serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, (info) => {
  console.log(`API server listening on http://localhost:${info.port}/api`);
});
