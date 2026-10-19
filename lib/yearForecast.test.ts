// 実行: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAnnualReturns, recentNYearAverage, similarPriorYearFollowing, presidentialCycleAverage,
  monthEndAnalogForecast, monthEndAnalogRemainingForecast, computeYearForecast, yearForecastTrajectory,
  seasonalMonthlyAverages, seasonalRemainingForecast, yearEndProjectionPath, computeNextYearForecast,
  computeQqqSpxCorrelation,
} from "./yearForecast.ts";

// 年ごとの年間騰落率annualReturn（小数、例0.08=+8%）から、月末12点の{date,price}系列を作る。
// 各年の基準値（前年末終値）を素直に連鎖させるため、2年目以降は年間騰落率がbuildAnnualReturns等で
// そのまま再現できる（1年目だけはbuildYearSeriesの「前年データが無い年は年初の最初の終値=100」という
// 仕様により自己参照的な基準になるため、1年目自身の値は検証対象にしない）。
function monthlySeries(yearReturns: { year: number; annualReturn: number }[]): { date: string; price: number }[] {
  const pts: { date: string; price: number }[] = [];
  let base = 100;
  for (const { year, annualReturn } of yearReturns) {
    for (let m = 1; m <= 12; m++) {
      const price = base * (1 + (annualReturn * m) / 12);
      pts.push({ date: `${year}-${String(m).padStart(2, "0")}-28`, price });
    }
    base = base * (1 + annualReturn);
  }
  return pts;
}

test("recentNYearAverage：直近n年の平均を返す。参照年数が足りない場合はnull", () => {
  const returns = new Map<number, number>();
  for (let y = 2001; y <= 2010; y++) returns.set(y, y - 2000); // 2001:1 ... 2010:10
  const r = recentNYearAverage(returns, 2011, 10);
  assert.ok(r);
  assert.equal(r!.refYears.length, 10);
  assert.equal(r!.refYears[0].year, 2001);
  assert.equal(r!.refYears[9].year, 2010);
  assert.ok(Math.abs(r!.forecastPct - 5.5) < 1e-9);
  assert.equal(r!.probability, 1); // 全年プラス
  assert.equal(recentNYearAverage(new Map(), 2011, 10), null);
  const tiny = new Map([[2010, 1], [2009, 2]]);
  assert.equal(recentNYearAverage(tiny, 2011, 10), null); // 3年未満
});

test("similarPriorYearFollowing：前年に近い過去年を選び、その翌年の平均を返す。未来年はルックアヘッド除外", () => {
  const returns = new Map<number, number>([
    [2000, 4], [2001, -5], [2002, 12], [2003, 6], [2004, -2], [2005, 3], [2006, 15], [2007, 7], [2008, 4.5], [2009, 5],
  ]);
  const r = similarPriorYearFollowing(returns, 2010); // 前年=2009=5
  assert.ok(r);
  assert.equal(r!.refYears.length, 8);
  const refYearNums = r!.refYears.map((x) => x.year).sort((a, b) => a - b);
  assert.deepEqual(refYearNums, [2001, 2002, 2003, 2004, 2005, 2006, 2008, 2009]);
  assert.ok(!refYearNums.includes(2007)); // z=2006(距離10,最遠)の翌年＝除外される
  assert.ok(r!.refYears.every((x) => x.year < 2010)); // ルックアヘッド無し
  assert.ok(Math.abs(r!.forecastPct - 4.8125) < 1e-9);
  assert.ok(Math.abs(r!.probability - 0.75) < 1e-9);
  assert.equal(similarPriorYearFollowing(new Map([[2009, 1]]), 2010), null); // 候補不足
});

test("presidentialCycleAverage：同じ大統領サイクル区分の過去年だけを平均する", () => {
  const returns = new Map<number, number>([
    [2000, 10], [2004, -4], [2008, -38], [2012, 13], // いずれも選挙年（サイクル区分4）
    [2013, 5], [2014, 6], [2015, 7], // 異なる区分（除外されるべき）
  ]);
  const r = presidentialCycleAverage(returns, 2016); // 2016も選挙年
  assert.ok(r);
  const refYearNums = r!.refYears.map((x) => x.year).sort((a, b) => a - b);
  assert.deepEqual(refYearNums, [2000, 2004, 2008, 2012]);
  assert.ok(Math.abs(r!.forecastPct - -4.75) < 1e-9);
  assert.ok(Math.abs(r!.probability - 0.5) < 1e-9);
});

