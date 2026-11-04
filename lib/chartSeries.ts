// グラフ作成ページ（/chart-studio/）用：期間指定での正規化（開始時点=100）パス生成、およびCSV行→StockDataPoint変換。
// 複数年セット（中間選挙年の平均・直近10年平均等）は、長尺動画作成が使っていたlib/videoCustomScene.tsの
// buildSeriesCatalog()をそのまま再利用する（ここでは再実装しない）。
import { StockDataPoint } from './videoTypes';
import { buildSeriesCatalog, SeriesCatalogEntry } from './videoCustomScene';
import { presidentialTermYear } from './yearCompare';

export type PeriodKey = '1w' | '1m' | '3m' | '6m' | 'ytd' | '1y' | '3y' | '5y' | 'max';

export const PERIOD_OPTIONS: { key: PeriodKey; label: string }[] = [
  { key: '1w', label: '1週間' },
  { key: '1m', label: '1カ月' },
  { key: '3m', label: '3カ月' },
  { key: '6m', label: '6カ月' },
  { key: 'ytd', label: '年初来' },
  { key: '1y', label: '1年' },
  { key: '3y', label: '3年' },
  { key: '5y', label: '5年' },
  { key: 'max', label: '最長' },
];

/** 期間キー→「この日以降を採用」というカットオフ日（UTC基準のDate）。'max'はnull（全期間＝カットオフ無し）。 */
function cutoffDate(period: PeriodKey, asOf: Date): Date | null {
  const c = new Date(asOf.getTime());
  switch (period) {
    case '1w': c.setUTCDate(c.getUTCDate() - 7); return c;
    case '1m': c.setUTCMonth(c.getUTCMonth() - 1); return c;
    case '3m': c.setUTCMonth(c.getUTCMonth() - 3); return c;
    case '6m': c.setUTCMonth(c.getUTCMonth() - 6); return c;
    case 'ytd': return new Date(Date.UTC(asOf.getUTCFullYear(), 0, 1));
    case '1y': c.setUTCFullYear(c.getUTCFullYear() - 1); return c;
    case '3y': c.setUTCFullYear(c.getUTCFullYear() - 3); return c;
    case '5y': c.setUTCFullYear(c.getUTCFullYear() - 5); return c;
    case 'max': return null;
  }
}

/**
 * 日次終値（dailyは日付文字列昇順を前提）を、指定期間の開始時点を100とした{t,v,date}[]に変換する。
 * - t：0（期間開始）〜1（期間終端）の、データ点インデックスに基づく経過割合（日数そのものではない＝等間隔描画になる）
 * - v：開始時点の終値を100とした指数値
 * - date：その点の実際の日付（"YYYY-MM-DD"）。横軸を「実際の日付」表示にする際、tから実日付を逆算する代わりに
 *   各点が持つ実日付をそのまま使う（グラフ作成ページのxAxisStyle:'date'向け）。
 * asOfDate（"YYYY-MM-DD"）を渡すと、その日以前で最も新しい点を終端として扱う（省略時はdailyの最終点）。
 * 期間の開始点が見つからない（上場前で全期間カバー外等）場合は空配列を返す。
 */
export function periodPath(daily: StockDataPoint[], period: PeriodKey, asOfDate?: string): { t: number; v: number; date: string }[] {
  if (!daily.length) return [];
  let endIdx = daily.length - 1;
  if (asOfDate) {
    const idx = daily.findIndex((p) => p.date > asOfDate);
    endIdx = idx === -1 ? daily.length - 1 : idx - 1;
  }
  if (endIdx < 0) return [];
  const cutoff = cutoffDate(period, new Date(`${daily[endIdx].date}T00:00:00Z`));
  const startIdx = cutoff ? daily.findIndex((p) => p.date >= cutoff.toISOString().slice(0, 10)) : 0;
  if (startIdx === -1 || startIdx > endIdx) return [];
  const base = daily[startIdx].close;
  if (!base) return [];
  const span = Math.max(1, endIdx - startIdx);
  const out: { t: number; v: number; date: string }[] = [];
  for (let i = startIdx; i <= endIdx; i++) out.push({ t: (i - startIdx) / span, v: (daily[i].close / base) * 100, date: daily[i].date });
  return out;
}

/** Stooq CSVパース結果（lib/csvPrice.tsのparseStooqCSV、{date:Date,price:number}[]・日付昇順）→StockDataPoint[] */
export function csvRowsToStockDataPoints(rows: { date: Date; price: number }[]): StockDataPoint[] {
  return rows.map((r) => ({ date: r.date.toISOString().slice(0, 10), close: r.price }));
}

