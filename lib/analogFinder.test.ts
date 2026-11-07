// 実行: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { findHistoricalAnalogs, DEFAULT_ANALOG_CHECKPOINTS, DEFAULT_ANALOG_TOLERANCE_PCT } from "./analogFinder.ts";

const mk = (closes: number[]) => closes.map((close, i) => ({ date: `2020-01-${String(i + 1).padStart(2, "0")}`, close }));

test("基準点を1つずつ適用してファネルで絞り込み、最終的に一致した日を見つける（手計算で検証可能な合成データ）", () => {
  // i=14〜19は、i=5〜10を1.3倍しただけの相似形（比率＝トレーリングリターンが完全一致する）。
  // そのため「今日」(i=19)の指紋は i=10 の指紋と完全一致するはず。
  const closes = [100, 101, 99, 103, 97, 100, 104, 98, 106, 95, 110, 120, 90, 130, 130, 135.2, 127.4, 137.8, 123.5, 143];
  const points = mk(closes);
  const r = findHistoricalAnalogs(points, {
    checkpoints: [{ label: "2日前", lookbackDays: 2 }, { label: "5日前", lookbackDays: 5 }],
    tolerancePct: 0.5,
    excludeRecentDays: 2, // 候補範囲: i=5〜17
    minClusterGapDays: 1,
  })!;
  assert.ok(r);
  assert.equal(r.asOfDate, "2020-01-20");
  // target: 2日前=3.8%, 5日前=10.0%
  assert.deepEqual(r.checkpointTargets.map((t) => t.targetPct), [3.8, 10.0]);
  // ファネル：1つ目の基準点だけでは i=10, i=15 の2件が残り、2つ目を適用すると i=10 の1件に絞られる
  assert.deepEqual(r.funnel.map((f) => f.remaining), [2, 1]);
  assert.equal(r.matches.length, 1);
  assert.equal(r.matchedSteps, 2);
  assert.equal(r.matches[0].idx, 10);
  assert.equal(r.matches[0].date, "2020-01-11");
  assert.equal(r.matches[0].distance, 0);
  assert.deepEqual(r.matches[0].checkpointPct, [3.8, 10.0]);
  // forward: 一致日(i=10, close=110)を0%として、データが続く範囲（今日=i=19）までの値動き
  assert.equal(r.matches[0].forward.length, 10);
  assert.equal(r.matches[0].forward[0].pct, 0);
  assert.equal(r.matches[0].forward[r.matches[0].forward.length - 1].pct, 30.0); // 143/110-1 = 30%
  // currentPath: 既定のleadInDaysは基準点の最長ルックバック（5）。x=-5〜0・今日(i=19,close=143)を0%とする
  assert.equal(r.currentPath.length, 6);
  assert.deepEqual(r.currentPath.map((p) => p.x), [-5, -4, -3, -2, -1, 0]);
  assert.equal(r.currentPath[r.currentPath.length - 1].pct, 0);
  // x=-5 → i=14（当日=今日を0%とする基準なので、5日前の水準は close[14]/close[19]-1）
  assert.equal(r.currentPath[0].pct, Math.round((closes[14] / 143 - 1) * 1000) / 10);
});

test("近接した候補は距離が小さいほうを優先して間引く（同じ局面の重複排除）", () => {
  // 1営業日騰落率: i=1..9 の実現値。today=i=9（+2%）。目標+2%・許容0.3に対し、
  // i=1,2,3,7,8 が一致候補（距離はすべて0で同点）。minClusterGapDays=2で間引くと、
  // i=2は直前のi=1に近すぎて脱落、i=3はi=1からちょうど2（境界なので脱落しない）で残る。
  const r1 = [2, 2, 2, 5, 5, -3, 2, 2, 2];
  let p = 100;
  const closes = [p, ...r1.map((pct) => (p *= 1 + pct / 100))];
  const points = mk(closes);
  const r = findHistoricalAnalogs(points, {
    checkpoints: [{ label: "1日前", lookbackDays: 1 }],
    tolerancePct: 0.3,
    excludeRecentDays: 1, // 候補範囲: i=1〜8
    minClusterGapDays: 2,
    maxMatches: 10,
  })!;
  assert.ok(r);
  assert.equal(r.funnel[0].remaining, 5); // i=1,2,3,7,8
  assert.deepEqual(r.matches.map((m) => m.idx), [1, 3, 7]);
});

test("基準点をすべて計算できるだけの履歴が無い場合はnull", () => {
  const points = mk(Array.from({ length: 10 }, (_, i) => 100 + i));
  assert.equal(findHistoricalAnalogs(points, { checkpoints: [{ label: "20日前", lookbackDays: 20 }] }), null);
});

test("既定の基準点（DEFAULT_ANALOG_CHECKPOINTS）は6点・既定の許容幅は±0.5", () => {
  assert.deepEqual(DEFAULT_ANALOG_CHECKPOINTS.map((c) => c.lookbackDays), [1, 10, 30, 90, 180, 252]);
  assert.equal(DEFAULT_ANALOG_TOLERANCE_PCT, 0.5);
});

test("全基準点で一致する日が無いときは、1件以上残った最も深い段の候補を返す（matchedStepsで段数を示す）", () => {
  // 1つ目の基準点（1日前）は一致する日があるが、2つ目（5日前）まで一致する日は無いデータ
  const r1 = [2, 2, 2, 5, 5, -3, 7, 2, 2];
  let p = 100;
  const closes = [p, ...r1.map((pct) => (p *= 1 + pct / 100))];
  const r = findHistoricalAnalogs(mk(closes), {
    checkpoints: [{ label: "1日前", lookbackDays: 1 }, { label: "3日前", lookbackDays: 3 }],
    tolerancePct: 0.3,
    excludeRecentDays: 1,
    minClusterGapDays: 1,
    maxMatches: 10,
  })!;
  assert.ok(r);
  assert.equal(r.funnel[1].remaining, 0);
  assert.ok(r.funnel[0].remaining > 0);
  assert.equal(r.matchedSteps, 1);
  assert.equal(r.matches.length, r.funnel[0].remaining);
  // 距離は一致している段（1日前）だけで測るので、すべて許容幅以内
  assert.ok(r.matches.every((m) => m.distance <= 0.3));
});
