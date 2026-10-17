// 実行: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAnnualReturns, recentNYearAverage, similarPriorYearFollowing, presidentialCycleAverage,
  monthEndAnalogForecast, computeYearForecast, yearForecastTrajectory,
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

test("computeYearForecast：重みの合計が1に正規化され、総合予測値が各指標の予測値の範囲内に収まる", () => {
  const years = [];
  for (let y = 2001; y <= 2016; y++) years.push({ year: y, annualReturn: Math.round((10 * Math.sin((y - 2001) * 0.7) + 2) * 100) / 10000 });
  const FULL = monthlySeries(years);
  const forecast = computeYearForecast(FULL, 2016, 12);
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
