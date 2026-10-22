-- 曲検索を試すためのサンプルデータ（開発用）。url はまだ音源ファイルがないので空にしている。
-- 同じ名前の曲がすでにあれば追加しない。

SET NAMES utf8mb4;

INSERT INTO musics (name, url)
SELECT s.name, '' FROM (
  SELECT 'プリエ（ゆったりした 3 拍子）' AS name UNION ALL
  SELECT 'タンデュ（明るい 2 拍子）' UNION ALL
  SELECT 'ジュッテ（軽快な 2 拍子）' UNION ALL
  SELECT 'ロンド・ドゥ・ジャンブ（ワルツ）' UNION ALL
  SELECT 'フォンデュ（なめらかな 3 拍子）' UNION ALL
  SELECT 'フラッペ（歯切れのよい 2 拍子）' UNION ALL
  SELECT 'アダージオ（ゆったりした 4 拍子）' UNION ALL
  SELECT 'グラン・バットマン（力強い 3 拍子）' UNION ALL
  SELECT 'ピルエット（ワルツ）' UNION ALL
  SELECT 'プチ・アレグロ（はずむ 2 拍子）' UNION ALL
  SELECT 'グラン・ワルツ' UNION ALL
  SELECT 'グラン・アレグロ（大きなジャンプ）' UNION ALL
  SELECT 'レヴェランス（おじぎ）' UNION ALL
  SELECT '白鳥の湖 第2幕 情景' UNION ALL
  SELECT '白鳥の湖 四羽の白鳥の踊り' UNION ALL
  SELECT 'くるみ割り人形 花のワルツ' UNION ALL
  SELECT 'くるみ割り人形 金平糖の精の踊り' UNION ALL
  SELECT '眠れる森の美女 ワルツ' UNION ALL
  SELECT 'ドン・キホーテ キトリのヴァリエーション' UNION ALL
  SELECT 'ジゼル 第1幕 ジゼルのヴァリエーション' UNION ALL
  SELECT 'コッペリア スワニルダのワルツ' UNION ALL
  SELECT 'パキータ グラン・パ'
) AS s
WHERE NOT EXISTS (SELECT 1 FROM musics m WHERE m.name = s.name);
