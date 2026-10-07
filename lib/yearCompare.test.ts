// 実行: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildYearSeries, completeYears, presidentialTermYear, selectCompareYears, rankSimilarYears, sortYearsBy } from "./yearCompare.ts";

// year年の1月2日〜12月30日に、毎月1日・15日の2点の終値を置いた簡易シリーズ（priceFn(year, i) で値を決める）
function series(years: number[], priceFn: (y: number, i: number) => number) {
  const pts: { date: string; price: number }[] = [];
  for (const y of years) {
    let i = 0;
    for (let m = 1; m <= 12; m++) for (const d of [2, 15]) pts.push({ date: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`, price: priceFn(y, i++) });
    pts.push({ date: `${y}-12-30`, price: priceFn(y, i) });
  }
  return pts;
}

test("評価額は前年最終値=100の指数、DDは年初来高値からの下落率", () => {
  const s = buildYearSeries([{ date: "2019-12-31", price: 100 }, { date: "2020-01-02", price: 110 }, { date: "2020-01-03", price: 120 }, { date: "2020-01-06", price: 90 }]);
  const y = s.get(2020)!;
  assert.deepEqual(y.map((p) => Math.round(p.index)), [110, 120, 90]);
  assert.deepEqual(y.map((p) => Math.round(p.dd * 10) / 10), [0, 0, -25]);
  assert.deepEqual(y.map((p) => p.doy), [2, 3, 6]);
});

test("前年データが無い年は、その年の最初の終値=100", () => {
  const s = buildYearSeries([{ date: "1957-03-04", price: 44 }, { date: "1957-03-05", price: 44.44 }]);
  assert.equal(s.get(1957)![0].index, 100);
});

test("確定年は1月上旬〜12月下旬まで揃った年。データ開始年の途中から・今年は除く", () => {
  const pts = [{ date: "2017-06-01", price: 1 }, { date: "2017-12-29", price: 1 }, ...series([2018, 2019], () => 1), { date: "2020-01-02", price: 1 }];
  assert.deepEqual(completeYears(buildYearSeries(pts), 2020), [2018, 2019]);
});

test("大統領任期年：year % 4（0=選挙年=4年目、1=1年目、2=中間選挙=2年目、3=3年目）", () => {
  assert.deepEqual([2024, 2025, 2026, 2027, 2020, 1960].map(presidentialTermYear), [4, 1, 2, 3, 4, 4]);
});

test("プリセット：任期年・直近10年・指定年から10年・前後10年（範囲外は縮める）", () => {
  const years = Array.from({ length: 30 }, (_, i) => 1996 + i); // 1996〜2025
  const s = buildYearSeries([...series(years, (y, i) => 100 + i), { date: "2026-01-02", price: 100 }]);
  const pick = (preset: Parameters<typeof selectCompareYears>[0], inputYear?: number) => selectCompareYears(preset, { series: s, currentYear: 2026, metric: "index", inputYear });
  assert.deepEqual(pick("election").years, [1996, 2000, 2004, 2008, 2012, 2016, 2020, 2024]);
  assert.deepEqual(pick("midterm").years, [1998, 2002, 2006, 2010, 2014, 2018, 2022]);
  assert.deepEqual(pick("recent10").years, [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025]);
  assert.deepEqual(pick("from10", 2005).years, [2005, 2006, 2007, 2008, 2009, 2010, 2011, 2012, 2013, 2014]);
  assert.deepEqual(pick("around10", 2010).years, [2005, 2006, 2007, 2008, 2009, 2010, 2011, 2012, 2013, 2014]);
  const edge = pick("around10", 2024);
  assert.deepEqual(edge.years, [2019, 2020, 2021, 2022, 2023, 2024, 2025]);
  assert.ok(edge.note?.includes("縮めました"));
  assert.ok(pick("from10", 1990).note?.includes("範囲で入力"));
  assert.ok(pick("from10").note?.includes("年を入力"));
});

test("類似年：今年と同じ期間の推移のRMSEが小さい順", () => {
  // 2026年は毎回+1%ずつ上昇。2010年は同じ上昇、2011年は横ばい、2012年は下落 → 2010が最も類似
  const trend: Record<number, number> = { 2010: 1, 2011: 0, 2012: -1, 2026: 1 };
  const pts: { date: string; price: number }[] = [];
  for (const y of [2010, 2011, 2012, 2026]) {
    pts.push({ date: `${y - 1}-12-31`, price: 100 }); // 年初の基準=100
    for (let i = 0; i < 6; i++) pts.push({ date: `${y}-01-${String(2 + i).padStart(2, "0")}`, price: 100 * (1 + trend[y] / 100) ** (i + 1) });
  }
  const s = buildYearSeries(pts);
  const ranked = rankSimilarYears(s, 2026, [2010, 2011, 2012], "index", 3);
  assert.equal(ranked[0].year, 2010);
  assert.equal(ranked[2].year, 2012);
  // 今年のデータが少なすぎる場合は判定しない
  const tiny = buildYearSeries([...series([2010], () => 100), { date: "2026-01-02", price: 100 }]);
  assert.deepEqual(rankSimilarYears(tiny, 2026, [2010], "index"), []);
});

test("一覧表の並び替え：昇順/降順、同値は新しい年が上、値が無い年は末尾", () => {
  const mk = (year: number, returnPct: number, mdd: number, athCount: number) => [year, { year, lastDate: `${year}-12-31`, returnPct, mdd, athCount, athCountToDate: 0, dd3Count: 0, athCountYear: 0, mddYear: 0, dd3CountYtd: 0 }] as const;
  const stats = new Map([mk(2020, 16.3, -33.9, 33), mk(2021, 26.9, -5.2, 70), mk(2022, -19.4, -25.4, 1), mk(2023, 24.2, -10.3, 0), mk(2024, 23.3, -8.5, 57), mk(2025, 16.4, -18.9, 39)]);
  const ys = [2026, 2025, 2024, 2023, 2022, 2021, 2020]; // 2026は統計なし
  assert.deepEqual(sortYearsBy(ys, stats, "year", "desc"), [2026, 2025, 2024, 2023, 2022, 2021, 2020]);
  assert.deepEqual(sortYearsBy(ys, stats, "year", "asc"), [2020, 2021, 2022, 2023, 2024, 2025, 2026]);
  assert.deepEqual(sortYearsBy(ys, stats, "returnPct", "desc"), [2021, 2023, 2024, 2025, 2020, 2022, 2026]);
  assert.deepEqual(sortYearsBy(ys, stats, "returnPct", "asc"), [2022, 2020, 2025, 2024, 2023, 2021, 2026]);
  assert.deepEqual(sortYearsBy(ys, stats, "mdd", "asc"), [2020, 2022, 2025, 2023, 2024, 2021, 2026]); // 下落が深い順
  assert.deepEqual(sortYearsBy(ys, stats, "mdd", "desc"), [2021, 2024, 2023, 2025, 2022, 2020, 2026]);
  const tie = new Map([mk(2018, 1, -1, 5), mk(2019, 2, -1, 5)]);
  assert.deepEqual(sortYearsBy([2018, 2019], tie, "athCount", "asc"), [2019, 2018]); // 同値は新しい年が上
});
