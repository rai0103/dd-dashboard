// 初心者トライアル（大和コネクト証券）の最初の買い付け（2026/1/10、初期費用40万円）の銘柄別評価額。
// 制作者のブログに載せた口座画面のスクショから転記したもの（スクショ取込の機能ができる前のため、取り込みの履歴に無い）。
// 銘柄名は、その後のスクショ取込で登録される名前にそろえている（同じ銘柄として積み上げグラフにつながるように）。
export const DAIWA_INITIAL_SNAPSHOT = {
  date: '2026-01-10',
  items: {
    'eMAXIS Slim 米国株式(S&P500)': 100195,
    'iFree 日経225インデックス': 99957,
    'iFreeレバレッジ FANG＋': 97968,
    'eMAXIS Slim 国内株式(TOPIX)': 36486,
    '1540 純金上場信託（現物国内保管型）': 64515,
  } as Record<string, number>,
};

/**
 * 取り込みの履歴（銘柄別評価額のスナップショット）に、最初の買い付けの記録を足す（同じ日の取り込みがあればそちらを優先）。
 * 銘柄名は、取り込み済みの名前に同じ銘柄（記号・空白・全角半角の違いだけ）があれば、その名前に合わせる。
 */
export function withInitialSnapshot<T extends { date: string; items: Record<string, number> }>(snapshots: T[]): { date: string; items: Record<string, number> }[] {
  const list = [...(snapshots || [])];
  if (list.some((s) => s.date === DAIWA_INITIAL_SNAPSHOT.date)) return list;
  const key = (n: string) => n.normalize('NFKC').replace(/[\s()（）]/g, '').toLowerCase();
  const known = new Map<string, string>();
  for (const s of list) for (const n of Object.keys(s.items)) if (!known.has(key(n))) known.set(key(n), n);
  const items: Record<string, number> = {};
  for (const [n, v] of Object.entries(DAIWA_INITIAL_SNAPSHOT.items)) items[known.get(key(n)) ?? n] = v;
  return [{ date: DAIWA_INITIAL_SNAPSHOT.date, items }, ...list].sort((a, b) => a.date.localeCompare(b.date));
}
