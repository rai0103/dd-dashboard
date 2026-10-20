// 年騰落率予測：直近10年平均・前年類似年の翌年平均・大統領サイクル平均・大統領サイクル別季節性（月次）・
// 当年月末時点類似年・類似年の残り期間実績平均・当年DD局面類似年、の7つの実績統計から今年の年末までの騰落率を
// 予想する。各指標は「ある年Yの予測」を、Y年より前のデータだけを使って計算できる関数として実装し（ルックアヘッド
// 無し）、過去の確定年に遡って「その指標が過去にどれだけ当たっていたか（符号一致率）」を検証し、その一致率を
// 指標ごとの重みとして使う加重平均で総合予測値を出す（単純平均ではない）。月末時点類似年・季節性の2指標は月が
// 進むほど一致率が上がる傾向があるため、同じ仕組み（指標ごとの符号一致率バックテスト）が自然に月ごとの精度差を
// 重みに反映する。今年の年末予測値を実績の代わりに使うことで、翌年の予測（computeNextYearForecast）も算出できる。
// このファイルはこの他に、QQQとSP500の年間騰落率の相関係数・ベータ等を算出するcomputeQqqSpxCorrelationも
// 公開している（こちらは参考統計であり、上記7指標の加重平均予測には組み込まない）。
// このファイルはlib/yearCompare.ts（外部importを持たない純粋関数のみで構成）だけをimportし、
// `node --test`から直接実行できるようにしている。lib/bottomScore.ts（底値判定・節目回復統計）はimportせず、
// 7指標目（当年DD局面類似年）に必要な最小限のATH/DD計算をpearsonCorrと同様にこのファイル内に複製している。
import { buildYearSeries, presidentialTermYear, type YearSeries, type YearPoint } from "./yearCompare.ts";

// buildYearSeries(FULL全体を年別に再集計する処理)は入力が同じFULL配列（参照が同じ）であれば結果も必ず同じになる。
// backtestAccuracy等で同じFULLに対して指標関数を何十回も呼ぶため、素朴にbuildYearSeriesを呼び直すと
// 「過去全年×複数指標×月次トラジェクトリ」で何百回も重複して全期間を再集計することになり、実データ規模
// （数千営業日）では数秒〜十数秒かかって画面がフリーズする。FULL配列の参照をキーにしたWeakMapでキャッシュし、
// 同一FULLに対しては1回だけ計算する（FULLが更新され新しい配列になれば自動的に再計算される。外部からは
// 従来通り毎回buildYearSeriesを呼んでいるのと同じ結果になる純粋なキャッシュで、挙動は変えない）。
const yearSeriesCache = new WeakMap<object, YearSeries>();
function cachedYearSeries(FULL: { date: string; price: number }[]): YearSeries {
  const cached = yearSeriesCache.get(FULL);
  if (cached) return cached;
  const series = buildYearSeries(FULL.map((p) => ({ date: p.date, price: p.price })));
  yearSeriesCache.set(FULL, series);
  return series;
}

// 7指標目（当年DD局面類似年）用：FULL全体（日付昇順）に対する、その時点までのATHからのドローダウン%の系列。
// lib/bottomScore.tsのcomputeDrawdownsと同じ考え方だが、このファイルは外部importを持たない方針のため複製する
// （ファイル冒頭コメント参照）。yearSeriesCacheと同じ理由でFULL参照をキーにキャッシュする。
const ddSeriesCache = new WeakMap<object, number[]>();
function cachedDdSeries(FULL: { date: string; price: number }[]): number[] {
  const cached = ddSeriesCache.get(FULL);
  if (cached) return cached;
  const dd: number[] = [];
  let m = -Infinity;
  for (const p of FULL) { m = Math.max(m, p.price); dd.push((p.price - m) / m * 100); }
  ddSeriesCache.set(FULL, dd);
  return dd;
}

