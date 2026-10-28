// [Stage E-4] 「株式情報」モードの台本生成に渡す実データカタログ（StockCatalog）の組み立て。
// 2つの材料から同じ形に変換する：
//  - buildStockCatalogFromSnapshot：dd-dashboard（components/DDDashboard.jsx）がstorage（共有IndexedDB）
//    に書き出した stock-catalog:SP500 / stock-catalog:SOXL のスナップショット（{asOf, instrumentLabel,
//    catalog, scalarCatalog}。catalog/scalarCatalogはlib/videoCustomScene.tsのSeriesCatalog/ScalarCatalogと同じ形）
//  - buildStockCatalogFromCsv：ダッシュボードが持たない企業のCSV（lib/csvPrice.tsのparseStooqCSVで取り込んだ
//    {date,price}[]）から、基本的な株価推移・騰落率のみを組み立てる（深い統計は対象外。方針確認済み）
import { valueAt } from '../videoLongBasis';
import type { StockCatalog, VisualItem } from './types';

/** 系列（t:0〜1で1年、v:年始=100の指数）を、折れ線用に10点程度へ均等間隔で抽出する */
function downsampleYearPath(pts: { t: number; v: number }[], n = 10): { label: string; value: number }[] {
  if (!pts.length) return [];
  const maxT = pts[pts.length - 1].t;
  if (maxT <= 0) return [{ label: '1月', value: Math.round(pts[0].v * 10) / 10 }];
  const out: { label: string; value: number }[] = [];
  for (let i = 0; i < n; i++) {
    const t = (maxT * i) / (n - 1);
    const month = Math.min(12, Math.max(1, Math.round(t * 12) || 1));
    out.push({ label: `${month}月`, value: Math.round(valueAt(pts, t) * 10) / 10 });
  }
  return out;
}

/** dd-dashboardのstorageスナップショット（stock-catalog:SP500 等をJSON.parseしたもの）→StockCatalog */
export function buildStockCatalogFromSnapshot(snapshot: any): StockCatalog {
  const scalars: StockCatalog['scalars'] = {};
  for (const [key, v] of Object.entries<any>(snapshot?.scalarCatalog ?? {})) {
    if (typeof v?.value === 'number' && Number.isFinite(v.value)) scalars[key] = { label: String(v.label ?? key), value: v.value };
  }
  const series: StockCatalog['series'] = {};
  for (const [key, v] of Object.entries<any>(snapshot?.catalog ?? {})) {
    if (Array.isArray(v?.pts) && v.pts.length) series[key] = { label: String(v.label ?? key), points: downsampleYearPath(v.pts) };
  }
  // [Stage E-9] 「年比較グラフ」用：snapshot.catalog（lib/videoCustomScene.tsのbuildSeriesCatalog）の各系列
  // （curYear・個別年y{YYYY}・cyclePos1〜4・recentN・allYears）を、ダウンサンプルせず年内の実日数(x)のまま
  // 持たせる（系列ごとに長さが違っても正しい横軸位置で重ねて描けるようにするため）。curYearだけemphasis:trueにする。
  const yearCompareSeries: NonNullable<StockCatalog['yearCompare']>['series'] = {};
  for (const [key, v] of Object.entries<any>(snapshot?.catalog ?? {})) {
    if (!Array.isArray(v?.pts) || !v.pts.length) continue;
    const points = v.pts
      .filter((p: any) => Number.isFinite(p?.t) && Number.isFinite(p?.v))
      .map((p: any) => ({ x: Math.round(p.t * 365), value: Math.round(p.v * 10) / 10 }));
    if (points.length) yearCompareSeries[key] = { label: String(v.label ?? key), emphasis: key === 'curYear', points };
  }
  const yearCompare = Object.keys(yearCompareSeries).length
    ? { xLabel: '年初からの経過日数', unit: '（指数・年初=100）', series: yearCompareSeries }
    : undefined;
  return { instrumentLabel: String(snapshot?.instrumentLabel ?? ''), asOf: String(snapshot?.asOf ?? ''), scalars, series, yearCompare };
}

// [Stage E-9] 選ばれたyearCompareのキー（2〜8個）を、Canvas描画用のVisualItem配列に解決する。
// 1キー＝1系列（線）。同じseriesKeyの点を発生順につないで1本の線として描く（lib/explainer/visuals.tsのdrawOverlay）。
// 存在しないキーは無視する（AI生成・手動選択どちらからも呼ばれる共通ロジック）。
export function resolveYearCompareItems(seriesKeys: string[], catalog: StockCatalog['yearCompare'] | undefined): VisualItem[] {
  if (!catalog) return [];
  const keys = [...new Set((seriesKeys ?? []).filter((k) => typeof k === 'string' && catalog.series[k]))].slice(0, 8);
  const items: VisualItem[] = [];
  for (const key of keys) {
    const s = catalog.series[key];
    for (const p of s.points) {
      items.push({ label: `${p.x}日`, value: String(p.value), text: '', icon: 'chartUp', x: p.x, seriesKey: key, seriesLabel: s.label, seriesEmphasis: s.emphasis });
    }
  }
  return items;
}

