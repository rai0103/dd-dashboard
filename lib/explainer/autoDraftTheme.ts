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