// 7指標目用：年→[各月末時点のFULL配列上のindex]（0始まり、月1〜12）のルックアップ表。同じ理由でキャッシュする。
const monthEndIdxCache = new WeakMap<object, Map<number, (number | null)[]>>();
function cachedMonthEndIdx(FULL: { date: string; price: number }[]): Map<number, (number | null)[]> {
  const cached = monthEndIdxCache.get(FULL);
  if (cached) return cached;
  const out = new Map<number, (number | null)[]>();
  for (let i = 0; i < FULL.length; i++) {
    const d = FULL[i].date;
    const y = Number(d.slice(0, 4)), mo = Number(d.slice(5, 7));
    let arr = out.get(y);
    if (!arr) { arr = new Array(12).fill(null); out.set(y, arr); }
    arr[mo - 1] = i; // FULLは日付昇順前提。同じ月内で後に出てきたindexで上書き＝その月の最終営業日が残る
  }
  monthEndIdxCache.set(FULL, out);
  return out;
}

// year年のasOfMonth月末（以前）の最終営業日が、FULL配列の何番目か。該当データが無ければnull。
function lastIdxAtMonthEnd(FULL: { date: string; price: number }[], year: number, asOfMonth: number): number | null {
  const arr = cachedMonthEndIdx(FULL).get(year);
  if (!arr) return null;
  for (let m = Math.min(asOfMonth, 12); m >= 1; m--) if (arr[m - 1] != null) return arr[m - 1];
  return null;
}

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
// 進行中の年（今年）も最新時点までの「現時点のYTD」としてそのまま含まれるが、以下の指標はいずれも
// 予測対象の年より前の年だけを参照年として使うため、進行中の年の値が参照年として誤用されることはない。
export function buildAnnualReturns(FULL: { date: string; price: number }[]): Map<number, number> {
  const series = cachedYearSeries(FULL);
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
  const series = cachedYearSeries(FULL);
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

// 6. 類似年の残り期間実績平均：指標4（当年月末時点類似年）と同じ方法でyearのasOfMonth月末時点のYTD騰落率に
//    近い過去の確定年を最大k件選ぶが、各候補年の「全年リターン」ではなく「asOfMonth時点から年末までの残り
//    期間のリターン」（下のseasonalRemainingForecastのremainingReturnと同じ考え方）を根拠データとして使う。
//    forecastPctは、選んだ年の残り期間リターンの平均を現在のYTDに複利適用した値（他の指標と同じ「年末までの
//    騰落率」という単位に揃える）。指標4は「似たYTDの年はその年自体の最終着地も似る」という仮定だが、本指標は
//    「似たYTDの年の“その後の値動き”を、今年の現在値に上乗せする」という仮定に基づく、独立した6つ目の指標。
export function monthEndAnalogRemainingForecast(FULL: { date: string; price: number }[], year: number, asOfMonth: number, k = 8, minK = 5): FactorResult | null {
  const series = cachedYearSeries(FULL);
  const currentYtd = ytdAtMonthEnd(series, year, asOfMonth);
  if (currentYtd == null) return null;
  const candidates: { z: number; dist: number; remainingReturn: number }[] = [];
  for (const [z, pts] of series) {
    if (z >= year || !pts.length) continue;
    const zYtd = ytdAtMonthEnd(series, z, asOfMonth);
    if (zYtd == null) continue;
    const zFull = pts[pts.length - 1].index - 100;
    const remainingReturn = ((100 + zFull) / (100 + zYtd) - 1) * 100; // asOfMonth時点から年末までのリターン
    candidates.push({ z, dist: Math.abs(zYtd - currentYtd), remainingReturn });
  }
  if (candidates.length < Math.min(minK, 3)) return null;
  candidates.sort((a, b) => a.dist - b.dist);
  const chosen = candidates.slice(0, Math.max(Math.min(minK, candidates.length), Math.min(k, candidates.length)));
  const remainingReturns = chosen.map((c) => c.remainingReturn);
  const forecastPct = (100 + currentYtd) * (1 + avg(remainingReturns) / 100) - 100;
  const refYears = chosen.map((c) => ({ year: c.z, return: c.remainingReturn })).sort((a, b) => a.year - b.year);
  return { forecastPct, probability: posShare(remainingReturns), refYears };
}

const DD_ANALOG_MIN_DD = -3; // lib/bottomScore.tsのMIN_EPISODE_DDと同じ閾値（複製。ファイル冒頭コメント参照）

// 7. 当年DD局面類似年：yearのasOfMonth月末時点の対ATHドローダウン%（直近ATHからの下落率）に近い過去の確定年
//    （yearより前）を最大k件選び、それらの年の「asOfMonthから年末までの残り期間リターン」の平均を、現在のYTDに
//    複利適用して予測値とする（指標6の、YTD%ではなくDDの深さを類似度の基準にした派生版。底値判定側の節目回復
//    統計と同じ「DDの深さ」という軸を年末予測にも反映する）。現在が下落局面でない（DDがDD_ANALOG_MIN_DDに
//    達していない）年はnullを返す（他の指標と異なり、DD局面であることそのものが前提の指標のため）。
export function ddStateAnalogForecast(FULL: { date: string; price: number }[], year: number, asOfMonth: number, k = 8, minK = 5): FactorResult | null {
  const series = cachedYearSeries(FULL);
  const currentYtd = ytdAtMonthEnd(series, year, asOfMonth);
  if (currentYtd == null) return null;
  const curIdx = lastIdxAtMonthEnd(FULL, year, asOfMonth);
  if (curIdx == null) return null;
  const dd = cachedDdSeries(FULL);
  const currentDd = dd[curIdx];
  if (currentDd > DD_ANALOG_MIN_DD) return null;

  const candidates: { z: number; dist: number; remainingReturn: number }[] = [];
  for (const [z, pts] of series) {
    if (z >= year || !pts.length) continue;
    const zYtd = ytdAtMonthEnd(series, z, asOfMonth);
    if (zYtd == null) continue;
    const zIdx = lastIdxAtMonthEnd(FULL, z, asOfMonth);
    if (zIdx == null) continue;
    const zFull = pts[pts.length - 1].index - 100;
    const remainingReturn = ((100 + zFull) / (100 + zYtd) - 1) * 100;
    candidates.push({ z, dist: Math.abs(dd[zIdx] - currentDd), remainingReturn });
  }
  if (candidates.length < Math.min(minK, 3)) return null;
  candidates.sort((a, b) => a.dist - b.dist);
  const chosen = candidates.slice(0, Math.max(Math.min(minK, candidates.length), Math.min(k, candidates.length)));
  const remainingReturns = chosen.map((c) => c.remainingReturn);
  const forecastPct = (100 + currentYtd) * (1 + avg(remainingReturns) / 100) - 100;
  const refYears = chosen.map((c) => ({ year: c.z, return: c.remainingReturn })).sort((a, b) => a.year - b.year);
  return { forecastPct, probability: posShare(remainingReturns), refYears };
}

// ある年の月ごとの単月リターン（%）。年初(index=100)→1月末、1月末→2月末、…と連鎖して算出する。
// その月のデータが無い月（進行中の年の未到達月等）はスキップする。
function monthlyReturnsForYear(pts: YearPoint[]): Map<number, number> {
  const out = new Map<number, number>();
  let prevIndex = 100;
  for (let m = 1; m <= 12; m++) {
    const inMonth = pts.filter((p) => Number(p.date.slice(5, 7)) === m);
    if (!inMonth.length) continue;
    const idx = inMonth[inMonth.length - 1].index;
    out.set(m, (idx / prevIndex - 1) * 100);
    prevIndex = idx;
  }
  return out;
}

// yearと同じ大統領サイクル区分の、yearより前の確定年について、asOfMonth+1〜12月の各月の単月リターン平均
// （季節パターン）を返す。十分な参照年（3年以上）が無ければnull。
export function seasonalMonthlyAverages(FULL: { date: string; price: number }[], year: number, asOfMonth: number): { month: number; avgReturnPct: number; n: number }[] | null {
  const series = cachedYearSeries(FULL);
  const pos = presidentialTermYear(year);
  const sameCycleYears = [...series.keys()].filter((z) => z < year && presidentialTermYear(z) === pos);
  if (sameCycleYears.length < 3) return null;
  const monthlyByYear = new Map(sameCycleYears.map((z) => [z, monthlyReturnsForYear(series.get(z) ?? [])]));
  const out: { month: number; avgReturnPct: number; n: number }[] = [];
  for (let m = asOfMonth + 1; m <= 12; m++) {
    const vals: number[] = [];
    for (const z of sameCycleYears) {
      const mr = monthlyByYear.get(z)!.get(m);
      if (mr != null) vals.push(mr);
    }
    if (vals.length) out.push({ month: m, avgReturnPct: avg(vals), n: vals.length });
  }
  return out.length ? out : null;
}

// 5. 大統領サイクル別季節性（月次）：同サイクル区分の過去年の「月ごとの単月リターン平均」を、現在値から年末まで
//    複利適用して予測値とする。他の指標は年間リターンの単一値しか見ないが、この指標は月次の形（季節性）を反映する。
export function seasonalRemainingForecast(FULL: { date: string; price: number }[], year: number, asOfMonth: number): FactorResult | null {
  const series = cachedYearSeries(FULL);
  const currentYtd = asOfMonth > 0 ? ytdAtMonthEnd(series, year, asOfMonth) : 0;
  if (currentYtd == null) return null;
  const pattern = seasonalMonthlyAverages(FULL, year, asOfMonth);
  if (!pattern) return null;

  let idx = 100 + currentYtd;
  for (const { avgReturnPct } of pattern) idx = idx * (1 + avgReturnPct / 100);
  const forecastPct = idx - 100;

  const pos = presidentialTermYear(year);
  const refYears: { year: number; return: number }[] = [];
  for (const [z, pts] of series) {
    if (z >= year || !pts.length || presidentialTermYear(z) !== pos) continue;
    const zYtd = asOfMonth > 0 ? ytdAtMonthEnd(series, z, asOfMonth) : 0;
    if (zYtd == null) continue;
    const zFull = pts[pts.length - 1].index - 100;
    const remainingReturn = ((100 + zFull) / (100 + zYtd) - 1) * 100; // 同じasOfMonth時点から年末までのリターン
    refYears.push({ year: z, return: remainingReturn });
  }
  if (refYears.length < 3) return null;
  refYears.sort((a, b) => a.year - b.year);
  return { forecastPct, probability: posShare(refYears.map((r) => r.return)), refYears };
}

function monthEndDayOfYear(year: number, month: number): number {
  return Math.round((Date.UTC(year, month, 0) - Date.UTC(year, 0, 1)) / 86400000) + 1;
}

// 現在値(100+YTD)から、季節パターン（seasonalMonthlyAverages）の形（月ごとの上下）を保ったまま、
// 総合予測値(targetForecastPct)に終点を一致させた月末ごとの推移を返す（コンパクト表示の折れ線チャート用）。
// 季節パターンが無い、または総合予測値が無い場合はnull。
export function yearEndProjectionPath(FULL: { date: string; price: number }[], year: number, asOfMonth: number, targetForecastPct: number | null): { month: number; doy: number; indexValue: number }[] | null {
  if (targetForecastPct == null) return null;
  const pattern = seasonalMonthlyAverages(FULL, year, asOfMonth);
  if (!pattern) return null;
  const series = cachedYearSeries(FULL);
  const currentYtd = (asOfMonth > 0 ? ytdAtMonthEnd(series, year, asOfMonth) : 0) ?? 0;
  const startIndex = 100 + currentYtd;
  const targetIndex = 100 + targetForecastPct;

  let raw = startIndex;
  const rawPath = pattern.map(({ month, avgReturnPct }) => {
    raw = raw * (1 + avgReturnPct / 100);
    return { month, raw };
  });
  const rawFinal = rawPath.length ? rawPath[rawPath.length - 1].raw : startIndex;
  const rawGrowth = rawFinal - startIndex;
  const targetGrowth = targetIndex - startIndex;
  const totalRemainingMonths = 12 - asOfMonth;

  return rawPath.map(({ month, raw: r }) => {
    const rawGrowthSoFar = r - startIndex;
    const scaledGrowth = Math.abs(rawGrowth) > 1e-9
      ? rawGrowthSoFar * (targetGrowth / rawGrowth)
      : targetGrowth * ((month - asOfMonth) / totalRemainingMonths);
    return { month, doy: monthEndDayOfYear(year, month), indexValue: startIndex + scaledGrowth };
  });
}

export type FactorKey = "recent10" | "similarPrior" | "cycle" | "seasonality" | "monthEnd" | "monthEndRemaining" | "ddState";

const FACTOR_LABELS: Record<FactorKey, string> = {
  recent10: "直近10年平均",
  similarPrior: "前年類似年の翌年平均",
  cycle: "大統領サイクル平均",
  seasonality: "大統領サイクル別季節性（月次）",
  monthEnd: "当年月末時点類似年",
  monthEndRemaining: "類似年の残り期間実績平均",
  ddState: "当年DD局面類似年",
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
  weight: number; // 正規化後のアンサンブル重み（0〜1、有効な指標の合計が1）
}

export interface YearForecast {
  year: number;
  asOfMonth: number;
  factors: YearForecastFactor[];
  blendedForecastPct: number | null; // 精度に応じた加重平均（単純平均ではない）
  blendedProbability: number | null; // 各指標の確率（probability）を同じ重みで加重平均したもの（0〜1）
}

// 各指標の予測精度（accuracy.hitRate）を重みとして正規化し、総合予測値・総合確率を算出する（factorsにweightを書き込む）。
function blendFactors(factors: YearForecastFactor[]): { blendedForecastPct: number | null; blendedProbability: number | null } {
  const withResult = factors.filter((f) => f.result);
  const weightSum = withResult.reduce((s, f) => s + f.accuracy.hitRate, 0);
  for (const f of factors) f.weight = f.result && weightSum > 0 ? f.accuracy.hitRate / weightSum : 0;
  return {
    blendedForecastPct: withResult.length ? withResult.reduce((s, f) => s + (f.result as FactorResult).forecastPct * f.weight, 0) : null,
    blendedProbability: withResult.length ? withResult.reduce((s, f) => s + (f.result as FactorResult).probability * f.weight, 0) : null,
  };
}

// ある時点（year年のasOfMonth月末まで確定しているデータ）での7指標＋重み付き総合予測を計算する。
export function computeYearForecast(FULL: { date: string; price: number }[], year: number, asOfMonth: number): YearForecast {
  const returns = buildAnnualReturns(FULL);
  const allYears = [...returns.keys()].filter((y) => y < year).sort((a, b) => a - b);

  const defs: { key: FactorKey; compute: (y: number) => FactorResult | null }[] = [
    { key: "recent10", compute: (y) => recentNYearAverage(returns, y, 10) },
    { key: "similarPrior", compute: (y) => similarPriorYearFollowing(returns, y) },
    { key: "cycle", compute: (y) => presidentialCycleAverage(returns, y) },
    { key: "seasonality", compute: (y) => seasonalRemainingForecast(FULL, y, asOfMonth) },
    { key: "monthEnd", compute: (y) => monthEndAnalogForecast(FULL, y, asOfMonth) },
    { key: "monthEndRemaining", compute: (y) => monthEndAnalogRemainingForecast(FULL, y, asOfMonth) },
    { key: "ddState", compute: (y) => ddStateAnalogForecast(FULL, y, asOfMonth) },
  ];

  const factors: YearForecastFactor[] = defs.map(({ key, compute }) => ({
    key,
    label: FACTOR_LABELS[key],
    result: compute(year),
    accuracy: backtestAccuracy(compute, returns, allYears),
    weight: 0,
  }));

  const { blendedForecastPct, blendedProbability } = blendFactors(factors);
  return { year, asOfMonth, factors, blendedForecastPct, blendedProbability };
}

export interface NextYearForecast extends YearForecast {
  basedOnForecastYear: number; // 予測のベースにした年（今年）
  basedOnForecastPct: number; // その年の年末予測値（実績の代わりに使った値）
}

// 今年の年末予測値（computeYearForecastのblendedForecastPct）を実績の代わりに使い、翌年の予測を算出する。
// 指標1・2（直近10年平均・前年類似年）は、今年を「予測値を実績とみなした年」として含めた拡張Mapで計算する。
// 指標3（大統領サイクル平均）・指標5（季節性）は実績のみを使う（指標5はasOfMonth=0で呼ぶ＝年がまだ始まっていない
// ため残り12ヶ月すべてが対象になり、通年の季節性予測として機能する）。指標4（当年月末時点類似年）・指標6（類似年
// の残り期間実績平均）・指標7（当年DD局面類似年）は、いずれも「今年のasOfMonth月末時点の状態」を起点にする指標
// で、年が始まっていない翌年には意味を持たないため含めない（4指標構成）。重みは、asOfMonthに依存しない指標1・2・3
// は今年の予測で使った精度をそのまま再利用し、季節性だけasOfMonth=0用に再バックテストする。
export function computeNextYearForecast(FULL: { date: string; price: number }[], year: number, asOfMonth: number): NextYearForecast | null {
  const current = computeYearForecast(FULL, year, asOfMonth);
  if (current.blendedForecastPct == null) return null;

  const extendedReturns = buildAnnualReturns(FULL);
  extendedReturns.set(year, current.blendedForecastPct); // 今年は年末予測値で実績の代わりとする

  const trueReturns = buildAnnualReturns(FULL);
  const nextYear = year + 1;
  const allYears = [...trueReturns.keys()].filter((y) => y < nextYear).sort((a, b) => a - b);

  const defs: { key: FactorKey; compute: (y: number) => FactorResult | null }[] = [
    { key: "recent10", compute: (y) => recentNYearAverage(extendedReturns, y, 10) },
    { key: "similarPrior", compute: (y) => similarPriorYearFollowing(extendedReturns, y) },
    { key: "cycle", compute: (y) => presidentialCycleAverage(extendedReturns, y) },
    { key: "seasonality", compute: (y) => seasonalRemainingForecast(FULL, y, 0) },
  ];

  const factors: YearForecastFactor[] = defs.map(({ key, compute }) => {
    const reused = key !== "seasonality" ? current.factors.find((f) => f.key === key) : undefined;
    const accuracy = reused ? reused.accuracy : backtestAccuracy((y) => seasonalRemainingForecast(FULL, y, 0), trueReturns, allYears);
    return { key, label: FACTOR_LABELS[key], result: compute(nextYear), accuracy, weight: 0 };
  });

  const { blendedForecastPct, blendedProbability } = blendFactors(factors);
  return { year: nextYear, asOfMonth: 0, factors, blendedForecastPct, blendedProbability, basedOnForecastYear: year, basedOnForecastPct: current.blendedForecastPct };
}

// 今年の1月末〜latestMonth月末まで、各月末時点で遡及的にcomputeYearForecastを呼び出し、総合予測値の変遷を返す。
// （月が進むほど月末時点類似年・季節性＝実績カバー率が増える指標の一致率・重みも変わるため、推定が年末の実績へ
// 収束していく形になる。各時点の値はその時点までのデータだけで決まり、後の月のデータでは変化しない＝ルックアヘッド無し）
export function yearForecastTrajectory(FULL: { date: string; price: number }[], year: number, latestMonth: number): { month: number; blendedForecastPct: number | null }[] {
  const out: { month: number; blendedForecastPct: number | null }[] = [];
  for (let m = 1; m <= latestMonth; m++) {
    out.push({ month: m, blendedForecastPct: computeYearForecast(FULL, year, m).blendedForecastPct });
  }
  return out;
}


/* ---------------- QQQ/SP500相関統計（参考データ。上記6指標の加重平均予測には組み込まない） ---------------- */

export interface QqqSpxCorrelationStats {
  n: number; // 相関算出に使った年数（SP500・QQQ両方の実績が揃う確定年のみ）
  years: { year: number; spxReturn: number; qqqReturn: number }[];
  correlation: number | null; // 年間騰落率同士のピアソン相関係数
  beta: number | null; // SP500の年間騰落率に対するQQQの増幅率（回帰直線の傾き。cov(spx,qqq)/var(spx)）
  avgQqqWhenSpxUp: number | null; // SP500が上昇した年のQQQ平均騰落率
  avgQqqWhenSpxDown: number | null; // SP500が下落した年のQQQ平均騰落率
  upShareQqqAlsoUp: number | null; // SP500上昇年のうち、QQQも上昇した年の割合（方向一致率）
}

// components/DDDashboard.jsxのpearsonCorrelationと同じ式。このファイルは外部import無しの純粋関数集として
// `node --test`から直接実行できるようにしているため（ファイル冒頭コメント参照）、あえて小さく複製している。
function pearsonCorr(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  const mx = avg(xs), my = avg(ys);
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; num += dx * dy; dx2 += dx * dx; dy2 += dy * dy; }
  const denom = Math.sqrt(dx2 * dy2);
  return denom === 0 ? null : num / denom;
}