/**
 * periodPath()と全く同じ期間切り出し（カットオフ日・終端点の探し方）で、実際のカレンダー日数（開始点〜終端点）を
 * 求める。グラフ作成ページの横軸ラベル（日数・週数・ヶ月数・年数での表示）はこの値をもとに組み立てる
 * （periodPathのtはデータ点のインデックス基準の等間隔なので、実際の経過日数は別途ここで計算する）。
 * 期間が上場前をカバーする等で開始点が見つからない場合はnullを返す。
 */
export function periodSpanDays(daily: StockDataPoint[], period: PeriodKey, asOfDate?: string): number | null {
  if (!daily.length) return null;
  let endIdx = daily.length - 1;
  if (asOfDate) {
    const idx = daily.findIndex((p) => p.date > asOfDate);
    endIdx = idx === -1 ? daily.length - 1 : idx - 1;
  }
  if (endIdx < 0) return null;
  const cutoff = cutoffDate(period, new Date(`${daily[endIdx].date}T00:00:00Z`));
  const startIdx = cutoff ? daily.findIndex((p) => p.date >= cutoff.toISOString().slice(0, 10)) : 0;
  if (startIdx === -1 || startIdx > endIdx) return null;
  const startDate = new Date(`${daily[startIdx].date}T00:00:00Z`);
  const endDate = new Date(`${daily[endIdx].date}T00:00:00Z`);
  return Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 86400000));
}

// ---- グラフ作成ページ専用：複数年セットの「全部重ね描き」選択肢 ----
// lib/videoCustomScene.tsのbuildSeriesCatalog（長尺動画作成のAIカスタム場面機能と共用）自体は変更しない。
// AIに渡す候補キー一覧に「線がptsではなくlinePathsにしかない」エントリが混ざると、AIがそれを選んだ場合に
// 折れ線（pts）が空の場面を生成してしまう恐れがあるため、この機能はグラフ作成ページ専用に別立てで追加する。

export interface ChartStudioCatalogEntry extends SeriesCatalogEntry {
  /** 複数年を白線で重ね描きする系列のみ：各年の個別の推移（{t,v}[]を年の数だけ）。通常の系列ではundefined。 */
  linePaths?: { t: number; v: number }[][];
}
export type ChartStudioCatalog = Record<string, ChartStudioCatalogEntry>;

/** 「○○の平均」「○○平均」のようなラベルから「平均」を取り除いた、重ね描き版の表示名を作る（例：「全期間（68年）平均」→「全期間（68年）」）。 */
function stripAverageSuffix(label: string): string {
  return label.replace(/の?平均$/, '');
}

/**
 * buildSeriesCatalog()の複数年セット（cyclePos1〜4・recent5/10/15/20・allYears）それぞれについて、
 * 同じ年群を1本1本そのまま重ね描きする「<キー>_all」エントリ（linePathsのみ・ptsは空）を追加したカタログを作る。
 * 個々の年の推移はbuildSeriesCatalog()が既に計算済みのy{year}エントリをそのまま使い回す（二重計算しない）。
 * ドロップダウンでの見え方：各「平均」の選択肢のすぐ後ろに、同じ年群の「重ね描き」の選択肢が並ぶ。
 */
export function buildChartStudioCatalog(daily: StockDataPoint[], curYear: number, asOfDate: string): ChartStudioCatalog {
  const base = buildSeriesCatalog(daily, curYear, asOfDate);
  const confirmedYears = Object.keys(base)
    .map((k) => /^y(\d{4})$/.exec(k))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b);
  const pathsOf = (years: number[]) => years.map((y) => base[`y${y}`].pts);
  const groupYears: Record<string, number[]> = {
    cyclePos1: confirmedYears.filter((y) => presidentialTermYear(y) === 1),
    cyclePos2: confirmedYears.filter((y) => presidentialTermYear(y) === 2),
    cyclePos3: confirmedYears.filter((y) => presidentialTermYear(y) === 3),
    cyclePos4: confirmedYears.filter((y) => presidentialTermYear(y) === 4),
    recent5: confirmedYears.slice(-5),
    recent10: confirmedYears.slice(-10),
    recent15: confirmedYears.slice(-15),
    recent20: confirmedYears.slice(-20),
    allYears: confirmedYears,
  };

  const catalog: ChartStudioCatalog = {};
  for (const [key, entry] of Object.entries(base)) {
    catalog[key] = entry;
    const years = groupYears[key];
    if (years && years.length) {
      catalog[`${key}_all`] = { label: stripAverageSuffix(entry.label), pts: [], linePaths: pathsOf(years) };
    }
  }
  return catalog;
}

