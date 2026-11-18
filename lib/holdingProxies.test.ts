// 実行: node --test lib/holdingProxies.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { proxyForHolding, toJpy, leveraged, performanceRows, stackedHoldingRows, valueAt } from "./holdingProxies.ts";

test("proxyForHolding：大和コネクトの保有銘柄を代用データに割り当てる", () => {
  assert.equal(proxyForHolding("eMAXIS Slim 米国株式(S&P500)")?.key, "spx");
  assert.equal(proxyForHolding("1540 純金上場信託（現物国内保管型）")?.key, "gold");
  const fang = proxyForHolding("iFreeレバレッジ FANG＋");
  assert.equal(fang?.key, "fang"); assert.equal(fang?.sources[0].lev, 2); assert.equal(fang?.sources[0].fx, true);
  assert.equal(proxyForHolding("eMAXIS Slim 国内株式(TOPIX)")?.key, "tpx");
  assert.equal(proxyForHolding("iFree 日経225インデックス")?.key, "nkx");
  assert.equal(proxyForHolding("NF日経レバ")?.key, "nkx2");
  assert.equal(proxyForHolding("iFreeNEXT NASDAQ100インデックス")?.key, "ndx");
  assert.equal(proxyForHolding("よく分からない銘柄"), null);
});

test("toJpy・leveraged：ドル円換算と、日々の値動きの2倍", () => {
  const usd = [{ date: "2024-01-02", close: 100 }, { date: "2024-01-03", close: 110 }];
  const fx = [{ date: "2024-01-01", close: 150 }, { date: "2024-01-03", close: 140 }];
  assert.deepEqual(toJpy(usd, fx), [{ date: "2024-01-02", close: 15000 }, { date: "2024-01-03", close: 15400 }]);
  const lv = leveraged([{ date: "a", close: 100 }, { date: "b", close: 110 }, { date: "c", close: 99 }], 2);
  assert.ok(Math.abs(lv[1].close - 120) < 1e-9);
  assert.ok(Math.abs(lv[2].close - 120 * (1 + 2 * (99 / 110 - 1))) < 1e-9);
  assert.equal(valueAt(usd, "2024-01-01"), null);
});

test("performanceRows：開始日を0%にそろえる", () => {
  const rows = performanceRows({ a: [{ date: "2024-01-01", close: 100 }, { date: "2024-01-02", close: 110 }], b: [{ date: "2024-01-02", close: 50 }, { date: "2024-01-03", close: 40 }] }, "2024-01-01");
  assert.equal(rows[0].a, 0); assert.equal(rows[0].b, undefined);
  assert.ok(Math.abs((rows[1].a as number) - 10) < 1e-9); assert.equal(rows[1].b, 0);
  assert.ok(Math.abs((rows[2].b as number) + 20) < 1e-9); assert.ok(Math.abs((rows[2].a as number) - 10) < 1e-9);
});

test("stackedHoldingRows：スクショの月は実際の値、ほかの月は構成を値動きで動かして口座合計に合わせる", () => {
  const snaps = [{ date: "2026-11-10", items: { A: 600, B: 400 } }];
  const totals = [{ date: "2026-09-30", value: 500 }, { date: "2026-10-31", value: 900 }, { date: "2026-11-10", value: 1000 }];
  const price: Record<string, { date: string; close: number }[]> = { A: [{ date: "2026-09-30", close: 100 }, { date: "2026-11-10", close: 200 }], B: [{ date: "2026-09-30", close: 100 }, { date: "2026-11-10", close: 100 }] };
  const { rows, names } = stackedHoldingRows(snaps, totals, (n) => price[n] ?? null, "2026-01-01");
  assert.deepEqual(names, ["A", "B"]);
  assert.equal(rows.length, 3);
  const sep = rows[0];
  assert.equal(sep.estimated, true); assert.equal(sep.total, 500);
  // A は値が半分（300）、B はそのまま（400）→ 合計700を口座合計500に合わせる
  assert.equal(sep.A, Math.round(300 * 500 / 700)); assert.equal(sep.B, Math.round(400 * 500 / 700));
  assert.equal(rows[2].estimated, false); assert.equal(rows[2].A, 600);
});
