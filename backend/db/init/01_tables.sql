-- アプリで使うテーブル。
-- 各テーブルに id（主キー）と作成・更新日時を持たせ、関連する列には外部キーを張っている。
-- IF NOT EXISTS にしているので、すでにテーブルがある DB に流し直しても安全。

SET NAMES utf8mb4;

-- 利用者
CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ログイン情報（利用者 1 人につき 1 行）。password にはハッシュ化した値を入れる
CREATE TABLE IF NOT EXISTS user_passwords (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  email VARCHAR(255) NOT NULL,
  password TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_passwords_user_id (user_id),
  UNIQUE KEY uq_user_passwords_email (email),
  CONSTRAINT fk_user_passwords_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- 曲（音源ファイル）
CREATE TABLE IF NOT EXISTS musics (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  url TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- トラック（曲をまとめたもの）。持ち主の利用者を消すと、その人のトラックも消える
CREATE TABLE IF NOT EXISTS tracks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_tracks_user_id (user_id),
  CONSTRAINT fk_tracks_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- トラックと曲の対応（トラックに入っている曲）。position はトラック内の並び順（小さいほど先）
CREATE TABLE IF NOT EXISTS track_musics (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  track_id BIGINT UNSIGNED NOT NULL,
  music_id BIGINT UNSIGNED NOT NULL,
  position INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_track_musics_track_id (track_id),
  KEY idx_track_musics_music_id (music_id),
  CONSTRAINT fk_track_musics_track FOREIGN KEY (track_id) REFERENCES tracks (id) ON DELETE CASCADE,
  CONSTRAINT fk_track_musics_music FOREIGN KEY (music_id) REFERENCES musics (id) ON DELETE CASCADE
);

-- トラック内の曲に設定した変更区間（start_second〜end_second をテンポ tempo % で再生する）
CREATE TABLE IF NOT EXISTS edit_musics (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  track_music_id BIGINT UNSIGNED NOT NULL,
  start_second INT NOT NULL,
  end_second INT NOT NULL,
  tempo INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_edit_musics_track_music_id (track_music_id),
  CONSTRAINT fk_edit_musics_track_music FOREIGN KEY (track_music_id) REFERENCES track_musics (id) ON DELETE CASCADE
);

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
  -- 依頼した時点の料金（税込・送料込）。有料化する前の依頼は 0
  price_amount INT UNSIGNED NOT NULL DEFAULT 0,
  currency CHAR(3) NOT NULL DEFAULT 'jpy',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_cd_orders_user_id (user_id),
  KEY idx_cd_orders_track_id (track_id),
  CONSTRAINT fk_cd_orders_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_cd_orders_track FOREIGN KEY (track_id) REFERENCES tracks (id) ON DELETE SET NULL
);

-- CD の作成依頼の状態の履歴。いまの状態は一番新しいイベントで決まる
-- awaiting_payment（支払い待ち）→ paid（支払い済み）→ requested → accepted → in_production → shipped、
-- または cancelled（支払い済みなら続けて refunded）
CREATE TABLE IF NOT EXISTS cd_order_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  cd_order_id BIGINT UNSIGNED NOT NULL,
  event ENUM('awaiting_payment', 'paid', 'requested', 'accepted', 'in_production', 'shipped', 'cancelled', 'refunded') NOT NULL,
  note VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_cd_order_events_order (cd_order_id, created_at),
  CONSTRAINT fk_cd_order_events_order FOREIGN KEY (cd_order_id) REFERENCES cd_orders (id) ON DELETE CASCADE
);

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
