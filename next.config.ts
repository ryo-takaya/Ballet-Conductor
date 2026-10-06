import type { NextConfig } from "next";

// GitHub Pages では https://<user>.github.io/<リポジトリ名>/ の下で公開されるため、
// ビルド時に NEXT_PUBLIC_BASE_PATH（例: /Ballet-Conductor）を渡す。ローカル開発では空のまま。
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  // サーバーを使わない静的サイトとして out/ に書き出す
  output: "export",
  basePath,
  trailingSlash: true,
};

export default nextConfig;