test("buildAnnualReturns：連鎖した基準に基づく各年の年間騰落率を再現する", () => {
  const FULL = monthlySeries([
    { year: 2001, annualReturn: 0.5 }, // 1年目（自己参照的な基準になるため検証対象外）
    { year: 2002, annualReturn: 0.08 },
    { year: 2003, annualReturn: 0.08 },
    { year: 2004, annualReturn: -0.02 },
    { year: 2005, annualReturn: 0.12 },
  ]);
  const returns = buildAnnualReturns(FULL);
  assert.ok(Math.abs(returns.get(2002)! - 8.0) < 1e-6);
  assert.ok(Math.abs(returns.get(2003)! - 8.0) < 1e-6);
  assert.ok(Math.abs(returns.get(2004)! - -2.0) < 1e-6);
  assert.ok(Math.abs(returns.get(2005)! - 12.0) < 1e-6);
});

test("monthEndAnalogForecast：当年の月末時点YTDに近い過去年を選び、その年間騰落率の平均を返す", () => {
  const FULL = monthlySeries([
    { year: 2001, annualReturn: 0.5 }, // 遠い値になるよう大きくして、このテストでは選ばれないようにする
    { year: 2002, annualReturn: 0.08 }, // 6月末YTD=4.0
    { year: 2003, annualReturn: 0.08 }, // 6月末YTD=4.0
    { year: 2004, annualReturn: -0.02 }, // 6月末YTD=-1.0
    { year: 2005, annualReturn: 0.12 }, // 対象年。6月末YTD=6.0
  ]);
  const r = monthEndAnalogForecast(FULL, 2005, 6, 2, 1); // 最も近い2件だけ採用
  assert.ok(r);
  const refYearNums = r!.refYears.map((x) => x.year).sort((a, b) => a - b);
  assert.deepEqual(refYearNums, [2002, 2003]);
  assert.ok(Math.abs(r!.forecastPct - 8.0) < 1e-6);
  assert.equal(r!.probability, 1);
});

test("monthEndAnalogRemainingForecast：指標4と同じ候補年を選ぶが、全年リターンではなく「残り期間のリターン」を現在のYTDに複利適用する", () => {
  const FULL = monthlySeries([
    { year: 2001, annualReturn: 0.5 },
    { year: 2002, annualReturn: 0.08 }, // 6月末YTD=4.0、残り期間(7〜12月)リターン=108/104-1
    { year: 2003, annualReturn: 0.08 }, // 同上
    { year: 2004, annualReturn: -0.02 },
    { year: 2005, annualReturn: 0.12 }, // 対象年。6月末YTD=6.0
  ]);
  const r4 = monthEndAnalogForecast(FULL, 2005, 6, 2, 1);
  const r6 = monthEndAnalogRemainingForecast(FULL, 2005, 6, 2, 1);
  assert.ok(r4);
  assert.ok(r6);
  // 選ばれる候補年（YTDが近い2002・2003）は指標4と同じ
  const refYearNums = r6!.refYears.map((x) => x.year).sort((a, b) => a - b);
  assert.deepEqual(refYearNums, [2002, 2003]);
  // 根拠データ（refYears.return）は「残り期間のリターン」であり、指標4の「全年リターン（8.0%）」とは異なる
  const remainingExpected = (108 / 104 - 1) * 100;
  for (const ry of r6!.refYears) assert.ok(Math.abs(ry.return - remainingExpected) < 1e-6);
  assert.ok(Math.abs(r6!.refYears[0].return - r4!.refYears[0].return) > 1); // 全年リターン(8.0%)とは明確に異なる
  // forecastPctは「現在のYTD(6.0%)に残り期間リターンの平均を複利適用」した値で、指標4のforecastPct(8.0%)とは異なる
  const expectedForecastPct = 106 * (1 + remainingExpected / 100) - 100;
  assert.ok(Math.abs(r6!.forecastPct - expectedForecastPct) < 1e-6);
  assert.ok(Math.abs(r6!.forecastPct - r4!.forecastPct) > 1);
  assert.equal(r6!.probability, 1);
  assert.equal(monthEndAnalogRemainingForecast([], 2005, 6), null);
});

