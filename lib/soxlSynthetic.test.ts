// 実行: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSoxlPreListingCsv, buildSoxlEquivalentSeries } from "./soxlSynthetic.ts";

test("parseSoxlPreListingCsv: ヘッダー行を除き、日付昇順でDatedPrice[]を返す（バンドル済みSOXL上場前データの健全性確認）", () => {
  const series = parseSoxlPreListingCsv();
  assert.ok(series.length > 1000); // 2005/2/25〜2010/3/10の営業日数（約1268件）
  assert.equal(series[0].date.toISOString().slice(0, 10), "2005-02-25");
  assert.ok(series[0].price > 0);
  for (let i = 1; i < series.length; i++) assert.ok(series[i].date.getTime() > series[i - 1].date.getTime());
  // SOXL上場日（2010/3/11）以降のデータは含まれていないこと
  const last = series[series.length - 1];
  assert.ok(last.date.getTime() < new Date("2010-03-11T00:00:00.000Z").getTime());
});

test("buildSoxlEquivalentSeries: 重複日が無い場合（通常ケース）、合成データ最終日とSOXL実データ最初日の値を段差なくつなぐ", () => {
  const pre = [
    { date: new Date("2010-03-08"), price: 10 },
    { date: new Date("2010-03-10"), price: 11 }, // 最終日
  ];
  const soxl = [
    { date: new Date("2010-03-11"), price: 5.5 }, // 最初日（重複なし）
    { date: new Date("2010-03-12"), price: 6 },
  ];
  const r = buildSoxlEquivalentSeries(pre, soxl);
  assert.equal(r.mode, "spliced-boundary");
  assert.equal(r.series.length, 4);
  // 補正係数 = soxl[0].price / pre最終日.price = 5.5/11 = 0.5（上場前合成データはすでに接続済みのため、通常1倍に近い）
  assert.equal(r.factor, 0.5);
  assert.equal(r.series[0].price, 5); // 10 * 0.5
  assert.equal(r.series[1].price, 5.5); // 11 * 0.5（接続点でsoxl[0]の5.5と一致＝段差なし）
  assert.equal(r.series[1].price, soxl[0].price);
  assert.equal(r.series[2].price, 5.5);
  assert.equal(r.series[3].price, 6);
});

test("buildSoxlEquivalentSeries: 重複日がある場合、QQQ側（lib/qqqSynthetic.ts）と同じ方式で最新の重複日で接続する", () => {
  const pre = [
    { date: new Date("2010-03-08"), price: 10 },
    { date: new Date("2010-03-09"), price: 11 },
    { date: new Date("2010-03-10"), price: 12 }, // SOXL側にも値がある
  ];
  const soxl = [
    { date: new Date("2010-03-10"), price: 6 },
    { date: new Date("2010-03-11"), price: 6.6 },
  ];
  const r = buildSoxlEquivalentSeries(pre, soxl);
  assert.equal(r.mode, "spliced-overlap");
  assert.equal(r.junctionDate, "2010-03-10");
  assert.equal(r.factor, 0.5); // 6/12
  assert.equal(r.series.length, 4);
  assert.equal(r.series[1].price, 5.5); // 11*0.5
});

test("buildSoxlEquivalentSeries: SOXLデータが空なら合成データのみ、合成データが空ならSOXLのみを返す", () => {
  const pre = [{ date: new Date("2010-03-08"), price: 10 }];
  const soxl = [{ date: new Date("2010-03-11"), price: 5.5 }];
  const r1 = buildSoxlEquivalentSeries(pre, []);
  assert.equal(r1.mode, "pre-listing-only");
  assert.equal(r1.series.length, 1);
  const r2 = buildSoxlEquivalentSeries([], soxl);
  assert.equal(r2.mode, "soxl-only");
  assert.equal(r2.series.length, 1);
});

test("buildSoxlEquivalentSeries: 騰落率は補正係数に影響されない（スケール変換前後で%は不変）", () => {
  const pre = [
    { date: new Date("2010-03-08"), price: 10 },
    { date: new Date("2010-03-09"), price: 10.5 }, // +5%
  ];
  const soxl = [{ date: new Date("2010-03-11"), price: 20 }];
  const r = buildSoxlEquivalentSeries(pre, soxl);
  const ret = r.series[1].price / r.series[0].price - 1;
  assert.ok(Math.abs(ret - 0.05) < 1e-9);
});
