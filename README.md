# Ballet-Conductor

バレエ音源の編集ツール（Web アプリ）。Next.js + TypeScript で作り、音声編集は Web Audio API、波形表示は wavesurfer.js を使っています。

## できること（プロトタイプ）

- 音声ファイル（MP3・WAV・M4A など）の読み込み。「サンプル曲で試す」で合成したワルツも使えます
- 波形表示（wavesurfer.js）と再生・一時停止（スペースキーでも可）
- 変更区間を複数追加（「変更区間の追加」ボタン、または波形をなぞる）。範囲は「始まり〜終わり」の秒数入力や波形上で調整。区間どうしは重ならず、重なるときは隣の区間の端で止まります
- 区間ごとのテンポ設定（50%〜150%、音の高さはそのまま）。再生中も区間に入るとそのテンポになります

編集はすべてブラウザ内（Web Audio API）で行い、サーバーには何も送りません。

## 必要なもの

- Docker（Docker Desktop など。`docker compose` が使えること）

Node.js や npm をホストに入れる必要はありません。すべてコンテナの中で動きます。

## 起動

```sh
docker compose up
```

起動したらブラウザで http://localhost:3100 を開きます。`src/` 以下を編集すると、ブラウザに自動で反映されます（ホットリロード）。

止めるときは `Ctrl+C`、またはバックグラウンドで起動した場合は `docker compose down` です。

### ポートを変えたいとき

ホスト側のポートは既定で 3100 です。変えたい場合は `WEB_PORT` を指定します。

```sh
WEB_PORT=3000 docker compose up
```

## よく使うコマンド

npm のコマンドもコンテナの中で実行します。

```sh
# パッケージを追加する（例: wavesurfer.js）
docker compose exec web npm install wavesurfer.js

# Lint
docker compose exec web npm run lint

# 本番ビルドの確認
docker compose exec web npm run build
```

`package.json` を変更したあと（別ブランチに切り替えたときなど）に依存関係がずれた場合は、node_modules のボリュームを作り直します。

```sh
docker compose down -v
docker compose up --build
```

## 構成メモ

- `Dockerfile` / `compose.yaml`: 開発用のコンテナ定義
- `node_modules` と `.next` はコンテナ側の名前付きボリュームに置くため、ホストには中身が作られません（空のフォルダだけが見えることがあります）
- macOS の bind mount でも変更を確実に拾えるよう、ファイル監視はポーリングにしています

## GitHub Pages での公開

`main` ブランチに push すると、GitHub Actions（`.github/workflows/deploy.yml`）が静的サイトとしてビルドし、GitHub Pages に公開します。公開先は `https://<ユーザー名>.github.io/Ballet-Conductor/` です。

初回だけ、リポジトリの Settings → Pages で Source を「GitHub Actions」にしておく必要があります。

公開用のビルドを手元で確かめたいときは、次のコマンドで `out/` に書き出せます。

```sh
docker compose exec -e NEXT_PUBLIC_BASE_PATH=/Ballet-Conductor web npm run build
```
