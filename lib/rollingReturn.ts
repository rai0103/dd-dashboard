// [動画連携][Stage E-12] 保有期間別のローリングリターン（年始点サンプル）。
// 各年の最初の営業日を基準点とし、そこから指定した保有期間（営業日換算）だけ進んだ時点までの
// リターンを1標本とする。日次の重なり窓（毎日を起点にするローリングウィンドウ）だと標本同士が
// 強く相関し、ビーズウォーム表示が「点の集まり」ではなく「太い帯」になってしまうため、年単位で
// 独立性の高い標本を取る（過去n年の全期間なら最大n標本・保有期間が長いほど末尾の数年分は標本化できない）。
// accelSensor.tsと同じ方針：実データから機械的に計算し、AIに数値を作文させない。
import { prepareSeries } from './accelSensor.ts';

export interface RollingPeriod { label: string; tradingDays: number }
export const DEFAULT_ROLLING_PERIODS: RollingPeriod[] = [
  { label: '1ヶ月', tradingDays: 21 },
  { label: '3ヶ月', tradingDays: 63 },
  { label: '6ヶ月', tradingDays: 126 },
  { label: '1年', tradingDays: 252 },
];

export interface RollingReturnGroup {
  label: string; tradingDays: number;
  samples: number[]; // 各標本のリターン（%、小数点1桁）
  n: number; winRate: number | null; mean: number | null; median: number | null;
}
export interface RollingReturnSummary {
  periodStart: string | null; periodEnd: string | null; periodYears: number;
  groups: RollingReturnGroup[];
}

export function summarizeRollingReturnsForVideo(
  points: { date: string | Date; close?: number | null; price?: number | null }[],
  periods: RollingPeriod[] = DEFAULT_ROLLING_PERIODS,
): RollingReturnSummary | null {
  const series = prepareSeries(points);
  if (series.length < 2) return null;
  // 年ごとの最初の営業日のインデックスを求める（基準点候補）
  const yearStartIdx: number[] = [];
  let lastYear = '';
  for (let i = 0; i < series.length; i++) {
    const y = series[i].date.slice(0, 4);
    if (y !== lastYear) { yearStartIdx.push(i); lastYear = y; }
  }
  const groups: RollingReturnGroup[] = periods.map((p) => {
    const samples: number[] = [];
    for (const idx of yearStartIdx) {
      const j = idx + p.tradingDays;
      if (j < series.length) samples.push(Math.round((series[j].close / series[idx].close - 1) * 1000) / 10);
    }
    const n = samples.length;
    const winRate = n ? samples.filter((s) => s > 0).length / n : null;
    const mean = n ? samples.reduce((a, b) => a + b, 0) / n : null;
    const sorted = [...samples].sort((a, b) => a - b);
    const median = n ? (n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2) : null;
    return { label: p.label, tradingDays: p.tradingDays, samples, n, winRate, mean: mean != null ? Math.round(mean * 10) / 10 : null, median };
  });
  const periodYears = (new Date(series[series.length - 1].date).getTime() - new Date(series[0].date).getTime()) / (365.2425 * 24 * 3600 * 1000);
  return {
    periodStart: series[0].date, periodEnd: series[series.length - 1].date, periodYears: Math.round(periodYears * 10) / 10,
    groups,
  };
}
