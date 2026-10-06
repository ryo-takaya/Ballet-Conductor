# Ballet-Conductor

バレエ音源の編集ツール（Web アプリ）。Next.js + TypeScript で作り、音声編集は Web Audio API、波形表示は wavesurfer.js を使っています。

## できること（プロトタイプ）

- 音声ファイル（MP3・WAV・M4A など）の読み込み。「サンプル曲で試す」で合成したワルツも使えます
- 波形表示（wavesurfer.js）と再生・一時停止（スペースキーでも可）
- 波形をなぞって範囲を選び、「カット」で削除。「元に戻す」で取り消し
- テンポ変更（50%〜150%）。音の高さは変えずに速さだけを変えます
- 編集結果を WAV で書き出し（テンポ変更も反映）

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
