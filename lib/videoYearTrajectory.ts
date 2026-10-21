// 長尺動画のナレーション計算（videoMarketUpdate.ts）が使う「ある1年の推移（前年末=100）」計算。
// investment-shorts (lib/yearCompare.ts) の buildYearSeries/YearPoint のみを抽出・移植（それ以外の年比較動画専用ロジックは対象外）。
// 注意：dd-dashboard本体の lib/yearCompare.ts（複数年をMapで返す別仕様）とは無関係・無関係な名前衝突を避けるため別ファイルに分離。
import { StockDataPoint } from './videoTypes';

export interface YearPoint {
  t: number;      // 0〜1（1月1日〜12月31日。月ごとに等間隔）
  v: number;      // 前年末終値 = 100 とした指数
  date: string;
}

export interface YearSeries {
  year: number;
  label: string;
  points: YearPoint[];
  ret: number;        // 騰落率（%）
  lastDate: string;   // 最後のデータ日
  isCurrent: boolean;
}

const daysInMonth = (y: number, m: number) => new Date(y, m, 0).getDate();

export function buildYearSeries(daily: StockDataPoint[], year: number, label: string, lastDate: string): YearSeries | null {
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;
  let prevEnd: number | null = null;
  const inYear: StockDataPoint[] = [];
  for (const d of daily) {
    if (d.date < start) prevEnd = d.close;
    else if (d.date <= end) inYear.push(d);
    else break;
  }
  if (prevEnd === null || inYear.length === 0) return null;

  const points: YearPoint[] = [{ t: 0, v: 100, date: `${year - 1}-12-31` }];
  for (const d of inYear) {
    const m = parseInt(d.date.slice(5, 7), 10);
    const day = parseInt(d.date.slice(8, 10), 10);
    const t = ((m - 1) + (day - 1) / daysInMonth(year, m)) / 12;
    points.push({ t, v: (d.close / prevEnd) * 100, date: d.date });
  }
  const last = points[points.length - 1];
  return { year, label, points, ret: last.v - 100, lastDate: last.date, isCurrent: last.date === lastDate && lastDate < `${year}-12-20` };
}
