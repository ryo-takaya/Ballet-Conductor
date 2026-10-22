import { zValidator } from "@hono/zod-validator";
import type { z } from "zod";

/** JSON の入力チェック。失敗したときは最初のエラー文だけを 400 で返す */
export const validateJson = <T extends z.ZodType>(schema: T) =>
  zValidator("json", schema, (result, c) => {
    if (!result.success) {
      return c.json({ error: result.error.issues[0]?.message ?? "入力内容を確認してください。" }, 400);
    }
  });