test("computeYearForecast：重みの合計が1に正規化され、総合予測値が各指標の予測値の範囲内に収まる", () => {
  const years = [];
  for (let y = 2001; y <= 2016; y++) years.push({ year: y, annualReturn: Math.round((10 * Math.sin((y - 2001) * 0.7) + 2) * 100) / 10000 });
  const FULL = monthlySeries(years);
  const forecast = computeYearForecast(FULL, 2016, 12);
  assert.equal(forecast.factors.length, 6); // 6指標構成
  const withResult = forecast.factors.filter((f) => f.result);
  assert.ok(withResult.length >= 2); // 十分な履歴があるので複数指標が有効なはず
  const weightSum = forecast.factors.reduce((s, f) => s + f.weight, 0);
  assert.ok(Math.abs(weightSum - 1) < 1e-9);
  const mags = withResult.map((f) => f.result!.forecastPct);
  assert.ok(forecast.blendedForecastPct! >= Math.min(...mags) - 1e-9);
  assert.ok(forecast.blendedForecastPct! <= Math.max(...mags) + 1e-9);
});

test("ルックアヘッド無し：対象年のasOfMonthより後のデータを変えても、その時点までの予測結果は変わらない", () => {
  const years = [];
  for (let y = 2001; y <= 2015; y++) years.push({ year: y, annualReturn: Math.round((10 * Math.sin((y - 2001) * 0.7) + 2) * 100) / 10000 });
  years.push({ year: 2016, annualReturn: 0.3 }); // 2016年全体（7〜12月分も含む）
  const full = monthlySeries(years);

  const truncated = full.filter((p) => !(p.date.startsWith("2016-") && Number(p.date.slice(5, 7)) > 6));

  const a = computeYearForecast(full, 2016, 6);
  const b = computeYearForecast(truncated, 2016, 6);
  assert.deepEqual(a, b);

  const trajectory = yearForecastTrajectory(full, 2016, 6);
  assert.equal(trajectory.length, 6);
  assert.equal(trajectory[5].month, 6);
  assert.ok(Math.abs(trajectory[5].blendedForecastPct! - a.blendedForecastPct!) < 1e-9);
});

// 年ごとの「月ごとの単月リターン（%、12個）」から、月末12点の{date,price}系列を作る。
// seasonalMonthlyAverages／seasonalRemainingForecast／yearEndProjectionPathの検証用に、
// 月次の形を完全に指定できるようにしたヘルパー（monthlySeriesは年間リターンからの線形補間のため使えない）。
function monthlySeriesFromMonthlyReturns(yearReturns: { year: number; monthlyReturns: number[] }[]): { date: string; price: number }[] {
  const pts: { date: string; price: number }[] = [];
  let base = 100;
  for (const { year, monthlyReturns } of yearReturns) {
    let cur = base;
    for (let m = 1; m <= 12; m++) {
      cur = cur * (1 + monthlyReturns[m - 1] / 100);
      pts.push({ date: `${year}-${String(m).padStart(2, "0")}-28`, price: cur });
    }
    base = cur;
  }
  return pts;
}

function compound(monthlyReturnsPct: number[]): number {
  return monthlyReturnsPct.reduce((acc, r) => acc * (1 + r / 100), 1);
}

// 選挙年（大統領サイクル区分4）同士で完全に同じ月次パターンPを共有させ、季節性指標の平均値・複利適用値を
// 誤差なく厳密に予測できるようにした合成データ。1999年は連鎖の基準を作るためだけの年（検証対象外、
// サイクル区分3なので選挙年の参照集合にも混ざらない）。2000・2004・2008・2012が選挙年の参照年、
// 2016が予測対象年（同じく選挙年、Pと同じ月次パターンを1〜12月分持つ）。それ以外の年は季節性指標の
// 計算には使われないので内容は任意（0%固定）。
const P = [2, -1, 3, 0, -2, 1, 4, -3, 2, 1, -1, 5];
const seasonalYearReturns: { year: number; monthlyReturns: number[] }[] = [];
seasonalYearReturns.push({ year: 1999, monthlyReturns: new Array(12).fill(0) });
for (let y = 2000; y <= 2016; y++) {
  const isElectionYear = y === 2000 || y === 2004 || y === 2008 || y === 2012 || y === 2016;
  seasonalYearReturns.push({ year: y, monthlyReturns: isElectionYear ? P : new Array(12).fill(0) });
}
const SEASONAL_FULL = monthlySeriesFromMonthlyReturns(seasonalYearReturns);

