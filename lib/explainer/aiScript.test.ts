import { test } from "node:test";
import assert from "node:assert/strict";
import { applyStockDataKeysToScene, header } from "./aiScript.ts";
import type { GenerateInput } from "./aiScript.ts";
import type { StockCatalog } from "./types.ts";

const catalog: StockCatalog = {
  instrumentLabel: "S&P500",
  asOf: "2026-10-27",
  scalars: {
    dayChange: { label: "前日比", value: 1.23 },
    dd: { label: "現在のDD", value: -4.5 },
  },
  series: {
    recent30d: {
      label: "直近30日",
      points: [
        { label: "10/1", value: 100 },
        { label: "10/8", value: 102.5 },
        { label: "10/15", value: 98.1 },
        { label: "10/22", value: 101.9 },
      ],
    },
  },
};

test("dataKeyが一致するbar/donut/numberのitemはlabel・valueが実データに差し替わる", () => {
  const raw = {
    title: "前日比", caption: "", narration: "", reading: "",
    visual: {
      kind: "bar", heading: "", subheading: "",
      items: [
        { label: "仮", value: "0", text: "", icon: "chip", dataKey: "scalars.dayChange" },
        { label: "仮2", value: "0", text: "", icon: "chip", dataKey: "scalars.dd" },
      ],
      unit: "", source: "", emphasis: "", imagePrompt: "",
    },
  };
  const out = applyStockDataKeysToScene(raw, catalog);
  assert.equal(out.visual.items[0].label, "前日比");
  assert.equal(out.visual.items[0].value, "1.2");
  assert.equal(out.visual.items[1].label, "現在のDD");
  assert.equal(out.visual.items[1].value, "-4.5");
});

test("dataKeyが存在しないキーを指すitemはvalueが空になる（でっち上げを防ぐ）", () => {
  const raw = {
    title: "", caption: "", narration: "", reading: "",
    visual: {
      kind: "number", heading: "", subheading: "",
      items: [{ label: "仮", value: "999", text: "", icon: "chip", dataKey: "scalars.nonexistent" }],
      unit: "", source: "", emphasis: "", imagePrompt: "",
    },
  };
  const out = applyStockDataKeysToScene(raw, catalog);
  assert.equal(out.visual.items[0].value, "");
});

test("lineのseriesKeyが一致すれば、itemsがカタログの点列にそのまま差し替わる", () => {
  const raw = {
    title: "", caption: "", narration: "", reading: "",
    visual: {
      kind: "line", heading: "", subheading: "",
      items: [{ label: "仮", value: "0", text: "", icon: "chip" }],
      unit: "", source: "", emphasis: "", imagePrompt: "", seriesKey: "series.recent30d",
    },
  };
  const out = applyStockDataKeysToScene(raw, catalog);
  assert.equal(out.visual.items.length, 4);
  assert.equal(out.visual.items[0].label, "10/1");
  assert.equal(out.visual.items[0].value, "100");
  assert.equal(out.visual.heading, "直近30日");
});

test("lineのseriesKeyが未指定・不一致のときはitemsのvalueを空にし、normalizeVisualのpointsフォールバックに委ねる", () => {
  const raw = {
    title: "", caption: "", narration: "", reading: "",
    visual: {
      kind: "line", heading: "", subheading: "",
      items: [{ label: "仮", value: "123", text: "", icon: "chip" }],
      unit: "", source: "", emphasis: "", imagePrompt: "", seriesKey: "series.doesnotexist",
    },
  };
  const out = applyStockDataKeysToScene(raw, catalog);
  assert.equal(out.visual.items[0].value, "");
});

test("catalogが無い（ニュース・キーワードモード）場合はシーンをそのまま返す", () => {
  const raw = {
    title: "", caption: "", narration: "", reading: "",
    visual: { kind: "bar", heading: "", subheading: "", items: [{ label: "A", value: "10", text: "", icon: "chip", dataKey: "scalars.dayChange" }], unit: "", source: "", emphasis: "", imagePrompt: "" },
  };
  const out = applyStockDataKeysToScene(raw, undefined);
  assert.equal(out, raw);
});

test("donutの一部itemだけdataKey不一致でも、一致したitemだけが実データに差し替わる", () => {
  const raw = {
    title: "", caption: "", narration: "", reading: "",
    visual: {
      kind: "donut", heading: "", subheading: "",
      items: [
        { label: "A", value: "0", text: "", icon: "chip", dataKey: "scalars.dayChange" },
        { label: "B", value: "50", text: "", icon: "chip" },
      ],
      unit: "", source: "", emphasis: "", imagePrompt: "",
    },
  };
  const out = applyStockDataKeysToScene(raw, catalog);
  assert.equal(out.visual.items[0].value, "1.2");
  assert.equal(out.visual.items[1].value, "");
});

