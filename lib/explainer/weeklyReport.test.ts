// 実行: node --test lib/explainer/weeklyReport.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWeeklyData, parsePurchases, shortFundName, yenJp } from "./weeklyReportCore.ts";

test("parsePurchases・shortFundName・yenJp", () => {
  assert.deepEqual(parsePurchases("S&P500 30000\n金：2万円\n\nNF日経レバ, 10,000円"), [{ name: "S&P500", amount: 30000 }, { name: "金", amount: 20000 }, { name: "NF日経レバ", amount: 10000 }]);
  assert.equal(shortFundName("eMAXIS Slim 米国株式(S&P500)"), "S&P500");
  assert.equal(shortFundName("iFreeレバレッジ FANG＋"), "FANG+レバレッジ");
  assert.equal(shortFundName("NF日経レバ"), "日経レバ");
  assert.equal(yenJp(1121460), "112万1460円");
  assert.equal(yenJp(-32899), "マイナス3万2899円");
  assert.equal(yenJp(50000), "5万円");
  assert.equal(yenJp(800), "800円");
});

test("buildWeeklyData：前週（5日以上前）のスクショと比べ、買い付け分を除いた値動きにする", () => {
  const snaps = [
    { date: "2026-11-01", items: { "eMAXIS Slim 米国株式(S&P500)": 200000, "1540 純金上場信託": 100000 } },
    { date: "2026-11-05", items: { "eMAXIS Slim 米国株式(S&P500)": 205000, "1540 純金上場信託": 101000 } },
    { date: "2026-11-08", items: { "eMAXIS Slim 米国株式(S&P500)": 240000, "1540 純金上場信託": 99000 } },
  ];
  const d = buildWeeklyData(snaps, [{ name: "S&P500", amount: 30000 }])!;
  assert.equal(d.prevDate, "2026-11-01");
  const sp = d.rows.find((r) => r.short === "S&P500")!;
  assert.equal(sp.buy, 30000); assert.equal(sp.change, 10000); assert.ok(Math.abs((sp.pct as number) - (10000 / 230000) * 100) < 1e-9);
  assert.equal(d.total, 339000); assert.equal(d.change, 339000 - 300000 - 30000);
  assert.equal(buildWeeklyData([{ date: "2026-11-08", items: { A: 1 } }])!.prevDate, null);
});