test("seasonalMonthlyAverages：同じ大統領サイクル区分の過去年だけの月次リターン平均を返す（他区分は混在しない）", () => {
  const result = seasonalMonthlyAverages(SEASONAL_FULL, 2016, 6);
  assert.ok(result);
  assert.equal(result!.length, 6); // asOfMonth=6なので7〜12月分
  for (const { month, avgReturnPct, n } of result!) {
    assert.ok(Math.abs(avgReturnPct - P[month - 1]) < 1e-9); // 2000/2004/2008/2012が全て同一パターンPなので平均=P自身
    assert.equal(n, 4);
  }
  assert.deepEqual(result!.map((r) => r.month), [7, 8, 9, 10, 11, 12]);
  assert.equal(seasonalMonthlyAverages(SEASONAL_FULL, 2001, 6), null); // 参照年（選挙年）が3年未満
});

test("seasonalRemainingForecast：現在のYTDに季節パターンを複利適用して年末値を予測する", () => {
  const r = seasonalRemainingForecast(SEASONAL_FULL, 2016, 6);
  assert.ok(r);
  // 2016年自身も1〜12月が全てPに従う（1〜6月分で6月末YTDになり、7〜12月分の平均季節パターン＝P自身を
  // 複利適用すると、結局P全体を複利適用した値と一致するはず）。
  const expectedForecastPct = (compound(P) - 1) * 100;
  assert.ok(Math.abs(r!.forecastPct - expectedForecastPct) < 1e-6);
  // 参照年（2000/2004/2008/2012）はいずれも6月末YTD・年末値ともに2016と全く同じ値になるため、
  // 「6月末から年末までのリターン」も全参照年で同一・同じ符号になるはず。
  assert.equal(r!.refYears.length, 4);
  const remainingReturns = r!.refYears.map((x) => x.return);
  for (const rr of remainingReturns) assert.ok(Math.abs(rr - remainingReturns[0]) < 1e-9);
  assert.equal(r!.probability, remainingReturns[0] > 0 ? 1 : 0);
  assert.equal(seasonalRemainingForecast(SEASONAL_FULL, 2001, 6), null);
});

test("yearEndProjectionPath：季節性の形（折れ線）を保ちつつ、終点は与えた総合予測値に一致する", () => {
  const raw = seasonalRemainingForecast(SEASONAL_FULL, 2016, 6)!.forecastPct;
  const target = raw + 10; // 総合予測値（アンサンブル）は季節性単体の値とは別の値になるのでズラして検証
  const path = yearEndProjectionPath(SEASONAL_FULL, 2016, 6, target);
  assert.ok(path);
  assert.equal(path!.length, 6);
  assert.deepEqual(path!.map((p) => p.month), [7, 8, 9, 10, 11, 12]);
  // 終点（12月）はtargetに一致する
  assert.ok(Math.abs(path![5].indexValue - 100 - target) < 1e-6);
  // 月を追うごとにdoy（年内通算日）は単調増加
  for (let i = 1; i < path!.length; i++) assert.ok(path![i].doy > path![i - 1].doy);
  // 折れ線になっている（各月の増分が一定ではない＝直線ではない）こと
  const deltas = path!.map((p, i) => p.indexValue - (i === 0 ? 100 + (ytdOf(SEASONAL_FULL, 2016, 6)) : path![i - 1].indexValue));
  const allEqual = deltas.every((d) => Math.abs(d - deltas[0]) < 1e-9);
  assert.ok(!allEqual);
  assert.equal(yearEndProjectionPath(SEASONAL_FULL, 2016, 6, null), null);
});

// yearEndProjectionPathのテスト内で使う、2016年6月末までのYTD（%）を独立に計算する小ヘルパー。
function ytdOf(FULL: { date: string; price: number }[], year: number, asOfMonth: number): number {
  const ret = seasonalRemainingForecast(FULL, year, asOfMonth)!;
  // seasonalRemainingForecastのforecastPctから逆算するのではなく、Pそのものから直接計算する。
  return (compound(P.slice(0, asOfMonth)) - 1) * 100;
}

