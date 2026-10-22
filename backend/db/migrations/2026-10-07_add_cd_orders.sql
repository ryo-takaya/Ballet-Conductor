-- すでにある DB に、CD の作成依頼のテーブル（cd_orders、cd_order_events）を足すための SQL。
-- 新しく作る DB は init/01_tables.sql に含まれているので不要。
-- 実行: docker compose exec -T db mysql -uballet -pballet ballet_conductor < backend/db/migrations/2026-10-07_add_cd_orders.sql

-- CD の作成依頼。依頼した時点のトラックの中身と送付先を写して残す（あとでトラックや住所を変えても、依頼の中身は変わらない）
CREATE TABLE IF NOT EXISTS cd_orders (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  -- 元のトラック。トラックを消しても依頼は残すので、そのときは NULL になる
  track_id BIGINT UNSIGNED NULL,
  track_name VARCHAR(255) NOT NULL,
  -- 依頼した時点の曲・順番・変更区間
  track_snapshot JSON NOT NULL,
  recipient_name VARCHAR(255) NOT NULL,
  postal_code VARCHAR(8) NOT NULL,
  prefecture VARCHAR(10) NOT NULL,
  city VARCHAR(255) NOT NULL,
  address_line1 VARCHAR(255) NOT NULL,
  address_line2 VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_cd_orders_user_id (user_id),
  KEY idx_cd_orders_track_id (track_id),
  CONSTRAINT fk_cd_orders_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_cd_orders_track FOREIGN KEY (track_id) REFERENCES tracks (id) ON DELETE SET NULL
);

-- CD の作成依頼の状態の履歴。いまの状態は一番新しいイベントで決まる
CREATE TABLE IF NOT EXISTS cd_order_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  cd_order_id BIGINT UNSIGNED NOT NULL,
  event ENUM('requested', 'accepted', 'in_production', 'shipped', 'cancelled') NOT NULL,
  note VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_cd_order_events_order (cd_order_id, created_at),
  CONSTRAINT fk_cd_order_events_order FOREIGN KEY (cd_order_id) REFERENCES cd_orders (id) ON DELETE CASCADE
);
