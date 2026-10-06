// 加速度センサー：日次終値の時系列から「調整エピソード」を抽出し、DD−3%→−5%の到達速度（acc）ごとに、
// その後の最終的な最大下落（maxDD）が深くなった割合を過去の標本から算出する。VOO・QQQなど任意のシリーズに同じ関数を使う。
// 既存の「DD加速度アラート」（SP500の統計を流用・ATH回復までを1局面とする定義）とは別の機能で、そちらには影響しない。
//
// 定義（日数はすべて営業日＝データ行数。休場日の補間はしない）：
//   1. 基準高値（peak）：エピソード外では終値の最高値を更新し続ける。
//   2. 開始：DD = 1 − 終値/peak が startDD（3%）以上になった最初の日（i3）。この日から最安値・最大DDの更新を始める。
//   3. 進行中：最大DD（maxDD）を更新し、DDが judgeDD（5%）以上になった最初の日を i5 とする。
//      ギャップダウンで i3 の当日に5%以上に達していれば i5 = i3（acc = 0）。
//   4. 終了：終値がpeak以上（高値更新）、またはDDが maxDD × recoveryRatio（半値戻し）以下まで戻った日。終了時にpeakを当日の終値にリセットする。
//   5. 終了していない最新のエピソードは標本に含めず「進行中」として別に返す。
//   acc = i5 − i3（judgeDDに達したエピソードのみ）。
// 統計：母集団はjudgeDDに達した終了済みエピソード。accバケットごと・全体で、maxDDが各しきい値以上だった割合・標本数・Wilson信頼区間を出す。
// 標本はデータから毎回再計算する（固定値は埋め込まない）。このファイルは外部importを持たないため、`node --test` から直接実行できる。

export interface AccelBucket { label: string; min: number; max: number }
export interface AccelConfig {
  startDD: number; // エピソード開始のDD（0.03＝3%）
  judgeDD: number; // 判定のDD（0.05＝5%）
  recoveryRatio: number; // 半値戻しの係数（0.5）
  buckets: AccelBucket[]; // accの区分（営業日）
  thresholds: number[]; // 最終maxDDのしきい値
  minSample: number; // これ未満の標本数は「標本が少ない」と警告する
  z: number; // Wilson信頼区間のz値（1.96＝95%）
}
export const DEFAULT_ACCEL_CONFIG: AccelConfig = {
  startDD: 0.03,
  judgeDD: 0.05,
  recoveryRatio: 0.5,
  buckets: [{ label: "0〜3日（高速）", min: 0, max: 3 }, { label: "4日以上（低速）", min: 4, max: Infinity }],
  thresholds: [0.08, 0.10, 0.15, 0.20],
  minSample: 30,
  z: 1.96,
};

export interface PricePoint { date: string; close: number } // date: YYYY-MM-DD
export interface AccelEpisode {
  peakDate: string; peak: number;
  startIdx: number; startDate: string; // i3
  judgeIdx: number | null; judgeDate: string | null; // i5
  acc: number | null; // i5 − i3
  maxDD: number; troughDate: string;
  endDate: string | null; endReason: "newHigh" | "halfRetrace" | null; // 進行中はnull
}

// 入力の整形：日付の重複は後勝ちで除去し、終値が数値でない行（欠損）を除いて日付順に並べる。
export function prepareSeries(points: { date: string | Date; close?: number | null; price?: number | null }[]): PricePoint[] {
  const byDate = new Map<string, number>();
  for (const p of points) {
    const v = p.close ?? p.price;
    if (v == null || !Number.isFinite(v) || v <= 0) continue;
    const d = p.date instanceof Date ? p.date.toISOString().slice(0, 10) : String(p.date).slice(0, 10);
    byDate.set(d, v);
  }
  return [...byDate].map(([date, close]) => ({ date, close })).sort((a, b) => a.date.localeCompare(b.date));
}

export function extractEpisodes(series: PricePoint[], cfg: AccelConfig = DEFAULT_ACCEL_CONFIG): { episodes: AccelEpisode[]; current: AccelEpisode | null; peak: number | null; peakDate: string | null } {
  const episodes: AccelEpisode[] = [];
  if (!series.length) return { episodes, current: null, peak: null, peakDate: null };
  let peak = series[0].close, peakDate = series[0].date;
  let ep: AccelEpisode | null = null;
  for (let i = 0; i < series.length; i++) {
    const { date, close } = series[i];
    if (!ep) {
      if (close > peak) { peak = close; peakDate = date; continue; }
      const dd = 1 - close / peak;
      if (dd >= cfg.startDD) {
        const judged = dd >= cfg.judgeDD; // ギャップダウンで同日に判定水準へ達した場合は i5 = i3（acc = 0）
        ep = { peakDate, peak, startIdx: i, startDate: date, judgeIdx: judged ? i : null, judgeDate: judged ? date : null, acc: judged ? 0 : null, maxDD: dd, troughDate: date, endDate: null, endReason: null };
      }
      continue;
    }
    const dd = 1 - close / ep.peak;
    if (dd > ep.maxDD) { ep.maxDD = dd; ep.troughDate = date; }
    if (ep.judgeIdx === null && dd >= cfg.judgeDD) { ep.judgeIdx = i; ep.judgeDate = date; ep.acc = i - ep.startIdx; }
    const newHigh = close >= ep.peak;
    if (newHigh || dd <= ep.maxDD * cfg.recoveryRatio) {
      ep.endDate = date; ep.endReason = newHigh ? "newHigh" : "halfRetrace";
      episodes.push(ep);
      ep = null;
      peak = close; peakDate = date; // 終了時に基準高値を当日の終値へリセット
    }
  }
  return { episodes, current: ep, peak: ep ? ep.peak : peak, peakDate: ep ? ep.peakDate : peakDate };
}

