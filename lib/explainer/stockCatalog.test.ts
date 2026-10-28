import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeStockCatalogs, buildStockCatalogFromSnapshot, resolveYearCompareItems, resolveCatalogKey } from "./stockCatalog.ts";
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

// [Stage E-10] 実際にExplainerStudioで観測した不具合の再現：AIがseriesKeysの一部だけ「銘柄名::」接頭辞を
// 省略して指定し、2系列を要求したのに1系列しか解決できず、年比較グラフが有効系列2未満で要点カードに
// 落ちてしまっていた。resolveCatalogKeyによる接頭辞省略の救済で、両方とも解決できるようになることを確認する。
test("resolveCatalogKey：完全一致があればそのまま返す", () => {
  const record = { "S&P500::curYear": { label: "今年" } };
  assert.equal(resolveCatalogKey("S&P500::curYear", record), "S&P500::curYear");
});

test("resolveCatalogKey：接頭辞省略でも「::key」で終わる候補が1つだけなら救済する", () => {
  const record = { "S&P500::curYear": { label: "今年" }, "S&P500::cyclePos2": { label: "中間選挙2年目平均" } };
  assert.equal(resolveCatalogKey("curYear", record), "S&P500::curYear");
  assert.equal(resolveCatalogKey("cyclePos2", record), "S&P500::cyclePos2");
});

test("resolveCatalogKey：同名キーが複数銘柄にまたがる場合は解決しない（誤った銘柄のデータを使わせない）", () => {
  const record = { "S&P500::curYear": { label: "S&P500の今年" }, "SOXL::curYear": { label: "SOXLの今年" } };
  assert.equal(resolveCatalogKey("curYear", record), undefined);
});

test("resolveCatalogKey：該当なし・recordなしはundefined", () => {
  assert.equal(resolveCatalogKey("notExist", { a: 1 }), undefined);
  assert.equal(resolveCatalogKey("curYear", undefined), undefined);
});

test("resolveYearCompareItems：接頭辞を省略したseriesKeysが混在していても、両方の系列を解決できる（実際に観測した不具合の再現）", () => {
  const catalog = buildStockCatalogFromSnapshot(snapshotForYearCompare).yearCompare!;
  // snapshotForYearCompareはcurYear・allYearsの2系列。buildStockCatalogFromSnapshot単体では接頭辞が付かないため、
  // ここではmergeStockCatalogsを通して「S&P500::」接頭辞付きのyearCompareを作り、不具合と同じ状況を再現する。
  const prefixed = mergeStockCatalogs([{ instrumentLabel: "S&P500", asOf: "2026-10-27", scalars: {}, series: {}, yearCompare: catalog }]);
  // 1つ目は正しく接頭辞付き、2つ目は接頭辞を省略（実際にAIが起こした不具合のパターン）
  const items = resolveYearCompareItems(["S&P500::curYear", "allYears"], prefixed.yearCompare);
  const keys = new Set(items.map((it) => it.seriesKey));
  assert.deepEqual([...keys].sort(), ["S&P500::allYears", "S&P500::curYear"]);
});

// [Stage E-10] 実際にExplainerStudioで観測した不具合の本当の原因：yearCompareの系列はダウンサンプルせず
// 年内の実日数のまま持つため1系列で200点を超えることがあり、scriptModel.tsのnormalizeVisualがitems全体を
// 120個に切り詰める処理と組み合わさると、先頭の1系列だけで上限に達し2系列目以降が丸ごと消えていた
// （AIはseriesKeysを正しく2つ指定していたのに、片方しか残らず要点カードに降格していた）。
// resolveYearCompareItemsが系列ごとに間引く（MAX_POINTS_PER_SERIES）ことで、どちらの系列も残ることを確認する。
function longSeriesCatalog(n1: number, n2: number) {
  const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ x: Math.round((i / (n - 1)) * 365), value: 100 + i * 0.1 }));
  return {
    xLabel: "年初からの経過日数", unit: "（指数・年初=100）",
    series: {
      curYear: { label: "今年", emphasis: true, points: mk(n1) },
      cyclePos2: { label: "中間選挙年の平均", emphasis: false, points: mk(n2) },
    },
  };
}

test("resolveYearCompareItems：1系列が200点を超えても間引かれ、後続の系列が丸ごと消えない（実際に起きた不具合の再現）", () => {
  const catalog = longSeriesCatalog(206, 201); // 実際に観測した点数とほぼ同じ規模
  const items = resolveYearCompareItems(["curYear", "cyclePos2"], catalog);
  const curYearItems = items.filter((it) => it.seriesKey === "curYear");
  const cyclePos2Items = items.filter((it) => it.seriesKey === "cyclePos2");
  assert.ok(curYearItems.length >= 3, `curYearの点が残っていること（実際:${curYearItems.length}）`);
  assert.ok(cyclePos2Items.length >= 3, `cyclePos2の点が残っていること（実際:${cyclePos2Items.length}）`);
  // 全体のitem数が、normalizeVisual側の処理に悪影響を与えない程度に抑えられていること
  assert.ok(items.length <= 200, `間引かれて点数が抑えられていること（実際:${items.length}）`);
});

test("resolveYearCompareItems：60点以下の系列はそのまま（間引かれない）", () => {
  const catalog = longSeriesCatalog(10, 40);
  const items = resolveYearCompareItems(["curYear", "cyclePos2"], catalog);
  assert.equal(items.filter((it) => it.seriesKey === "curYear").length, 10);
  assert.equal(items.filter((it) => it.seriesKey === "cyclePos2").length, 40);
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
