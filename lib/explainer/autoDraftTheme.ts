// 自動ドラフト：過去に作ったテーマと同じ話題かどうかの判定（ブラウザ・Node どちらでも動く、依存なしの関数だけを置く）

/** 比べるために、記号・空白・かっこ書きを除いて小文字にする */
function normTheme(s: string): string {
  return String(s || '').toLowerCase().replace(/[（(][^）)]*[）)]/g, '').replace(/[\s　、。・！？!?「」『』"'“”‘’:：,，.．\-ー〜~／/|｜]/g, '');
}
function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}
/**
 * 過去に作ったテーマ（またはその動画タイトル）と同じ話題かどうか。完全一致・片方がもう片方を含む・
 * 2文字ずつの重なりが半分以上、のどれかなら同じ話題とみなす（AIが言い方を変えて同じニュースを選ぶのを防ぐ）
 */
export function isSimilarTheme(theme: string, past: string[]): boolean {
  const a = normTheme(theme);
  if (!a) return false;
  const ga = bigrams(a);
  return past.some((p) => {
    const b = normTheme(p);
    if (!b) return false;
    if (a === b || (b.length >= 4 && a.includes(b)) || (a.length >= 4 && b.includes(a))) return true;
    const gb = bigrams(b);
    let inter = 0;
    ga.forEach((g) => { if (gb.has(g)) inter++; });
    return inter / Math.max(1, Math.min(ga.size, gb.size)) >= 0.5 && inter >= 4;
  });
}

/* ---------------- 自動で選ぶテーマのジャンル ---------------- */
/** 夜間の自動生成で、話題のニュースを探すジャンル。hint はAI（Google検索）に渡す範囲の説明 */
export const THEME_GENRES = [
  { key: 'jp-economy', label: '日本経済', hint: '日本の景気・物価・賃金・金利・日銀・為替・株式市場・政府の経済政策' },
  { key: 'world-economy', label: '世界経済', hint: '米国・中国・欧州など海外の景気・物価・金利・中央銀行・貿易・市場の動き' },
  { key: 'jp-company', label: '日本企業', hint: '日本企業の決算・新製品・M&A・経営・不祥事・業界の動き' },
  { key: 'global-company', label: '海外企業', hint: '海外企業（米国のテック企業など）の決算・新製品・M&A・経営・規制の動き' },
  { key: 'jp-news', label: '国内時事', hint: '日本国内の政治・社会・制度・事件などの時事ニュース（経済以外も含む）' },
  { key: 'world-news', label: '海外時事', hint: '海外の政治・外交・紛争・選挙・社会などの時事ニュース（経済以外も含む）' },
] as const;
export type ThemeGenreKey = typeof THEME_GENRES[number]['key'];
export const genreLabel = (key: string) => THEME_GENRES.find((g) => g.key === key)?.label ?? key;

/**
 * n本分のジャンルを決める。selected（選んだジャンル）があればその中から、無ければ全ジャンルから、
 * シャッフルした順に割り当てる（本数がジャンル数より多いときは、シャッフルし直して続ける）。
 */
export function pickGenres(selected: readonly string[] | undefined, n: number, rand: () => number = Math.random): string[] {
  const valid = new Set<string>(THEME_GENRES.map((g) => g.key));
  const pool = [...new Set((selected || []).filter((k) => valid.has(k)))];
  const base = pool.length ? pool : THEME_GENRES.map((g) => g.key);
  const out: string[] = [];
  while (out.length < n) {
    const deck = [...base];
    for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    // 続けて同じジャンルにならないように（ジャンルが2つ以上あるとき）
    if (out.length && deck.length > 1 && deck[0] === out[out.length - 1]) deck.push(deck.shift() as string);
    out.push(...deck);
  }
  return out.slice(0, n);
}
