-- すでにある DB に、track_musics の並び順（position）を足すためのSQL。
-- 新しく作る DB は init/01_tables.sql に含まれているので不要。
-- 実行: docker compose exec -T db mysql -uballet -pballet ballet_conductor < backend/db/migrations/2026-10-07_add_track_musics_position.sql

ALTER TABLE track_musics ADD COLUMN position INT NOT NULL DEFAULT 0 AFTER music_id;

-- 既存の行は、追加した順（id 順）に並べておく
UPDATE track_musics tm
  JOIN (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY track_id ORDER BY id) AS rn FROM track_musics
  ) ordered ON ordered.id = tm.id
   SET tm.position = ordered.rn;
