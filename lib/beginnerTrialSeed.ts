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
 * 毎月の買い付けの記録（ブログ「初心者トライアル」の購入報告から転記）。nav は買った日の基準価額（1万口あたり・円。分かるものだけ）。
 * 積み上げグラフの推計（スクショの後に買った分を足す）と、週次レポートの「今月の買い付け」の初期値に使う。
 */
export const DAIWA_PURCHASES: { date: string; name: string; amount: number; nav?: number }[] = [
  { date: '2026-01-15', name: 'eMAXIS Slim 国内株式(TOPIX)', amount: 50000, nav: 28897 },
  // 2/5：純金信託（1540）1株を成行（約定単価24,725円）＋ iFree 日経225インデックス 25,275円（合計50,000円）
  { date: '2026-02-05', name: '1540 純金上場信託（現物国内保管型）', amount: 24725 },
  { date: '2026-02-05', name: 'iFree 日経225インデックス', amount: 25275 },
  // 3/2：純金信託（1540）1株・eMAXIS Slim 国内株式(TOPIX)・iFreeレバレッジ FANG+ を注文（金額は未確認のため未記録。
  //       純金信託は6/1の株式の評価額から1株と分かる：1/10の3株＋2/5・3/2の各1株＝5株）
  // 4/1発注（約定日4/2）：iFreeレバレッジ FANG+ 50,000円。日付は値動きの起点にするため約定日にしている
  { date: '2026-04-02', name: 'iFreeレバレッジ FANG＋', amount: 50000 },
  // 7/1：純金信託（1540）1株＋ iFreeNEXT NASDAQ100インデックス 30,455円（トライアルで初めてのNASDAQ）。
  // 純金信託の約定単価は画面に無いため、毎月の5万円から投資信託の注文金額を引いた残り（19,545円）としている
  { date: '2026-07-01', name: '1540 純金上場信託（現物国内保管型）', amount: 50000 - 30455 },
  { date: '2026-07-01', name: 'iFreeNEXT NASDAQ100インデックス', amount: 30455 },
];

/**
 * 口座画面の内訳（ブログの報告）で分かっている時点の評価額。total は投資中の資産の合計（未投資の現金は除く）、
 * fixed は銘柄が1つに決まる区分の実際の値（株式＝純金信託だけ）。積み上げグラフで、その時点を一部実績にする。
 */
export const DAIWA_CHECKPOINTS: { date: string; total: number; fixed: Record<string, number>; note: string }[] = [
  // 6/1（ボーナス月）：株式(1)107,725円・投資信託(4)652,376円・現金250,000円（入金済み・未投資）
  { date: '2026-06-01', total: 107725 + 652376, fixed: { '1540 純金上場信託（現物国内保管型）': 107725 }, note: '株式107,725円・投資信託652,376円（現金250,000円は未投資のため除く）' },
];

/** 内訳の時点の銘柄名を、取り込み済みの名前に合わせる */
export function checkpointsMatched(snapshots: { items: Record<string, number> }[]): { date: string; value: number; fixed: Record<string, number> }[] {
  const key = (n: string) => n.normalize('NFKC').replace(/[\s()（）]/g, '').toLowerCase();
  const known = new Map<string, string>();
  for (const s of snapshots || []) for (const n of Object.keys(s.items)) if (!known.has(key(n))) known.set(key(n), n);
  return DAIWA_CHECKPOINTS.map((c) => ({ date: c.date, value: c.total, fixed: Object.fromEntries(Object.entries(c.fixed).map(([n, v]) => [known.get(key(n)) ?? n, v])) }));
}

/** 指定した月（YYYY-MM）の買い付け */
export function purchasesInMonth(ym: string) {
  return DAIWA_PURCHASES.filter((p) => p.date.slice(0, 7) === ym);
}

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

/** 買い付けの記録の銘柄名を、取り込み済みの名前に合わせる（同じ銘柄として積み上げグラフにつながるように） */
export function purchasesMatched(snapshots: { items: Record<string, number> }[]): { date: string; name: string; amount: number }[] {
  const key = (n: string) => n.normalize('NFKC').replace(/[\s()（）]/g, '').toLowerCase();
  const known = new Map<string, string>();
  for (const s of snapshots || []) for (const n of Object.keys(s.items)) if (!known.has(key(n))) known.set(key(n), n);
  return DAIWA_PURCHASES.map((p) => ({ date: p.date, name: known.get(key(p.name)) ?? p.name, amount: p.amount }));
}
