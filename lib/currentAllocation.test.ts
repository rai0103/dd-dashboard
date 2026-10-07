// 実行: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { amountsByClass, largestRemainderPercent, allocationDiff, topHoldingsByClass, ddLabel, ALLOCATION_CATS } from "./currentAllocation.ts";

const sum = (v: Record<string, number>) => ALLOCATION_CATS.reduce((s, c) => s + v[c], 0);

test("最大剰余法：合計がちょうど100%、端数の大きいクラスに配る", () => {
  // 1/3ずつ（A・B・C）→ 34/33/33
  assert.deepEqual(largestRemainderPercent({ A: 1, B: 1, C: 1, D: 0, E: 0 }), { A: 34, B: 33, C: 33, D: 0, E: 0 });
  // 16.6 / 9.0 / 17.4 / 40.9 / 16.1（画面の例に近い値）→ 四捨五入だと合計100にならないケースも100になる
  const r = largestRemainderPercent({ A: 1699, B: 922, C: 1785, D: 4192, E: 1644 })!;
  assert.equal(sum(r), 100);
  assert.deepEqual(r, { A: 17, B: 9, C: 17, D: 41, E: 16 });
  // 6クラス均等に近い値をランダムに作っても常に100
  for (let i = 0; i < 200; i++) {
    const v = { A: Math.random() * 1e6, B: Math.random() * 1e6, C: Math.random() * 1e6, D: Math.random() * 1e6, E: Math.random() * 1e6 };
    assert.equal(sum(largestRemainderPercent(v)!), 100);
  }
  assert.equal(largestRemainderPercent({ A: 0, B: 0, C: 0, D: 0, E: 0 }), null); // 資産データ未登録
});

test("クラス別合計・主な銘柄・差（A〜E以外のrankは数えない）", () => {
  const hs = [{ name: "GLD", rank: "A", amount: 300 }, { name: "現金", rank: "A", amount: 500 }, { name: "GLD", rank: "A", amount: 100 }, { name: "VOO", rank: "C", amount: 1000 }, { name: "?", rank: "", amount: 999 }];
  assert.deepEqual(amountsByClass(hs), { A: 900, B: 0, C: 1000, D: 0, E: 0 });
  assert.deepEqual(topHoldingsByClass(hs, "A", 2), [{ name: "現金", amount: 500 }, { name: "GLD", amount: 400 }]);
  assert.deepEqual(allocationDiff({ A: 17, B: 9, C: 17, D: 41, E: 16 }, { A: 15, B: 13, C: 40, D: 20, E: 12 }), { A: 2, B: -4, C: -23, D: 21, E: 4 });
});

test("VOOのDDラベル", () => {
  assert.equal(ddLabel(0), "VOO ATH");
  assert.equal(ddLabel(-4.23), "VOO DD −4.2%");
  assert.equal(ddLabel(-4.23, true), "−4.2%");
  assert.equal(ddLabel(0, true), "ATH");
  assert.equal(ddLabel(NaN), null);
  assert.equal(ddLabel(undefined), null);
});