const fmtMD = (d: Date): string => `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;

/** ダッシュボードが持たない企業のCSV（{date,price}[]、日付昇順でなくても良い）→StockCatalog（基本的な株価推移のみ） */
export function buildStockCatalogFromCsv(companyName: string, rows: { date: Date; price: number }[]): StockCatalog {
  const name = companyName.trim() || 'アップロードした企業';
  if (!rows.length) return { instrumentLabel: name, asOf: '', scalars: {}, series: {} };
  const sorted = [...rows].sort((a, b) => a.date.getTime() - b.date.getTime());
  const first = sorted[0], last = sorted[sorted.length - 1];
  const prices = sorted.map((r) => r.price);
  const scalars: StockCatalog['scalars'] = {
    latest: { label: `${name}の最新終値（${fmtMD(last.date)}）`, value: last.price },
    periodMax: { label: `${name}の取り込み期間中の最高値`, value: Math.max(...prices) },
    periodMin: { label: `${name}の取り込み期間中の最安値`, value: Math.min(...prices) },
  };
  if (first.price) {
    scalars.periodReturn = { label: `${name}の取り込み期間（${fmtMD(first.date)}〜${fmtMD(last.date)}）の騰落率`, value: ((last.price - first.price) / first.price) * 100 };
  }
  const n = Math.min(12, sorted.length);
  const step = n > 1 ? (sorted.length - 1) / (n - 1) : 0;
  const points = Array.from({ length: n }, (_, i) => {
    const row = sorted[Math.round(i * step)];
    return { label: fmtMD(row.date), value: row.price };
  });
  return { instrumentLabel: name, asOf: fmtMD(last.date), scalars, series: { priceTrend: { label: `${name}の株価推移`, points } } };
}

// [Stage E-6] 複数の銘柄（S&P500・SOXL・CSVでアップロードした各社）のStockCatalogを、キーの衝突を避けて
// 1つに統合する。「データソースを選ぶ」操作を廃止し、ダッシュボードが持つデータ（S&P500・SOXL）を常に
// 下敷きにしつつ、シナリオに応じてAIが必要な銘柄のキーだけを選んで使う方式に変える（Stage E-4のdataKey/
// seriesKey方式と組み合わせる）。各キーには元のinstrumentLabelを接頭辞として付け、ラベルにも銘柄名を
// 含めることで、AIが「どの銘柄のどの値か」を取り違えないようにする。空・未読み込みのcatalogは無視する。
export function mergeStockCatalogs(catalogs: (StockCatalog | undefined | null)[]): StockCatalog {
  const scalars: StockCatalog['scalars'] = {};
  const series: StockCatalog['series'] = {};
  let yearCompareSeries: NonNullable<StockCatalog['yearCompare']>['series'] | undefined;
  let yearCompareXLabel = '', yearCompareUnit = '';
  const labels: string[] = [];
  let asOf = '';
  for (const cat of catalogs) {
    if (!cat) continue;
    const hasYearCompare = !!cat.yearCompare && Object.keys(cat.yearCompare.series).length;
    if (!Object.keys(cat.scalars).length && !Object.keys(cat.series).length && !hasYearCompare) continue;
    const label = cat.instrumentLabel || '銘柄';
    labels.push(label);
    if (cat.asOf && !asOf) asOf = cat.asOf;
    for (const [k, v] of Object.entries(cat.scalars)) scalars[`${label}::${k}`] = { label: `${label}：${v.label}`, value: v.value };
    for (const [k, v] of Object.entries(cat.series)) series[`${label}::${k}`] = { label: `${label}：${v.label}`, points: v.points };
    if (hasYearCompare) {
      if (!yearCompareSeries) yearCompareSeries = {};
      if (!yearCompareXLabel) yearCompareXLabel = cat.yearCompare!.xLabel;
      if (!yearCompareUnit) yearCompareUnit = cat.yearCompare!.unit;
      for (const [k, v] of Object.entries(cat.yearCompare!.series)) yearCompareSeries[`${label}::${k}`] = { ...v, label: `${label}：${v.label}` };
    }
  }
  const yearCompare = yearCompareSeries ? { xLabel: yearCompareXLabel, unit: yearCompareUnit, series: yearCompareSeries } : undefined;
  return { instrumentLabel: labels.join('・'), asOf, scalars, series, yearCompare };
}
