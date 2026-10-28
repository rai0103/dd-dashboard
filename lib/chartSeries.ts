// グラフ作成ページ（/chart-studio/）用：期間指定での正規化（開始時点=100）パス生成、およびCSV行→StockDataPoint変換。
// 複数年セット（中間選挙年の平均・直近10年平均等）は、長尺動画作成が使っていたlib/videoCustomScene.tsの
// buildSeriesCatalog()をそのまま再利用する（ここでは再実装しない）。
import { StockDataPoint } from './videoTypes';

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
 * 日次終値（dailyは日付文字列昇順を前提）を、指定期間の開始時点を100とした{t,v}[]に変換する。
 * - t：0（期間開始）〜1（期間終端）の、データ点インデックスに基づく経過割合（日数そのものではない＝等間隔描画になる）
 * - v：開始時点の終値を100とした指数値
 * asOfDate（"YYYY-MM-DD"）を渡すと、その日以前で最も新しい点を終端として扱う（省略時はdailyの最終点）。
 * 期間の開始点が見つからない（上場前で全期間カバー外等）場合は空配列を返す。
 */
export function periodPath(daily: StockDataPoint[], period: PeriodKey, asOfDate?: string): { t: number; v: number }[] {
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
  const out: { t: number; v: number }[] = [];
  for (let i = startIdx; i <= endIdx; i++) out.push({ t: (i - startIdx) / span, v: (daily[i].close / base) * 100 });
  return out;
}

/** Stooq CSVパース結果（lib/csvPrice.tsのparseStooqCSV、{date:Date,price:number}[]・日付昇順）→StockDataPoint[] */
export function csvRowsToStockDataPoints(rows: { date: Date; price: number }[]): StockDataPoint[] {
  return rows.map((r) => ({ date: r.date.toISOString().slice(0, 10), close: r.price }));
}
