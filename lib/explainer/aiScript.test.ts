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
