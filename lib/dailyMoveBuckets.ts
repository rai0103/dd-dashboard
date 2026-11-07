// [動画連携][Stage E-13] 1日の騰落率を1%刻みのレンジに分類し、各レンジについて「その後」のリターン
// （指定した営業日数後）を集計する。手法は過去に作成したレポート（dd-dashboard/sp500-daily-move-bucket-report.md、
// プロジェクトに保存済み）と同じ考え方：絶対値で1%刻みに分類し、その日を起点とした複数ホライズンの
// その後のリターンを平均・中央値・プラスだった割合で示す。実データから機械的に計算し、AIに数値を
// 作文させない（accelSensor.ts・rollingReturn.tsと同じ方針）。
import { prepareSeries } from './accelSensor.ts';

export interface MoveBucket { label: string; min: number; max: number | null }
export const DEFAULT_MOVE_BUCKETS: MoveBucket[] = [
  { label: '1〜2%', min: 1, max: 2 },
  { label: '2〜3%', min: 2, max: 3 },
  { label: '3〜4%', min: 3, max: 4 },
  { label: '4〜5%', min: 4, max: 5 },
  { label: '5%超', min: 5, max: null },
];
export const DEFAULT_MOVE_HORIZONS: number[] = [1, 5, 20, 60];

export interface MoveHorizonStats { horizonDays: number; n: number; mean: number | null; median: number | null; winRate: number | null }
export interface MoveBucketStats extends MoveBucket { n: number; perYear: number; horizons: MoveHorizonStats[] }
export interface DailyMoveBucketSummary {
  periodStart: string | null; periodEnd: string | null; periodYears: number;
  direction: 'down' | 'up';
  buckets: MoveBucketStats[];
}

export function summarizeDailyMoveBucketsForVideo(
  points: { date: string | Date; close?: number | null; price?: number | null }[],
  opts: { direction?: 'down' | 'up'; buckets?: MoveBucket[]; horizonsDays?: number[] } = {},
): DailyMoveBucketSummary | null {
  const series = prepareSeries(points);
  if (series.length < 2) return null;
  const direction = opts.direction ?? 'down';
  const buckets = opts.buckets ?? DEFAULT_MOVE_BUCKETS;
  const horizonsDays = opts.horizonsDays ?? DEFAULT_MOVE_HORIZONS;

  // 日次騰落率（%）。index 0は基準日が無いため計算しない。
  const rets: (number | null)[] = [null];
  for (let i = 1; i < series.length; i++) rets.push((series[i].close / series[i - 1].close - 1) * 100);

  const periodYears = (new Date(series[series.length - 1].date).getTime() - new Date(series[0].date).getTime()) / (365.2425 * 24 * 3600 * 1000);

  const bucketStats: MoveBucketStats[] = buckets.map((b) => {
    const idxs: number[] = [];
    for (let i = 1; i < series.length; i++) {
      const r = rets[i] as number;
      const match = direction === 'down' ? r < 0 : r > 0;
      if (!match) continue;
      const abs = Math.abs(r);
      if (abs >= b.min && (b.max == null || abs < b.max)) idxs.push(i);
    }
    const horizons = horizonsDays.map((h) => {
      const vals: number[] = [];
      for (const i of idxs) {
        const j = i + h;
        if (j < series.length) vals.push(Math.round((series[j].close / series[i].close - 1) * 1000) / 10);
      }
      const n = vals.length;
      const mean = n ? vals.reduce((a, c) => a + c, 0) / n : null;
      const sorted = [...vals].sort((a, c) => a - c);
      const median = n ? (n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2) : null;
      const winRate = n ? vals.filter((x) => x > 0).length / n : null;
      return { horizonDays: h, n, mean: mean != null ? Math.round(mean * 10) / 10 : null, median, winRate };
    });
    return { ...b, n: idxs.length, perYear: periodYears > 0 ? Math.round((idxs.length / periodYears) * 10) / 10 : 0, horizons };
  });

  return {
    periodStart: series[0].date, periodEnd: series[series.length - 1].date, periodYears: Math.round(periodYears * 10) / 10,
    direction, buckets: bucketStats,
  };
}