// [Stage E-7] header()のテスト用の最小GenerateInput
const baseHeaderInput: GenerateInput = {
  topic: "テスト用テーマ",
  mode: "news",
  audience: "general",
  targetMinutes: 5,
  extraInstruction: "",
  refBlocks: [],
  today: "2026-10-28",
};

// [Stage E-9] 年比較グラフ（yearCompare）：visual.seriesKeysで指定したyearCompare.*のキーが
// 実データの複数系列（items、seriesKeyでグループ化）に差し替わることの確認
const catalogWithYearCompare: StockCatalog = {
  ...catalog,
  yearCompare: {
    xLabel: "年初からの経過日数",
    unit: "（指数・年初=100）",
    series: {
      curYear: { label: "今年", emphasis: true, points: [{ x: 0, value: 100 }, { x: 100, value: 103 }, { x: 200, value: 106 }] },
      allYears: { label: "全期間平均", emphasis: false, points: [{ x: 0, value: 100 }, { x: 100, value: 101.5 }, { x: 200, value: 103 }] },
      y2018: { label: "2018年", emphasis: false, points: [{ x: 0, value: 100 }, { x: 100, value: 95 }] },
    },
  },
};

test("yearCompare：seriesKeysで指定した系列が実データの複数系列（items）に差し替わる", () => {
  const raw = {
    title: "年比較", caption: "", narration: "", reading: "",
    visual: { kind: "yearCompare", heading: "", subheading: "", items: [], unit: "", source: "", emphasis: "", imagePrompt: "", seriesKeys: ["yearCompare.curYear", "yearCompare.allYears"] },
  };
  const out = applyStockDataKeysToScene(raw, catalogWithYearCompare);
  assert.equal(out.visual.items.length, 6);
  const curYearItems = out.visual.items.filter((it: any) => it.seriesKey === "curYear");
  assert.equal(curYearItems.length, 3);
  assert.equal(curYearItems[0].seriesLabel, "今年");
  assert.equal(curYearItems[0].seriesEmphasis, true);
  assert.equal(curYearItems[1].x, 100);
  assert.equal(curYearItems[1].value, "103");
  const allYearsItems = out.visual.items.filter((it: any) => it.seriesKey === "allYears");
  assert.equal(allYearsItems.length, 3);
  assert.equal(allYearsItems[0].seriesEmphasis, false);
});

test("yearCompare：存在しないキーは無視され、3点未満の系列（y2018の2点）は8個上限内なら含まれる", () => {
  const raw = {
    title: "年比較", caption: "", narration: "", reading: "",
    visual: { kind: "yearCompare", heading: "", subheading: "", items: [], unit: "", source: "", emphasis: "", imagePrompt: "", seriesKeys: ["yearCompare.curYear", "yearCompare.notExist", "yearCompare.y2018"] },
  };
  const out = applyStockDataKeysToScene(raw, catalogWithYearCompare);
  const keys = new Set(out.visual.items.map((it: any) => it.seriesKey));
  assert.equal(keys.has("notExist"), false);
  assert.equal(keys.has("curYear"), true);
  assert.equal(keys.has("y2018"), true);
});

test("yearCompare：catalog.yearCompareが無い場合はitemsが空になる（normalizeVisualのpoints降格に委ねる）", () => {
  const raw = {
    title: "年比較", caption: "", narration: "", reading: "",
    visual: { kind: "yearCompare", heading: "", subheading: "", items: [], unit: "", source: "", emphasis: "", imagePrompt: "", seriesKeys: ["yearCompare.curYear"] },
  };
  const out = applyStockDataKeysToScene(raw, catalog); // yearCompareフィールドを持たない通常のcatalog
  assert.deepEqual(out.visual.items, []);
});

// [Stage E-10] 視聴者種別に「専門的」（expert）を追加：基本用語の説明を省き、専門用語・根拠まで踏み込む想定視聴者がheader()に反映される
test("header：audience='expert'のときは専門家向けの想定視聴者文が出力される", () => {
  const out = header({ ...baseHeaderInput, audience: "expert" });
  assert.ok(out.includes("【想定視聴者】"));
  assert.ok(out.includes("実務家・専門家レベル"));
});

test("header：requiredRefNotesが無ければ「必ず扱う参考情報」ブロックは出力されない", () => {
  const out = header(baseHeaderInput);
  assert.equal(out.includes("必ず扱う参考情報"), false);
});

test("header：requiredRefNotesがあれば、各項目を列挙した「必ず扱う参考情報」ブロックが追加される", () => {
  const out = header({ ...baseHeaderInput, requiredRefNotes: ["メモ（テキスト）", "任天堂（CSV（株価データ）)"] });
  assert.ok(out.includes("【必ず扱う参考情報】"));
  assert.ok(out.includes("・メモ（テキスト）"));
  assert.ok(out.includes("・任天堂（CSV（株価データ）)"));
});
