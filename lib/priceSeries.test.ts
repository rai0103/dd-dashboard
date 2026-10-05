// 実行: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { importUserPrices, applyApiGold, resetPriceField, goldHistoryFetchStart, type PriceRecord } from "./priceSeries.ts";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const goldOf = (series: PriceRecord[], s: string) => series.find((p) => p.date.toISOString().slice(0, 10) === s);

test("API取得値はCSV取り込み済みの日のゴールドを上書きしない", () => {
  const csv = importUserPrices([], "gold", [{ date: d("2026-10-01"), price: 4100 }, { date: d("2026-10-02"), price: 4120 }]);
  const { series, changed } = applyApiGold(csv, [{ date: d("2026-10-02"), price: 9999 }]);
  assert.equal(changed, false);
  assert.deepEqual(goldOf(series, "2026-10-02"), { date: d("2026-10-02"), gold: 4120 });
});

test("API取得値は直接入力（1日分）のゴールドも上書きしない", () => {
  const manual = importUserPrices([{ date: d("2026-10-05"), voo: 700 }], "gold", [{ date: d("2026-10-05"), price: 4150 }]);
  const { series } = applyApiGold(manual, [{ date: d("2026-10-05"), price: 4158.43 }]);
  assert.equal(goldOf(series, "2026-10-05")?.gold, 4150);
  assert.equal(goldOf(series, "2026-10-05")?.goldSrc, undefined);
});

test("API取得値は未登録の日を埋め、同じ日のVOO/QQQは残す", () => {
  const base: PriceRecord[] = [{ date: d("2026-10-02"), voo: 707.5, qqq: 749.6 }];
  const { series, changed } = applyApiGold(base, [{ date: d("2026-10-02"), price: 4141.5 }, { date: d("2026-09-30"), price: 4156.5 }]);
  assert.equal(changed, true);
  assert.deepEqual(goldOf(series, "2026-10-02"), { date: d("2026-10-02"), voo: 707.5, qqq: 749.6, gold: 4141.5, goldSrc: "api" });
  assert.deepEqual(series.map((p) => p.date.toISOString().slice(0, 10)), ["2026-09-30", "2026-10-02"]);
});

test("前回APIで登録した日は、後のAPI取得（取引中の値の更新）で上書きしてよい", () => {
  const first = applyApiGold([], [{ date: d("2026-10-05"), price: 4150 }]).series;
  const { series, changed } = applyApiGold(first, [{ date: d("2026-10-05"), price: 4160 }]);
  assert.equal(changed, true);
  assert.equal(goldOf(series, "2026-10-05")?.gold, 4160);
});

test("同じ値の再取得は変更なし扱い（保存・同期しない）", () => {
  const first = applyApiGold([], [{ date: d("2026-10-05"), price: 4150 }]).series;
  const res = applyApiGold(first, [{ date: d("2026-10-05"), price: 4150 }]);
  assert.equal(res.changed, false);
  assert.equal(res.series, first);
});

test("API登録済みの日にCSVを取り込むとCSVの値になり、以後のAPI取得では上書きされない", () => {
  const api = applyApiGold([], [{ date: d("2026-10-02"), price: 4141.5 }]).series;
  const csv = importUserPrices(api, "gold", [{ date: d("2026-10-02"), price: 4130 }]);
  assert.deepEqual(goldOf(csv, "2026-10-02"), { date: d("2026-10-02"), gold: 4130 });
  assert.equal(goldOf(applyApiGold(csv, [{ date: d("2026-10-02"), price: 4141.5 }]).series, "2026-10-02")?.gold, 4130);
});

test("VOO/QQQのCSV取り込みは同じ日のゴールドとその由来を残す", () => {
  const api = applyApiGold([], [{ date: d("2026-10-02"), price: 4141.5 }]).series;
  const next = importUserPrices(api, "voo", [{ date: d("2026-10-02"), price: 707.5 }]);
  assert.deepEqual(goldOf(next, "2026-10-02"), { date: d("2026-10-02"), gold: 4141.5, goldSrc: "api", voo: 707.5 });
});

test("ゴールドの初期化はAPI由来の印も消し、空になった日は除去する", () => {
  const series: PriceRecord[] = [{ date: d("2026-10-01"), gold: 4100, goldSrc: "api" }, { date: d("2026-10-02"), voo: 707.5, gold: 4120 }];
  assert.deepEqual(resetPriceField(series, "gold"), [{ date: d("2026-10-02"), voo: 707.5 }]);
});

test("履歴の再取得：未登録なら全期間、3日超空いたら最終日以降、週末をまたぐだけなら不要", () => {
  assert.deepEqual(goldHistoryFetchStart([{ date: d("2026-10-02"), voo: 1 }], d("2026-10-05")), { startDate: null });
  assert.deepEqual(goldHistoryFetchStart([{ date: d("2026-09-25"), gold: 1 }], d("2026-10-05")), { startDate: "2026-09-25" });
  assert.equal(goldHistoryFetchStart([{ date: d("2026-10-02"), gold: 1 }], d("2026-10-05")), null);
});