// Wilson信頼区間（二項比率）。n=0ならnull。
export function wilsonInterval(k: number, n: number, z = 1.96): [number, number] | null {
  if (n <= 0) return null;
  const p = k / n, z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

export interface AccelRate { threshold: number; hits: number; p: number | null; ci: [number, number] | null }
export interface AccelGroupStats { label: string; n: number; rates: AccelRate[]; lowSample: boolean }
export interface AccelStats {
  periodStart: string | null; periodEnd: string | null; // 標本に使った期間（シリーズの先頭日〜最終日）
  episodeCount: number; // 終了済みエピソード数（DD−3%以上）
  judgedCount: number; // そのうちDD−5%に到達した数（母集団）
  overall: AccelGroupStats;
  buckets: (AccelGroupStats & AccelBucket)[];
  accMedian: number | null; accMax: number | null;
}
function groupStats(label: string, eps: AccelEpisode[], cfg: AccelConfig): AccelGroupStats {
  const n = eps.length;
  return {
    label, n, lowSample: n < cfg.minSample,
    rates: cfg.thresholds.map((t) => { const hits = eps.filter((e) => e.maxDD >= t - 1e-12).length; return { threshold: t, hits, p: n ? hits / n : null, ci: wilsonInterval(hits, n, cfg.z) }; }),
  };
}
export function computeAccelStats(series: PricePoint[], episodes: AccelEpisode[], cfg: AccelConfig = DEFAULT_ACCEL_CONFIG): AccelStats {
  const judged = episodes.filter((e) => e.acc !== null);
  const accs = judged.map((e) => e.acc as number).sort((a, b) => a - b);
  const median = accs.length ? (accs.length % 2 ? accs[(accs.length - 1) / 2] : (accs[accs.length / 2 - 1] + accs[accs.length / 2]) / 2) : null;
  return {
    periodStart: series[0]?.date ?? null, periodEnd: series[series.length - 1]?.date ?? null,
    episodeCount: episodes.length, judgedCount: judged.length,
    overall: groupStats("全体", judged, cfg),
    buckets: cfg.buckets.map((b) => ({ ...b, ...groupStats(b.label, judged.filter((e) => (e.acc as number) >= b.min && (e.acc as number) <= b.max), cfg) })),
    accMedian: median, accMax: accs.length ? accs[accs.length - 1] : null,
  };
}

export type AccelStatus = "normal" | "over3" | "reached5";
export interface AccelState {
  status: AccelStatus;
  currentDD: number | null; // 基準高値からの現在のDD（0.031＝3.1%）
  peak: number | null; peakDate: string | null;
  startDate: string | null; elapsedDays: number | null; // −3%到達日・そこからの経過営業日
  judgeDate: string | null; acc: number | null;
  maxDD: number | null;
  bucket: AccelBucket | null; bucketFixed: boolean; // 判定バケット（−5%到達前でも、残りの可能性が1つに絞れれば「到達時はこのバケット」として示す）
  remainingToJudge: number | null; // −3%〜−5%の間：あと何%で判定か（0.012＝1.2%）
}
export function currentAccelState(series: PricePoint[], extracted: ReturnType<typeof extractEpisodes>, cfg: AccelConfig = DEFAULT_ACCEL_CONFIG): AccelState {
  const last = series[series.length - 1];
  const base: AccelState = { status: "normal", currentDD: null, peak: extracted.peak, peakDate: extracted.peakDate, startDate: null, elapsedDays: null, judgeDate: null, acc: null, maxDD: null, bucket: null, bucketFixed: false, remainingToJudge: null };
  if (!last || extracted.peak == null) return base;
  const currentDD = Math.max(0, 1 - last.close / extracted.peak);
  const ep = extracted.current;
  if (!ep) return { ...base, currentDD };
  const elapsedDays = series.length - 1 - ep.startIdx;
  const common = { ...base, currentDD, startDate: ep.startDate, elapsedDays, maxDD: ep.maxDD };
  if (ep.acc !== null) {
    const bucket = cfg.buckets.find((b) => (ep.acc as number) >= b.min && (ep.acc as number) <= b.max) ?? null;
    return { ...common, status: "reached5", judgeDate: ep.judgeDate, acc: ep.acc, bucket, bucketFixed: true };
  }
  // まだ−5%未到達：これから到達した場合のaccは elapsedDays+1 以上。候補のバケットが1つなら「到達時はそのバケット」と確定できる。
  const candidates = cfg.buckets.filter((b) => b.max >= elapsedDays + 1);
  return { ...common, status: "over3", bucket: candidates.length === 1 ? candidates[0] : null, bucketFixed: false, remainingToJudge: Math.max(0, cfg.judgeDD - currentDD) };
}

// まとめて計算する（画面用）。
export function computeAccelSensor(points: { date: string | Date; close?: number | null; price?: number | null }[], cfg: AccelConfig = DEFAULT_ACCEL_CONFIG) {
  const series = prepareSeries(points);
  const extracted = extractEpisodes(series, cfg);
  return { series, extracted, stats: computeAccelStats(series, extracted.episodes, cfg), state: currentAccelState(series, extracted, cfg), config: cfg };
}
