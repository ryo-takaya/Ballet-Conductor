-- すでにある DB に、CD の依頼の有料化（料金の列、支払いのイベント、cd_order_payments）を足すための SQL。
-- 新しく作る DB は init/01_tables.sql に含まれているので不要。2026-10-07_add_cd_orders.sql のあとに流す。
-- 実行: docker compose exec -T db mysql -uballet -pballet ballet_conductor < backend/db/migrations/2026-10-10_add_cd_order_payments.sql

-- 依頼した時点の料金（税込・送料込）。すでにある依頼は有料化する前のものなので 0
ALTER TABLE cd_orders
  ADD COLUMN price_amount INT UNSIGNED NOT NULL DEFAULT 0 AFTER address_line2,
  ADD COLUMN currency CHAR(3) NOT NULL DEFAULT 'jpy' AFTER price_amount;

-- 支払い待ち（awaiting_payment）、支払い済み（paid）、返金済み（refunded）を足す
ALTER TABLE cd_order_events
  MODIFY COLUMN event ENUM('awaiting_payment', 'paid', 'requested', 'accepted', 'in_production', 'shipped', 'cancelled', 'refunded') NOT NULL;
-- CD の作成依頼の支払い（Stripe Checkout）。支払い画面を開き直すと 1 つの依頼に複数の行ができる
CREATE TABLE IF NOT EXISTS cd_order_payments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  cd_order_id BIGINT UNSIGNED NOT NULL,
  amount INT UNSIGNED NOT NULL,
  currency CHAR(3) NOT NULL,
  stripe_checkout_session_id VARCHAR(255) NOT NULL,
  -- 支払いが済むと入る（返金に使う）
  stripe_payment_intent_id VARCHAR(255) NULL,
  stripe_refund_id VARCHAR(255) NULL,
  -- pending: 支払い画面を開いている、paid: 支払い済み、expired: 期限切れ・閉じた、refunded: 返金済み
  status ENUM('pending', 'paid', 'expired', 'refunded') NOT NULL DEFAULT 'pending',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cd_order_payments_session (stripe_checkout_session_id),
  KEY idx_cd_order_payments_order (cd_order_id),
  CONSTRAINT fk_cd_order_payments_order FOREIGN KEY (cd_order_id) REFERENCES cd_orders (id) ON DELETE CASCADE
);
