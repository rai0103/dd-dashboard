// 実行: node --test lib/beginnerTrialSeed.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { withInitialSnapshot } from "./beginnerTrialSeed.ts";

test("withInitialSnapshot：最初の買い付けを先頭に足し、取り込み済みの銘柄名に合わせる", () => {
  const out = withInitialSnapshot([{ date: "2026-11-10", items: { "iFreeレバレッジ FANG+": 201610, "eMAXIS Slim 米国株式（S&P500）": 215692 } }]);
  assert.equal(out.length, 2);
  assert.equal(out[0].date, "2026-01-10");
  assert.equal(out[0].items["iFreeレバレッジ FANG+"], 97968);
  assert.equal(out[0].items["eMAXIS Slim 米国株式（S&P500）"], 100195);
  assert.equal(Object.values(out[0].items).reduce((a, b) => a + b, 0), 399121);
  // 同じ日の取り込みがあれば足さない
  assert.equal(withInitialSnapshot([{ date: "2026-01-10", items: { A: 1 } }]).length, 1);
});