test("computeNextYearForecast：今年の予測値を実績の代わりに使って翌年を計算し、月末時点類似年（指標4）は含まれない", () => {
  const years = [];
  for (let y = 2001; y <= 2016; y++) years.push({ year: y, annualReturn: Math.round((10 * Math.sin((y - 2001) * 0.7) + 2) * 100) / 10000 });
  const FULL = monthlySeries(years);
  const current = computeYearForecast(FULL, 2016, 12);
  assert.ok(current.blendedForecastPct != null);

  const next = computeNextYearForecast(FULL, 2016, 12);
  assert.ok(next);
  assert.equal(next!.year, 2017);
  assert.equal(next!.asOfMonth, 0);
  assert.equal(next!.basedOnForecastYear, 2016);
  assert.ok(Math.abs(next!.basedOnForecastPct - current.blendedForecastPct!) < 1e-9);
  assert.ok(!next!.factors.some((f) => f.key === "monthEnd"));
  assert.ok(!next!.factors.some((f) => f.key === "monthEndRemaining"));
  assert.equal(next!.factors.length, 4);

  // 重みは正規化されて合計1になる
  const weightSum = next!.factors.reduce((s, f) => s + f.weight, 0);
  assert.ok(Math.abs(weightSum - 1) < 1e-9);

  // 「今年の予測値を実績として使っている」ことの直接確認：指標1（直近10年平均）の参照年リストに
  // 2016年が含まれ、その値が今年の予測値（blendedForecastPct）そのものであること。
  const recent10 = next!.factors.find((f) => f.key === "recent10");
  assert.ok(recent10?.result);
  const included2016 = recent10!.result!.refYears.find((r) => r.year === 2016);
  assert.ok(included2016);
  assert.ok(Math.abs(included2016!.return - current.blendedForecastPct!) < 1e-9);
});

test("recentNYearAverage：翌年の予測に、注入した「今年の予測値」が実績扱いで反映される（computeNextYearForecastの土台となる挙動）", () => {
  const returns = new Map<number, number>();
  for (let y = 2006; y <= 2015; y++) returns.set(y, 1); // 直近10年、すべて+1%の実績
  const extended = new Map(returns);
  extended.set(2016, 999); // 2016年（まだ実績ではない）の予測値を極端な値で仮置き
  const forecastFor2017 = recentNYearAverage(extended, 2017, 10);
  assert.ok(forecastFor2017);
  assert.ok(forecastFor2017!.refYears.some((r) => r.year === 2016 && r.return === 999));
  assert.ok(forecastFor2017!.forecastPct > 90); // 999が混ざるため平均が大きく跳ね上がる
});

test("computeQqqSpxCorrelation：SP500とQQQの年間騰落率の相関係数・ベータを算出する（合成データで検証）", () => {
  const spxYears: { year: number; annualReturn: number }[] = [];
  const qqqYears: { year: number; annualReturn: number }[] = [];
  for (let y = 2001; y <= 2015; y++) {
    const spxReturn = Math.round((10 * Math.sin((y - 2001) * 0.7) + 2) * 100) / 10000;
    spxYears.push({ year: y, annualReturn: spxReturn });
    qqqYears.push({ year: y, annualReturn: spxReturn * 1.5 }); // QQQはSP500の1.5倍で完全連動する合成データ
  }
  const spxFULL = monthlySeries(spxYears);
  const qqqFULL = monthlySeries(qqqYears);

  const stats = computeQqqSpxCorrelation(spxFULL, qqqFULL);
  assert.ok(stats);
  assert.ok(stats!.n >= 10);
  assert.ok(Math.abs(stats!.correlation! - 1) < 1e-6); // 完全に線形連動するため相関係数はほぼ1
  assert.ok(Math.abs(stats!.beta! - 1.5) < 1e-3); // ベータはほぼ1.5倍（最初の年はbuildYearSeriesの基準が特殊なため、厳密に1e-6ではなく1e-3で許容）
  assert.equal(stats!.upShareQqqAlsoUp, 1); // 1.5倍（正の係数）で連動するため、SP500上昇年は必ずQQQも上昇

  // データ不足（5年未満）ではnull
  const tinySpx = monthlySeries(spxYears.slice(0, 3));
  const tinyQqq = monthlySeries(qqqYears.slice(0, 3));
  assert.equal(computeQqqSpxCorrelation(tinySpx, tinyQqq), null);

  // excludeYearで進行中年（実績未確定）を候補から除外できる
  const statsExcluded = computeQqqSpxCorrelation(spxFULL, qqqFULL, 2010);
  assert.ok(statsExcluded);
  assert.ok(statsExcluded!.years.every((p) => p.year < 2010));
});
