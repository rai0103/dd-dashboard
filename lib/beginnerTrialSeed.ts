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
  // 3月（取引履歴より）：純金信託 1株 単価25,445円・eMAXIS Slim 国内株式(TOPIX) 4,740口・基準価額30,708円（以上3/2約定）、
  //  iFreeレバレッジ FANG+ 3,320口・基準価額30,125円（3/3約定）。合計50,000円
  { date: '2026-03-02', name: '1540 純金上場信託（現物国内保管型）', amount: 25445 },
  { date: '2026-03-02', name: 'eMAXIS Slim 国内株式(TOPIX)', amount: 14555, nav: 30708 },
  { date: '2026-03-03', name: 'iFreeレバレッジ FANG＋', amount: 10000, nav: 30125 },
  // 4/1発注（約定日4/2）：iFreeレバレッジ FANG+ 50,000円。日付は値動きの起点にするため約定日にしている
  { date: '2026-04-02', name: 'iFreeレバレッジ FANG＋', amount: 50000 },
  // 6月（ボーナス月・25万円。取引履歴より）：NF日経レバ（1570）2株 単価73,220円、純金信託 2株 単価21,575円、
  //  eMAXIS Slim 国内株式(TOPIX) 9,700口・基準価額31,351円（以上6/1約定）、eMAXIS Slim 米国株式(S&P500) 6,730口・基準価額44,581円（6/2約定）
  { date: '2026-06-01', name: 'NF日経レバ', amount: 146440 },
  { date: '2026-06-01', name: '1540 純金上場信託（現物国内保管型）', amount: 43150 },
  { date: '2026-06-01', name: 'eMAXIS Slim 国内株式(TOPIX)', amount: 30410, nav: 31351 },
  { date: '2026-06-02', name: 'eMAXIS Slim 米国株式(S&P500)', amount: 30000, nav: 44581 },
  // 7/1：純金信託（1540）1株＋ iFreeNEXT NASDAQ100インデックス 30,455円（トライアルで初めてのNASDAQ）。
  // 純金信託の約定単価は画面に無いため、毎月の5万円から投資信託の注文金額を引いた残り（19,545円）としている
  { date: '2026-07-01', name: '1540 純金上場信託（現物国内保管型）', amount: 50000 - 30455 },
  { date: '2026-07-01', name: 'iFreeNEXT NASDAQ100インデックス', amount: 30455 },
  // 8/3 18時台に発注（15時以降の注文のため、約定は翌営業日の8/4として記録）：TOPIX 3万円・NASDAQ100 2万円
  { date: '2026-08-04', name: 'eMAXIS Slim 国内株式(TOPIX)', amount: 30000 },
  { date: '2026-08-04', name: 'iFreeNEXT NASDAQ100インデックス', amount: 20000 },
  // 9月（取引履歴より）：純金信託 1株 約定9/1・単価21,270円、eMAXIS Slim 米国株式(S&P500) 約定9/2・6,382口・基準価額45,017円・28,730円
  { date: '2026-09-01', name: '1540 純金上場信託（現物国内保管型）', amount: 21270 },
  { date: '2026-09-02', name: 'eMAXIS Slim 米国株式(S&P500)', amount: 28730, nav: 45017 },
  // 10月：純金信託 1株 10/5約定・単価19,640円、eMAXIS Slim 米国株式(S&P500) 30,360円（約定10/6）
  { date: '2026-10-05', name: '1540 純金上場信託（現物国内保管型）', amount: 19640 },
  { date: '2026-10-06', name: 'eMAXIS Slim 米国株式(S&P500)', amount: 30360 },
  // 11月（取引履歴より）：純金信託 1株 約定11/4・単価18,580円、iFreeNEXT NASDAQ100 約定11/5・5,142口・基準価額53,620円・27,570円
  //  （合計46,150円。残り3,850円は現金のまま）
  { date: '2026-11-04', name: '1540 純金上場信託（現物国内保管型）', amount: 18580 },
  { date: '2026-11-05', name: 'iFreeNEXT NASDAQ100インデックス', amount: 27570, nav: 53620 },
];

/**
 * 口座画面の内訳（ブログの報告）で分かっている時点の評価額。total は投資中の資産の合計（未投資の現金は除く）、
 * fixed は銘柄が1つに決まる区分の実際の値（株式＝純金信託だけ）。積み上げグラフで、その時点を一部実績にする。
 */
export const DAIWA_CHECKPOINTS: { date: string; total: number; fixed: Record<string, number>; note: string }[] = [
  // 6/1朝（ボーナス月の買い付け前）：株式(1)107,725円・投資信託(4)652,376円・現金250,000円（入金済み・未投資）。
  //  6/1約定の買い付けより前の状態なので、5/31の時点として扱う
  { date: '2026-05-31', total: 107725 + 652376, fixed: { '1540 純金上場信託（現物国内保管型）': 107725 }, note: '株式107,725円・投資信託652,376円（現金250,000円は未投資のため除く）' },
  // 8/3：株式(2)282,740円・投資信託(5)702,011円・現金50,000円（未投資）、すべての資産1,034,751円（評価損益+34,751円）。
  // 株式は2銘柄（純金信託ともう1銘柄）で内訳が分からないため、合計だけを使う
  { date: '2026-08-03', total: 282740 + 702011, fixed: {}, note: '株式282,740円・投資信託702,011円（現金50,000円は未投資のため除く）' },
  // 11/7：株式(2)313,865円・投資信託(5)784,485円、すべての資産1,102,200円（現金3,850円）。株式の内訳は損益画面から逆算：
  //  NF日経レバ 損益−42,620円（−29.1%）→取得額 約146,460円・評価額 約103,840円、純金信託＝313,865−103,840＝210,025円（損益−26,135円＝−11.06%と一致）
  { date: '2026-11-07', total: 313865 + 784485, fixed: { '1540 純金上場信託（現物国内保管型）': 210025, 'NF日経レバ': 103840 }, note: '株式313,865円（純金信託約210,025円・NF日経レバ約103,840円）・投資信託784,485円' },
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
