// 実行: node --test lib/explainer/autoDraft.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { isSimilarTheme } from "./autoDraftTheme.ts";

test("isSimilarTheme：言い方を変えた同じ話題は同じとみなし、別の話題は別とみなす", () => {
  const past = ["テスラとスペースXが合併？最新情報まとめ", "日銀が政策金利を0.75%に引き上げ"];
  assert.equal(isSimilarTheme("テスラとスペースXの合併報道", past), true);
  assert.equal(isSimilarTheme("日銀、政策金利を0.75%へ引き上げ", past), true);
  assert.equal(isSimilarTheme("米雇用統計が予想を上回る", past), false);
  assert.equal(isSimilarTheme("トヨタの決算発表", past), false);
});