// SP500（spxFULL、通常はd.FULL＝VOO・上場前はSP500換算）とQQQ（qqqFULL）の、年ごとの年間騰落率を比較する。
// excludeYearを渡すと、その年以降（進行中で実績未確定の今年等）を候補から除外する（ルックアヘッド的な混入防止）。
// 5年未満のペアしか無ければnull（相関・ベータという統計量の性質上、他の指標のminK=3より厳しめにしている）。
export function computeQqqSpxCorrelation(
  spxFULL: { date: string; price: number }[],
  qqqFULL: { date: string; price: number }[],
  excludeYear?: number
): QqqSpxCorrelationStats | null {
  const spxReturns = buildAnnualReturns(spxFULL);
  const qqqReturns = buildAnnualReturns(qqqFULL);
  const years = [...spxReturns.keys()]
    .filter((y) => qqqReturns.has(y) && (excludeYear == null || y < excludeYear))
    .sort((a, b) => a - b);
  if (years.length < 5) return null;

  const pairs = years.map((y) => ({ year: y, spxReturn: spxReturns.get(y)!, qqqReturn: qqqReturns.get(y)! }));
  const spxVals = pairs.map((p) => p.spxReturn);
  const qqqVals = pairs.map((p) => p.qqqReturn);
  const correlation = pearsonCorr(spxVals, qqqVals);

  const mSpx = avg(spxVals), mQqq = avg(qqqVals);
  const cov = avg(spxVals.map((v, i) => (v - mSpx) * (qqqVals[i] - mQqq)));
  const varSpx = avg(spxVals.map((v) => (v - mSpx) ** 2));
  const beta = varSpx > 0 ? cov / varSpx : null;

  const upYears = pairs.filter((p) => p.spxReturn > 0);
  const downYears = pairs.filter((p) => p.spxReturn < 0);
  const avgQqqWhenSpxUp = upYears.length ? avg(upYears.map((p) => p.qqqReturn)) : null;
  const avgQqqWhenSpxDown = downYears.length ? avg(downYears.map((p) => p.qqqReturn)) : null;
  const upShareQqqAlsoUp = upYears.length ? upYears.filter((p) => p.qqqReturn > 0).length / upYears.length : null;

  return { n: pairs.length, years: pairs, correlation, beta, avgQqqWhenSpxUp, avgQqqWhenSpxDown, upShareQqqAlsoUp };
}

