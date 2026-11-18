// 実行: node --test lib/explainer/trialPlan.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { contributionInMonth, principalAt, yearsToGoal, requiredRate, simulatePlan, cagrOf } from "./trialPlan.ts";

test("ルールどおりの入金と元本", () => {
  assert.equal(contributionInMonth("2026-01"), 450000);
  assert.equal(contributionInMonth("2026-06"), 250000);
  assert.equal(contributionInMonth("2027-01"), 50000);
  assert.equal(contributionInMonth("2025-12"), 0);
  // 11/7時点の元本：すべての資産1,102,200円−評価損益(−47,800円)＝1,150,000円と一致
  assert.equal(principalAt("2026-11-07"), 1150000);
  assert.equal(principalAt("2026-12-31"), 1400000);
});

test("目標までの年数と必要な年率", () => {
  const none = yearsToGoal(0)!;
  assert.ok(none > 99 && none < 100.1, `none=${none}`);
  const y7 = yearsToGoal(0.07)!, y10 = yearsToGoal(0.10)!;
  assert.ok(y7 > 29 && y7 < 32, `y7=${y7}`); assert.ok(y10 > 24 && y10 < 26.5, `y10=${y10}`);
  const r15 = requiredRate(15);
  assert.ok(r15 > 0.17 && r15 < 0.23, `r15=${r15}`);
  assert.ok(simulatePlan(r15, 180).pop()!.value >= 1e8);
});

test("cagrOf", () => {
  const c = cagrOf([{ date: "2000-01-01", close: 100 }, { date: "2010-01-01", close: 200 }])!;
  assert.ok(Math.abs(c.rate - (Math.pow(2, 1 / 10.0007) - 1)) < 1e-3);
});

import { trialStatus, monthlyReturn, planVsActual } from "./trialPlan.ts";
test("trialStatus・monthlyReturn・planVsActual", () => {
  const pts = [{ date: "2026-09-30", value: 1000000 }, { date: "2026-10-31", value: 1060000 }];
  const s = trialStatus("2026-11-07", 1102200, pts);
  assert.equal(s.principal, 1150000); assert.equal(s.pl, -47800);
  // 月初から：前月末1,060,000円＋11月の入金50,000円 → 1,102,200円
  assert.ok(Math.abs((s.monthPct as number) - ((1102200 - 1060000 - 50000) / 1110000) * 100) < 1e-9);
  // 年初から（スタートの年）＝トータルと同じ
  assert.ok(Math.abs((s.yearPct as number) - s.plPct) < 1e-9);
  assert.equal(s.contributions.length, 11);
  const m = monthlyReturn(pts, "2026-10")!;
  assert.ok(Math.abs(m.pct - ((1060000 - 1000000 - 50000) / 1050000) * 100) < 1e-9);
  const pv = planVsActual(pts, "2026-10", 0.2);
  assert.equal(pv.length, 10); assert.equal(pv[9].actual, 1060000); assert.equal(pv[0].actual, null);
});
