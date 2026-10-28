import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeStockCatalogs, buildStockCatalogFromSnapshot, resolveYearCompareItems } from "./stockCatalog.ts";
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

// [Stage E-9] buildStockCatalogFromSnapshot：年比較グラフ用のyearCompareカタログが、ダウンサンプルせず
// 年内の実日数(x)のまま組み立てられることの確認（curYearのみemphasis:trueになる）
const snapshotForYearCompare = {
  asOf: "2026-10-27",
  instrumentLabel: "S&P500",
  catalog: {
    curYear: { label: "今年", pts: [{ t: 0, v: 100 }, { t: 0.5, v: 103.2 }, { t: 0.82, v: 106.7 }] },
    allYears: { label: "全期間平均", pts: [{ t: 0, v: 100 }, { t: 0.5, v: 101.4 }] },
  },
  scalarCatalog: {},
};

test("buildStockCatalogFromSnapshot：yearCompareはtをそのままx(日数)に変換し、curYearだけemphasis:trueになる", () => {
  const cat = buildStockCatalogFromSnapshot(snapshotForYearCompare);
  assert.ok(cat.yearCompare);
  assert.equal(cat.yearCompare!.series.curYear.emphasis, true);
  assert.equal(cat.yearCompare!.series.allYears.emphasis, false);
  assert.equal(cat.yearCompare!.series.curYear.points[1].x, Math.round(0.5 * 365));
  assert.equal(cat.yearCompare!.series.curYear.points[2].value, 106.7);
  assert.equal(cat.yearCompare!.xLabel, "年初からの経過日数");
});

test("buildStockCatalogFromSnapshot：catalogが空ならyearCompareはundefinedのまま（点が無いものは作らない）", () => {
  const cat = buildStockCatalogFromSnapshot({ asOf: "", instrumentLabel: "空", catalog: {}, scalarCatalog: {} });
  assert.equal(cat.yearCompare, undefined);
});

test("resolveYearCompareItems：指定した複数キーが系列ごとにグループ化されたVisualItem配列になる", () => {
  const cat = buildStockCatalogFromSnapshot(snapshotForYearCompare);
  const items = resolveYearCompareItems(["curYear", "allYears"], cat.yearCompare);
  assert.equal(items.length, 5); // curYear 3点 + allYears 2点
  const curYear = items.filter((it) => it.seriesKey === "curYear");
  assert.equal(curYear.length, 3);
  assert.equal(curYear[0].seriesLabel, "今年");
  assert.equal(curYear[0].seriesEmphasis, true);
});

test("resolveYearCompareItems：存在しないキー・重複キーは除外され、カタログが無ければ空配列を返す", () => {
  const cat = buildStockCatalogFromSnapshot(snapshotForYearCompare);
  const items = resolveYearCompareItems(["curYear", "notExist", "curYear"], cat.yearCompare);
  const keys = new Set(items.map((it) => it.seriesKey));
  assert.deepEqual([...keys], ["curYear"]);
  assert.deepEqual(resolveYearCompareItems(["curYear"], undefined), []);
});

test("mergeStockCatalogs：yearCompareも銘柄名プレフィックス付きで統合される", () => {
  const sp500WithYc: StockCatalog = { ...sp500, yearCompare: buildStockCatalogFromSnapshot(snapshotForYearCompare).yearCompare };
  const merged = mergeStockCatalogs([sp500WithYc, soxl]);
  assert.ok(merged.yearCompare);
  assert.equal(merged.yearCompare!.series["S&P500::curYear"].label, "S&P500：今年");
  assert.equal(merged.yearCompare!.series["S&P500::curYear"].emphasis, true);
});

test("mergeStockCatalogs：どのcatalogもyearCompareを持たなければ結果もyearCompare:undefinedのまま", () => {
  const merged = mergeStockCatalogs([sp500, soxl]);
  assert.equal(merged.yearCompare, undefined);
});

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
