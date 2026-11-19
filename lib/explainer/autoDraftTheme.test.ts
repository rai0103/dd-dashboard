// 実行: node --test lib/explainer/autoDraftTheme.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { pickGenres, THEME_GENRES } from "./autoDraftTheme.ts";

test("pickGenres：指定なしは全ジャンルからシャッフル、指定ありはその中だけ", () => {
  const all = pickGenres([], 6);
  assert.equal(new Set(all).size, 6);
  assert.deepEqual([...all].sort(), THEME_GENRES.map((g) => g.key).sort());
  const two = pickGenres(["jp-economy", "world-news"], 5);
  assert.equal(two.length, 5);
  assert.ok(two.every((k) => k === "jp-economy" || k === "world-news"));
  for (let i = 1; i < two.length; i++) assert.notEqual(two[i], two[i - 1]);
  assert.deepEqual(pickGenres(["jp-company"], 3), ["jp-company", "jp-company", "jp-company"]);
  assert.equal(pickGenres(["unknown"], 2).length, 2); // 知らないジャンルだけなら全ジャンルから
});
