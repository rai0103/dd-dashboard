import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeStockCatalogs } from "./stockCatalog.ts";
import type { StockCatalog } from "./types.ts";

const sp500: StockCatalog = {
  instrumentLabel: "S&P500",
  asOf: "2026-10-27",
  scalars: { dayChange: { label: "前日比", value: 1.2 } },
  series: { recent30d: { label: "直近30日", points: [{ label: "10/1", value: 100 }] } },
};
const soxl: StockCatalog = {
  instrumentLabel: "SOXL",
  asOf: "2026-10-27",
  scalars: { dayChange: { label: "前日比", value: 3.4 } },
  series: {},
};

test("同じキー名(dayChange)でも銘柄ごとに接頭辞が付き衝突しない", () => {
  const merged = mergeStockCatalogs([sp500, soxl]);
  assert.equal(merged.scalars["S&P500::dayChange"].value, 1.2);
  assert.equal(merged.scalars["SOXL::dayChange"].value, 3.4);
  assert.equal(merged.scalars["S&P500::dayChange"].label, "S&P500：前日比");
  assert.equal(merged.series["S&P500::recent30d"].points[0].label, "10/1");
});

test("instrumentLabelはスラッシュ区切りではなく「・」で連結される", () => {
  const merged = mergeStockCatalogs([sp500, soxl]);
  assert.equal(merged.instrumentLabel, "S&P500・SOXL");
});

test("未読み込み(null/undefined)・空のcatalogは無視される", () => {
  const empty: StockCatalog = { instrumentLabel: "空", asOf: "", scalars: {}, series: {} };
  const merged = mergeStockCatalogs([null, undefined, empty, sp500]);
  assert.equal(merged.instrumentLabel, "S&P500");
  assert.equal(Object.keys(merged.scalars).length, 1);
});

test("全て空ならinstrumentLabel・asOfも空のまま返す", () => {
  const merged = mergeStockCatalogs([null, undefined]);
  assert.equal(merged.instrumentLabel, "");
  assert.equal(merged.asOf, "");
  assert.deepEqual(merged.scalars, {});
  assert.deepEqual(merged.series, {});
});
