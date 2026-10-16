// 実行: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNdxPreQqqCsv, buildQqqEquivalentSeries } from "./qqqSynthetic.ts";

test("parseNdxPreQqqCsv: ヘッダー行を除き、日付昇順でDatedPrice[]を返す（バンドル済みNDXデータの健全性確認）", () => {
  const series = parseNdxPreQqqCsv();
  assert.ok(series.length > 3000); // 1985/1/31〜1999/3/9の営業日数（約3500件）
  assert.equal(series[0].date.toISOString().slice(0, 10), "1985-01-31");
  assert.ok(series[0].price > 0);
  for (let i = 1; i < series.length; i++) assert.ok(series[i].date.getTime() > series[i - 1].date.getTime());
  // QQQ上場日（1999/3/10）以降のデータは含まれていないこと
  const last = series[series.length - 1];
  assert.ok(last.date.getTime() < new Date("1999-03-10T00:00:00.000Z").getTime());
});

test("buildQqqEquivalentSeries: 重複日が無い場合（通常ケース）、NDX最終日とQQQ最初日の値を段差なくつなぐ", () => {
  const ndx = [
    { date: new Date("2000-01-03"), price: 100 },
    { date: new Date("2000-01-04"), price: 110 }, // 最終日
  ];
  const qqq = [
    { date: new Date("2000-01-05"), price: 55 }, // 最初日（重複なし）
    { date: new Date("2000-01-06"), price: 60 },
  ];
  const r = buildQqqEquivalentSeries(ndx, qqq);
  assert.equal(r.mode, "spliced-boundary");
  assert.equal(r.series.length, 4);
  // 補正係数 = qqq[0].price / ndx最終日.price = 55/110 = 0.5
  assert.equal(r.factor, 0.5);
  assert.equal(r.series[0].price, 50); // 100 * 0.5
  assert.equal(r.series[1].price, 55); // 110 * 0.5（接続点でqqq[0]の55と一致＝段差なし）
  assert.equal(r.series[1].price, qqq[0].price);
  assert.equal(r.series[2].price, 55);
  assert.equal(r.series[3].price, 60);
});

test("buildQqqEquivalentSeries: 重複日がある場合、SP500→VOOの合成（lib/sp500Synthetic.ts）と同じ方式で最新の重複日で接続する", () => {
  const ndx = [
    { date: new Date("2000-01-03"), price: 100 },
    { date: new Date("2000-01-04"), price: 110 },
    { date: new Date("2000-01-05"), price: 120 }, // QQQ側にも値がある
  ];
  const qqq = [
    { date: new Date("2000-01-05"), price: 60 },
    { date: new Date("2000-01-06"), price: 66 },
  ];
  const r = buildQqqEquivalentSeries(ndx, qqq);
  assert.equal(r.mode, "spliced-overlap");
  assert.equal(r.junctionDate, "2000-01-05");
  assert.equal(r.factor, 0.5); // 60/120
  assert.equal(r.series.length, 4); // ndxの2000-01-03,04（換算）+ qqqの01-05,06
  assert.equal(r.series[1].price, 55); // 110*0.5
});

test("buildQqqEquivalentSeries: QQQデータが空ならNDXのみ、NDXデータが空ならQQQのみを返す", () => {
  const ndx = [{ date: new Date("2000-01-03"), price: 100 }];
  const qqq = [{ date: new Date("2000-01-05"), price: 55 }];
  const r1 = buildQqqEquivalentSeries(ndx, []);
  assert.equal(r1.mode, "ndx-only");
  assert.equal(r1.series.length, 1);
  const r2 = buildQqqEquivalentSeries([], qqq);
  assert.equal(r2.mode, "qqq-only");
  assert.equal(r2.series.length, 1);
});

test("buildQqqEquivalentSeries: 騰落率は補正係数に影響されない（スケール変換前後で%は不変）", () => {
  const ndx = [
    { date: new Date("2000-01-03"), price: 100 },
    { date: new Date("2000-01-04"), price: 105 }, // +5%
  ];
  const qqq = [{ date: new Date("2000-01-05"), price: 200 }];
  const r = buildQqqEquivalentSeries(ndx, qqq);
  const ret = r.series[1].price / r.series[0].price - 1;
  assert.ok(Math.abs(ret - 0.05) < 1e-9);
});
