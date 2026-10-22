-- MySQL の初回起動時（db_data ボリュームが空のとき）にだけ実行される。
-- テーブルが決まったら、ここにファイルを追加していく（例: 01_tables.sql）。
-- 作り直したいときは `docker compose down -v` でボリュームを消してから起動する。

SET NAMES utf8mb4;
