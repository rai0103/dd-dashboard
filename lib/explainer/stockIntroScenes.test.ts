import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStockIntroScenes } from "./stockIntroScenes.ts";
import { isKanaReading } from "./scriptModel.ts";

const SAMPLE_FINAL_REACH = {
  totalYears: 69,
  n: 120,
  currentLabel: "-10%",
  rows: [
    { label: "-5%", p: 80, hits: 96 },
    { label: "-10%", p: 50, hits: 60 },
    { label: "-20%", p: 20, hits: 24 },
    { label: "-30%", p: 8, hits: 10 },
    { label: "-50%以上", p: 2, hits: 3 },
  ],
};

test("finalReachがあれば3場面（前提・分布・谷間）を作る", () => {
  const scenes = buildStockIntroScenes(SAMPLE_FINAL_REACH, "S&P500");
  assert.equal(scenes.length, 3);
  assert.equal(scenes[0].visual.kind, "points");
  assert.equal(scenes[1].visual.kind, "bar");
  assert.equal(scenes[1].visual.items.length, 5);
  assert.equal(scenes[1].visual.items[0].value, "96"); // -5%の発生回数
  assert.equal(scenes[2].visual.kind, "line");
  scenes.forEach((s) => assert.ok(isKanaReading(s.reading), `reading must be kana-only: ${s.reading}`));
});

test("finalReachが無ければ分布場面（②）だけスキップし、前提・谷間の2場面になる", () => {
  const scenes = buildStockIntroScenes(null, "S&P500");
  assert.equal(scenes.length, 2);
  assert.equal(scenes[0].visual.kind, "points");
  assert.equal(scenes[1].visual.kind, "line");
  scenes.forEach((s) => assert.ok(isKanaReading(s.reading)));
});

test("rowsに該当する節目が1つも無ければ分布場面は作らない", () => {
  const scenes = buildStockIntroScenes({ totalYears: 10, n: 5, currentLabel: null, rows: [{ label: "-7%", p: 1, hits: 1 }] }, "QQQ");
  assert.equal(scenes.length, 2);
});
