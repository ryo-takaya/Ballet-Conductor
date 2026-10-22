-- すでにある DB に、CD の送付先のテーブル（shipping_addresses）を足すための SQL。
-- 新しく作る DB は init/01_tables.sql に含まれているので不要。
-- 実行: docker compose exec -T db mysql -uballet -pballet ballet_conductor < backend/db/migrations/2026-10-07_add_shipping_addresses.sql

-- CD の送付先（利用者 1 人につき複数持てる）。is_default が true の住所がデフォルトの送付先
CREATE TABLE IF NOT EXISTS shipping_addresses (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  recipient_name VARCHAR(255) NOT NULL,
  postal_code VARCHAR(8) NOT NULL,
  prefecture VARCHAR(10) NOT NULL,
  city VARCHAR(255) NOT NULL,
  address_line1 VARCHAR(255) NOT NULL,
  address_line2 VARCHAR(255) NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  -- デフォルトの住所のときだけ user_id が入る列。ここを一意にして、デフォルトが 1 人 1 件になるようにする
  default_user_id BIGINT UNSIGNED GENERATED ALWAYS AS (IF(is_default, user_id, NULL)) VIRTUAL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_shipping_addresses_user_id (user_id),
  UNIQUE KEY uq_shipping_addresses_default (default_user_id),
  CONSTRAINT fk_shipping_addresses_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
