// [グラフ動画] 銘柄名の表示：正式名称から、運用会社のブランド名（eMAXIS Slim・iFree 等）を残した略称を作る。
// 例：eMAXIS Slim 米国株式(S&P500) → eMAXIS Slim S&P500、1540 純金上場信託（現物国内保管型） → 純金上場信託(1540)、
//     NEXT FUNDS 日経平均レバレッジ・インデックス連動型上場投信 → NF日経レバ。
// 取り込みのたびに少し違う書き方で登録された同じ銘柄（空白の有無・正式名称と通称など）は fundKey が同じになる。
// テスト：lib/chartVideo/fundNames.test.ts

const RULES: [RegExp, string][] = [
  [/米国株式\s*\(\s*S&P\s*500\s*\)/i, 'S&P500'],
  [/国内株式\s*\(\s*TOPIX\s*\)/i, 'TOPIX'],
  [/全世界株式\s*\(\s*オール・?カントリー\s*\)/, 'オルカン'],
  [/先進国株式インデックス/, '先進国株式'],
  [/NEXT\s*FUNDS\s*/i, 'NF'],
  [/日経平均レバレッジ/, '日経レバ'],
  [/[・\s]*インデックス連動型上場投信/, ''],
  [/連動型上場投信|上場投資信託/, ''],
  [/[（(]\s*現物国内保管型\s*[）)]/, ''],
  [/[（(]\s*為替ヘッジなし\s*[）)]/, ''],
  [/インデックス(ファンド)?$/, ''],
  [/ファンド$/, ''],
  [/＋/g, '+'],
];

/** 正式名称の略称（グラフ・凡例・ナレーション用） */
export function fundAbbr(name: string): string {
  let s = String(name || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  // 先頭の証券コード（例：1540 純金上場信託）は後ろにかっこで付ける
  const code = s.match(/^(\d{4})\s+(.+)$/);
  if (code) s = code[2];
  for (const [re, to] of RULES) s = s.replace(re, to);
  s = s.replace(/\s+/g, ' ').replace(/\s*\(\s*\)\s*/g, '').trim();
  if (/^NF\s+/.test(s)) s = s.replace(/^NF\s+/, 'NF');
  if (code) s = `${s}(${code[1]})`;
  return s || String(name || '');
}

/** 同じ銘柄を見分けるための鍵（空白・かっこ書きの証券コード・大文字小文字の違いを無視） */
export function fundKey(name: string): string {
  return fundAbbr(name).replace(/\(\d{4}\)$/, '').replace(/\s+/g, '').toLowerCase();
}
