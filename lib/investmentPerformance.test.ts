// 実行: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { parseInvestmentExcel, latestUsdJpyRates, fxImpact } from "./investmentPerformance.ts";

test("月末ドル円：Sheet1の10行目を日付列ごとに読む（範囲外の値はnull）", async () => {
  const rows: unknown[][] = Array.from({ length: 12 }, () => []);
  rows[0] = ["", "2026/07/31", "2026/08/31", "2026/09/30"];
  rows[1] = ["総資産", 100, 110, 120];
  rows[9] = ["為替（月末）", 150.12, 1234, 148.5];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Sheet1");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  const data = await parseInvestmentExcel(buf, "test.xlsx");
  assert.deepEqual(data.series.map((p) => [p.date, p.usdJpy]), [["2026-07-31", 150.12], ["2026-08-31", null], ["2026-09-30", 148.5]]);
  assert.ok(!data.errors.some((e) => e.includes("10行目")));
});

test("直近・前月末のレート（レートの無い月は飛ばす）と影響額", () => {
  const rates = latestUsdJpyRates([{ date: "2026-07-31", usdJpy: 150 }, { date: "2026-08-31", usdJpy: null }, { date: "2026-09-30", usdJpy: 148 }]);
  assert.deepEqual(rates, { latest: { date: "2026-09-30", rate: 148 }, prev: { date: "2026-07-31", rate: 150 } });
  const { perYen, month } = fxImpact(74_000_000, rates);
  assert.equal(perYen, 500_000); // 7400万円 ÷ 148円 ＝ 50万ドル → 1円で±50万円
  assert.equal(month, -1_000_000); // 150→148円（2円の円高）で −100万円
  assert.deepEqual(fxImpact(74_000_000, latestUsdJpyRates([])), { perYen: null, month: null });
  assert.deepEqual(fxImpact(74_000_000, latestUsdJpyRates([{ date: "2026-09-30", usdJpy: 148 }])), { perYen: 500_000, month: null });
});
