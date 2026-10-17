// 年騰落率予測：直近10年平均・前年類似年の翌年平均・大統領サイクル平均・当年月末時点類似年、の4つの実績統計から
// 今年の年末までの騰落率を予想する。各指標は「ある年Yの予測」を、Y年より前のデータだけを使って計算できる関数として実装し
// （ルックアヘッド無し）、過去の確定年に遡って「その指標が過去にどれだけ当たっていたか（符号一致率）」を検証し、
// その一致率を指標ごとの重みとして使う加重平均で総合予測値を出す（単純平均ではない）。月末時点類似年（4番目の指標）は
// 月が進むほど一致率が上がる傾向があるため、同じ仕組み（指標ごとの符号一致率バックテスト）が自然に月ごとの精度差を
// 重みに反映する。
// このファイルはlib/yearCompare.ts（外部importを持たない純粋関数のみで構成）だけをimportし、
// `node --test`から直接実行できるようにしている。
import { buildYearSeries, presidentialTermYear, type YearSeries } from "./yearCompare.ts";

export interface FactorResult {
  forecastPct: number; // 予測値（年間騰落率、%。例: 9.2）
  probability: number; // 参照年のうち上昇した年の割合（0〜1）
  refYears: { year: number; return: number }[]; // 根拠とした参照年とその騰落率（%）
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const posShare = (xs: number[]) => xs.filter((x) => x > 0).length / xs.length;

function toResult(refYears: { year: number; return: number }[]): FactorResult {
  const rets = refYears.map((r) => r.return);
  return { forecastPct: avg(rets), probability: posShare(rets), refYears };
}

// 年ごとの年間騰落率（%）。前年末終値=100とした指数（buildYearSeriesのindex）の、その年最終時点の値-100。
// 前年データが無い年（履歴の最初の年等）は年初の最初の終値=100を基準にする（buildYearSeriesの仕様通り）。
// 進行中の年（今年）も最新時点までの「現時点のYTD」としてそのまま含まれるが、以下の4指標はいずれも
// 予測対象の年より前の年だけを参照年として使うため、進行中の年の値が参照年として誤用されることはない。
export function buildAnnualReturns(FULL: { date: string; price: number }[]): Map<number, number> {
  const series = buildYearSeries(FULL.map((p) => ({ date: p.date, price: p.price })));
  const out = new Map<number, number>();
  for (const [year, pts] of series) {
    if (!pts.length) continue;
    out.set(year, pts[pts.length - 1].index - 100);
  }
  return out;
}

// 1. 直近10年平均：yearより前の直近n年の年間騰落率の平均。
export function recentNYearAverage(returns: Map<number, number>, year: number, n = 10): FactorResult | null {
  const refYears: { year: number; return: number }[] = [];
  for (let y = year - 1; y >= year - n; y--) {
    const r = returns.get(y);
    if (r == null) continue;
    refYears.push({ year: y, return: r });
  }
  if (refYears.length < Math.min(n, 3)) return null; // データ不足
  refYears.sort((a, b) => a.year - b.year);
  return toResult(refYears);
}

// 2. 前年類似年の翌年平均：前年(year-1)の騰落率に近い過去の確定年z（zの翌年z+1がyear未満）を最大k件選び、
//    各z+1年の騰落率の平均を予測値とする。
export function similarPriorYearFollowing(returns: Map<number, number>, year: number, k = 8, minK = 5): FactorResult | null {
  const prior = returns.get(year - 1);
  if (prior == null) return null;
  const candidates: { z: number; dist: number; followReturn: number }[] = [];
  for (const [z, rz] of returns) {
    if (z >= year - 1) continue; // 前年自身・それ以降は候補から除外
    const follow = returns.get(z + 1);
    if (follow == null || z + 1 >= year) continue; // 翌年のデータが無い／今年以降はルックアヘッドになるため除外
    candidates.push({ z, dist: Math.abs(rz - prior), followReturn: follow });
  }
  if (candidates.length < Math.min(minK, 3)) return null;
  candidates.sort((a, b) => a.dist - b.dist);
  const chosen = candidates.slice(0, Math.max(Math.min(minK, candidates.length), Math.min(k, candidates.length)));
  const refYears = chosen.map((c) => ({ year: c.z + 1, return: c.followReturn })).sort((a, b) => a.year - b.year);
  return toResult(refYears);
}

// 3. 大統領サイクル平均：yearと同じサイクル区分（4=大統領選挙年／2=中間選挙年／1,3=その他）の、
//    yearより前の確定年の平均。
export function presidentialCycleAverage(returns: Map<number, number>, year: number): FactorResult | null {
  const pos = presidentialTermYear(year);
  const refYears: { year: number; return: number }[] = [];
  for (const [y, r] of returns) {
    if (y >= year) continue;
    if (presidentialTermYear(y) === pos) refYears.push({ year: y, return: r });
  }
  if (refYears.length < 3) return null;
  refYears.sort((a, b) => a.year - b.year);
  return toResult(refYears);
}

// 指定した年のasOfMonth月末時点のYTD騰落率（%）。その月以前の最終営業日のindex-100。該当データが無ければnull。
// （asOfMonthより後の月のデータが series に含まれていても、ここでの絞り込みにより参照しない＝ルックアヘッド無し）
function ytdAtMonthEnd(series: YearSeries, year: number, asOfMonth: number): number | null {
  const pts = series.get(year);
  if (!pts || !pts.length) return null;
  const inRange = pts.filter((p) => Number(p.date.slice(5, 7)) <= asOfMonth);
  if (!inRange.length) return null;
  return inRange[inRange.length - 1].index - 100;
}

// 4. 当年月末時点類似年：yearのasOfMonth月末時点のYTD騰落率に近い過去の確定年（yearより前）を最大k件選び、
//    それらの年間騰落率の平均を予測値とする。
export function monthEndAnalogForecast(FULL: { date: string; price: number }[], year: number, asOfMonth: number, k = 8, minK = 5): FactorResult | null {
  const series = buildYearSeries(FULL.map((p) => ({ date: p.date, price: p.price })));
  const currentYtd = ytdAtMonthEnd(series, year, asOfMonth);
  if (currentYtd == null) return null;
  const candidates: { z: number; dist: number; fullReturn: number }[] = [];
  for (const [z, pts] of series) {
    if (z >= year || !pts.length) continue;
    const zYtd = ytdAtMonthEnd(series, z, asOfMonth);
    if (zYtd == null) continue;
    candidates.push({ z, dist: Math.abs(zYtd - currentYtd), fullReturn: pts[pts.length - 1].index - 100 });
  }
  if (candidates.length < Math.min(minK, 3)) return null;
  candidates.sort((a, b) => a.dist - b.dist);
  const chosen = candidates.slice(0, Math.max(Math.min(minK, candidates.length), Math.min(k, candidates.length)));
  const refYears = chosen.map((c) => ({ year: c.z, return: c.fullReturn })).sort((a, b) => a.year - b.year);
  return toResult(refYears);
}

export type FactorKey = "recent10" | "similarPrior" | "cycle" | "monthEnd";

const FACTOR_LABELS: Record<FactorKey, string> = {
  recent10: "直近10年平均",
  similarPrior: "前年類似年の翌年平均",
  cycle: "大統領サイクル平均",
  monthEnd: "当年月末時点類似年",
};

// 各指標の予測精度（符号一致率）をバックテストする。十分なデータがある全ての過去確定年Yについて、
// その指標がYの予測に使っていたであろう符号（forecastPctの正負）と、Yの実際の騰落率の符号を比較する。
function backtestAccuracy(predict: (y: number) => FactorResult | null, returns: Map<number, number>, years: number[]): { hitRate: number; n: number } {
  let hit = 0, n = 0;
  for (const y of years) {
    const actual = returns.get(y);
    if (actual == null) continue;
    const pred = predict(y);
    if (!pred) continue;
    const predSign = pred.forecastPct >= 0 ? 1 : -1;
    const actualSign = actual >= 0 ? 1 : -1;
    if (predSign === actualSign) hit++;
    n++;
  }
  return { hitRate: n > 0 ? hit / n : 0, n };
}

export interface YearForecastFactor {
  key: FactorKey;
  label: string;
  result: FactorResult | null;
  accuracy: { hitRate: number; n: number }; // 過去の予測精度（符号一致率）＝重みの根拠
  weight: number; // 正規化後のアンサンブル重み（0〜1、4指標の合計が1）
}

export interface YearForecast {
  year: number;
  asOfMonth: number;
  factors: YearForecastFactor[];
  blendedForecastPct: number | null; // 精度に応じた加重平均（単純平均ではない）
  blendedProbability: number | null; // 各指標の確率（probability）を同じ重みで加重平均したもの（0〜1）
}

// ある時点（year年のasOfMonth月末まで確定しているデータ）での4指標＋重み付き総合予測を計算する。
export function computeYearForecast(FULL: { date: string; price: number }[], year: number, asOfMonth: number): YearForecast {
  const returns = buildAnnualReturns(FULL);
  const allYears = [...returns.keys()].filter((y) => y < year).sort((a, b) => a - b);

  const defs: { key: FactorKey; compute: (y: number) => FactorResult | null }[] = [
    { key: "recent10", compute: (y) => recentNYearAverage(returns, y, 10) },
    { key: "similarPrior", compute: (y) => similarPriorYearFollowing(returns, y) },
    { key: "cycle", compute: (y) => presidentialCycleAverage(returns, y) },
    { key: "monthEnd", compute: (y) => monthEndAnalogForecast(FULL, y, asOfMonth) },
  ];

  const factors: YearForecastFactor[] = defs.map(({ key, compute }) => ({
    key,
    label: FACTOR_LABELS[key],
    result: compute(year),
    accuracy: backtestAccuracy(compute, returns, allYears),
    weight: 0,
  }));

  const withResult = factors.filter((f) => f.result);
  const weightSum = withResult.reduce((s, f) => s + f.accuracy.hitRate, 0);
  for (const f of factors) f.weight = f.result && weightSum > 0 ? f.accuracy.hitRate / weightSum : 0;

  const blendedForecastPct = withResult.length
    ? withResult.reduce((s, f) => s + (f.result as FactorResult).forecastPct * f.weight, 0)
    : null;
  const blendedProbability = withResult.length
    ? withResult.reduce((s, f) => s + (f.result as FactorResult).probability * f.weight, 0)
    : null;

  return { year, asOfMonth, factors, blendedForecastPct, blendedProbability };
}

// 今年の1月末〜latestMonth月末まで、各月末時点で遡及的にcomputeYearForecastを呼び出し、総合予測値の変遷を返す。
// （月が進むほど当年月末時点類似年＝指標4の実績カバー率が増え、一致率・重みも変わるため、推定が年末の実績へ
// 収束していく形になる。各時点の値はその時点までのデータだけで決まり、後の月のデータでは変化しない＝ルックアヘッド無し）
export function yearForecastTrajectory(FULL: { date: string; price: number }[], year: number, latestMonth: number): { month: number; blendedForecastPct: number | null }[] {
  const out: { month: number; blendedForecastPct: number | null }[] = [];
  for (let m = 1; m <= latestMonth; m++) {
    out.push({ month: m, blendedForecastPct: computeYearForecast(FULL, year, m).blendedForecastPct });
  }
  return out;
}
