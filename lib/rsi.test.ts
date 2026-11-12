// 実行: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRsi } from "./rsi.ts";

test("computeRsi：ワイルダーの原典の計算例（14日）と一致する", () => {
  // Wilder 方式の検証でよく使われる系列（StockCharts の RSI 解説の例）。15日目の RSI は約70.53、以降 66.32, 66.55 …
  const c = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.00, 46.03, 46.41, 46.22, 45.64];
  const r = computeRsi(c, 14);
  for (let i = 0; i < 14; i++) assert.equal(r[i], null);
  assert.ok(Math.abs(r[14]! - 70.5) <= 0.1, `${r[14]}`);
  assert.ok(Math.abs(r[15]! - 66.3) <= 0.1, `${r[15]}`);
  assert.ok(Math.abs(r[16]! - 66.6) <= 0.15, `${r[16]}`);
});

test("computeRsi：上がり続ければ100、下がり続ければ0、横ばいは50", () => {
  const up = Array.from({ length: 30 }, (_, i) => 100 + i);
  const down = Array.from({ length: 30 }, (_, i) => 100 - i);
  assert.equal(computeRsi(up).at(-1), 100);
  assert.equal(computeRsi(down).at(-1), 0);
  assert.equal(computeRsi(new Array(30).fill(100)).at(-1), 50);
  assert.deepEqual(computeRsi([1, 2, 3]), [null, null, null]);
});
