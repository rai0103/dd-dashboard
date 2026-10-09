import { test } from "node:test";
import assert from "node:assert/strict";
import { closeOnOrBefore, shiftDays, shiftMonths, computeChanges, type Close } from "../src/marketSummary.ts";

const series: Close[] = [
  { date: "2025-10-08", close: 100 },
  { date: "2025-10-09", close: 101 },
  { date: "2026-09-30", close: 120 },
  { date: "2026-10-01", close: 121 },
  { date: "2026-10-02", close: 122 },
  { date: "2026-10-05", close: 123 },
  { date: "2026-10-06", close: 124 },
  { date: "2026-10-07", close: 125 },
  { date: "2026-10-08", close: 126 },
];

test("shiftDays / shiftMonths", () => {
  assert.equal(shiftDays("2026-10-08", 7), "2026-10-01");
  assert.equal(shiftMonths("2026-10-08", 1), "2026-09-08");
  assert.equal(shiftMonths("2026-03-31", 1), "2026-02-28"); // 月末は月末に丸める
});

test("closeOnOrBefore: 指定日以前で最も近い取引日", () => {
  assert.equal(closeOnOrBefore(series, "2026-10-03"), 122); // 土日・休場は直前の取引日（10/2）
  assert.equal(closeOnOrBefore(series, "2025-01-01"), undefined);
});

test("computeChanges: 前日・前週・前月・前年", () => {
  const c = computeChanges(series);
  assert.ok(c);
  assert.equal(c.close, 126);
  assert.equal(c.d1, Math.round(((126 / 125) - 1) * 10000) / 100); // 直前の取引日 10/7
  assert.equal(c.w1, Math.round(((126 / 121) - 1) * 10000) / 100); // 10/1 以前で最も近い = 10/1
  assert.equal(c.m1, Math.round(((126 / 101) - 1) * 10000) / 100); // 2026-09-08 以前で最も近い = 2025-10-09（系列の前半データ）
  assert.equal(c.y1, Math.round(((126 / 100) - 1) * 10000) / 100); // 2025-10-08 = 100
});

test("computeChanges: 系列が短いと null", () => {
  assert.equal(computeChanges([{ date: "2026-10-08", close: 1 }]), null);
});
