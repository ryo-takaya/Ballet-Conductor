-- 音源つきのテスト用の曲（開発用）。音源は frontend/public/audio/ に置いた自作の合成音（どれも約1分）。
-- url が「/」で始まるときは、フロントのサイト内のファイルとして読み込む。
-- 同じ url の曲がすでにあれば追加しない。

SET NAMES utf8mb4;

INSERT INTO musics (name, url)
SELECT s.name, s.url FROM (
  SELECT 'テスト音源 オルゴールのワルツ（3拍子・132）' AS name, '/audio/test-waltz.mp3' AS url UNION ALL
  SELECT 'テスト音源 プリエ（3拍子・84）', '/audio/test-plie.mp3' UNION ALL
  SELECT 'テスト音源 タンデュ（2拍子・104）', '/audio/test-tendu.mp3' UNION ALL
  SELECT 'テスト音源 ジュッテ（2拍子・126）', '/audio/test-jete.mp3' UNION ALL
  SELECT 'テスト音源 ロンド・ドゥ・ジャンブ（3拍子・120）', '/audio/test-rond-de-jambe.mp3' UNION ALL
  SELECT 'テスト音源 フォンデュ（3拍子・76）', '/audio/test-fondu.mp3' UNION ALL
  SELECT 'テスト音源 フラッペ（2拍子・116）', '/audio/test-frappe.mp3' UNION ALL
  SELECT 'テスト音源 アダージオ（4拍子・66）', '/audio/test-adagio.mp3' UNION ALL
  SELECT 'テスト音源 グラン・バットマン（4拍子・112・短調）', '/audio/test-grand-battement.mp3' UNION ALL
  SELECT 'テスト音源 ピルエット（3拍子・132）', '/audio/test-pirouette.mp3' UNION ALL
  SELECT 'テスト音源 グラン・ワルツ（3拍子・150）', '/audio/test-grand-waltz.mp3'
) AS s
WHERE NOT EXISTS (SELECT 1 FROM musics m WHERE m.url = s.url);

-- 先に入れていた曲の名前を、ほかのテスト音源とそろえる
UPDATE musics SET name = 'テスト音源 オルゴールのワルツ（3拍子・132）' WHERE url = '/audio/test-waltz.mp3';
