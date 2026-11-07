// [動画連携][Stage E-14] 類似局面サーチ：直近の値動きの「指紋」（1・10・30・90・180・252営業日前を基準とした
// トレーリングリターン）を作り、過去の全日について同じ指紋を計算し、各基準点が±0.5%以内に収まる日だけを
// 候補として絞り込む（基準点を1つずつ追加していく「絞り込みの過程＝ファネル」も返す）。絞り込んだ候補は、
// 近接した日（同じ局面の重複）をまとめて最良の1件に代表させてから返す。実データから機械的に計算し、
// AIに数値を作文させない（accelSensor.ts等と同じ方針）。
import { prepareSeries } from './accelSensor.ts';

export interface AnalogCheckpoint { label: string; lookbackDays: number }
export const DEFAULT_ANALOG_CHECKPOINTS: AnalogCheckpoint[] = [
  { label: '1日前', lookbackDays: 1 },
  { label: '10日前', lookbackDays: 10 },
  { label: '30日前', lookbackDays: 30 },
  { label: '90日前', lookbackDays: 90 },
  { label: '180日前', lookbackDays: 180 },
  { label: '252日前', lookbackDays: 252 },
];
export const DEFAULT_ANALOG_TOLERANCE_PCT = 0.5; // ±0.5ポイント

export interface AnalogFunnelStep { label: string; lookbackDays: number; targetPct: number; remaining: number }
export interface AnalogMatch {
  idx: number; date: string;
  checkpointPct: number[]; // 各基準点での実際の値（%）。targetとの差の合計がdistance
  distance: number; // 各基準点での |実際-target| の合計（小さいほど近い）
  forward: { date: string; pct: number }[]; // 一致日を0%とした、その後の値動き（データが続く限り・最大forwardMaxDaysまで）
}
export interface AnalogFinderResult {
  asOfDate: string | null;
  checkpointTargets: { label: string; lookbackDays: number; targetPct: number }[];
  funnel: AnalogFunnelStep[];
  matches: AnalogMatch[]; // 重複排除・distance昇順（同点は時系列順）・上位maxMatches件
  /** 「今」を0%とした直近leadInDays営業日分の値動き（x<=0、将来予測チャートの「ここまでの経緯」に使う） */
  currentPath: { x: number; pct: number }[];
}

export function findHistoricalAnalogs(
  points: { date: string | Date; close?: number | null; price?: number | null }[],
  opts: {
    checkpoints?: AnalogCheckpoint[];
    tolerancePct?: number;
    maxMatches?: number;
    /** 近接した候補を同じ局面とみなして間引く間隔（営業日）。小さいほうの距離を優先して残す */
    minClusterGapDays?: number;
    /** 一致日から先、将来予測チャート用に持たせる「その後」の長さ（営業日・データが続く範囲まで） */
    forwardMaxDays?: number;
    /** 「今」に近すぎる日を候補から除く間隔（営業日）。既定は基準点の最長ルックバック
     * （候補の一番長い窓が「今」の窓と全く重ならないようにする） */
    excludeRecentDays?: number;
    /** 将来予測チャートの「ここまでの経緯」として持たせる、今より前の日数。既定は基準点の最長ルックバック */
    leadInDays?: number;
  } = {},
): AnalogFinderResult | null {
  const series = prepareSeries(points);
  const checkpoints = opts.checkpoints ?? DEFAULT_ANALOG_CHECKPOINTS;
  const tolerance = opts.tolerancePct ?? DEFAULT_ANALOG_TOLERANCE_PCT;
  const maxMatches = opts.maxMatches ?? 20;
  const minClusterGapDays = opts.minClusterGapDays ?? 20;
  const forwardMaxDays = opts.forwardMaxDays ?? 252;
  const maxLookback = Math.max(...checkpoints.map((c) => c.lookbackDays));
  const excludeRecentDays = opts.excludeRecentDays ?? maxLookback;

  const todayIdx = series.length - 1;
  if (todayIdx < maxLookback) return null; // 基準点を全部計算できるだけの履歴が無い

  const pctAt = (idx: number, lookback: number): number | null => {
    const j = idx - lookback;
    if (j < 0) return null;
    return Math.round((series[idx].close / series[j].close - 1) * 1000) / 10;
  };

  const rawTargets = checkpoints.map((cp) => ({ ...cp, targetPct: pctAt(todayIdx, cp.lookbackDays) }));
  if (rawTargets.some((t) => t.targetPct == null)) return null;
  const targets = rawTargets as { label: string; lookbackDays: number; targetPct: number }[];

  const minIdx = maxLookback; // 候補日自身も全基準点を計算できる必要がある
  const maxCandidateIdx = todayIdx - excludeRecentDays;
  let candidates: number[] = [];
  for (let i = minIdx; i <= maxCandidateIdx; i++) candidates.push(i);

  const funnel: AnalogFunnelStep[] = [];
  for (const cp of targets) {
    candidates = candidates.filter((i) => {
      const v = pctAt(i, cp.lookbackDays);
      return v != null && Math.abs(v - cp.targetPct) <= tolerance;
    });
    funnel.push({ label: cp.label, lookbackDays: cp.lookbackDays, targetPct: cp.targetPct, remaining: candidates.length });
  }

  const scored = candidates
    .map((i) => {
      const checkpointPct = targets.map((cp) => pctAt(i, cp.lookbackDays) as number);
      const distance = Math.round(targets.reduce((sum, cp, k) => sum + Math.abs(checkpointPct[k] - cp.targetPct), 0) * 10) / 10;
      return { idx: i, distance, checkpointPct };
    })
    .sort((a, b) => a.distance - b.distance);

  const picked: typeof scored = [];
  for (const cand of scored) {
    if (picked.some((p) => Math.abs(p.idx - cand.idx) < minClusterGapDays)) continue;
    picked.push(cand);
    if (picked.length >= maxMatches) break;
  }

  const matches: AnalogMatch[] = picked.map((p) => {
    const base = series[p.idx].close;
    const forward: { date: string; pct: number }[] = [];
    for (let k = 0; k <= forwardMaxDays; k++) {
      const j = p.idx + k;
      if (j > todayIdx) break; // 実際に存在するデータの範囲まで（それ以上先は誰にも分からない）
      forward.push({ date: series[j].date, pct: Math.round((series[j].close / base - 1) * 1000) / 10 });
    }
    return { idx: p.idx, date: series[p.idx].date, checkpointPct: p.checkpointPct, distance: p.distance, forward };
  });

  const leadInDays = opts.leadInDays ?? maxLookback;
  const currentPath: { x: number; pct: number }[] = [];
  for (let k = -leadInDays; k <= 0; k++) {
    const j = todayIdx + k;
    if (j < 0) continue;
    currentPath.push({ x: k, pct: Math.round((series[j].close / series[todayIdx].close - 1) * 1000) / 10 });
  }

  return { asOfDate: series[todayIdx].date, checkpointTargets: targets, funnel, matches, currentPath };
}
