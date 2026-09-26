// 実行: npm test  （Node 24 の型ストリップで .ts を直接実行する）
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  detectEpisodes, countFakeRalliesInRange, isCleanRecovery, computeDepthStats, computeLevelProgression,
  computeReboundProgression, computeLevelTransitionDays, buildStatsTable, computeBottomScore, deriveCurrentState,
  findSimilarEpisodes, depthBucketIndex, scoreBand,
} from "./bottomScore.ts";

function loadSp500(): { prices: number[]; dates: Date[] } {
  const text = readFileSync(join(import.meta.dirname, "..", "sample-data", "S&P500.csv"), "utf8").replace(/^﻿/, "");
  const rows = text.trim().split(/\r?\n/).slice(1).map((l) => { const [d, p] = l.split(","); return { date: new Date(d.replace(/\//g, "-")), price: parseFloat(p) }; })
    .filter((r) => !isNaN(r.price) && !isNaN(r.date.getTime())).sort((a, b) => a.date.getTime() - b.date.getTime());
  return { prices: rows.map((r) => r.price), dates: rows.map((r) => r.date) };
}

test("detectEpisodes: dd<0の連続区間を検出し、-3%未満の浅い押しは除外する", () => {
  const prices = [100, 98, 99, 101, 95, 90, 93, 102, 99];
  const eps = detectEpisodes(prices);
  assert.equal(eps.length, 1); // 100→98は-2%なので除外、101→90は-10.9%
  const e = eps[0];
  assert.equal(e.pre_ath_idx, 3);
  assert.equal(e.trough_idx, 5);
  assert.equal(e.resolve_idx, 7);
  assert.ok(Math.abs(e.min_dd - (90 / 101 - 1) * 100) < 1e-9);
  // 末尾まで未回復のエピソードは resolve_idx=null
  const open = detectEpisodes([100, 90, 95]);
  assert.equal(open[0].resolve_idx, null);
});

test("countFakeRallies: +3%反発後に反発前安値を割った回数を数える", () => {
  // 100→95→98(+3.2%反発)→94(95割れ=1回)→97.5(+3.7%)→93(94割れ=2回)
  assert.equal(countFakeRalliesInRange([100, 95, 98, 94, 97.5, 93], 0, 5), 2);
  // 反発が+3%未満なら数えない
  assert.equal(countFakeRalliesInRange([100, 95, 97, 94], 0, 3), 0);
});

test("isCleanRecovery: 回復局面でローカルDD-3%以下があれば二次押し目あり", () => {
  const clean = detectEpisodes([100, 90, 95, 101])[0];
  assert.equal(isCleanRecovery(clean, [100, 90, 95, 101]), true);
  const p2 = [100, 90, 96, 92, 101]; // 96→92 = -4.2%
  assert.equal(isCleanRecovery(detectEpisodes(p2)[0], p2), false);
  assert.equal(isCleanRecovery(detectEpisodes([100, 90, 95])[0], [100, 90, 95]), null);
});

test("depthBucketIndex / scoreBand の境界", () => {
  assert.equal(depthBucketIndex(-2.9), -1);
  assert.equal(depthBucketIndex(-3), 0);
  assert.equal(depthBucketIndex(-4.99), 0);
  assert.equal(depthBucketIndex(-5), 1); // ちょうど-5%は「-5%到達」として-5〜-8%側
  assert.equal(depthBucketIndex(-5.01), 1);
  assert.equal(depthBucketIndex(-45), 6);
  assert.equal(scoreBand(29.9).label, "継続警戒");
  assert.equal(scoreBand(30).label, "様子見");
  assert.equal(scoreBand(85).label, "積極買い増し目安");
});

test("computeLevelProgression / computeLevelTransitionDays: 合成データで手計算と一致", () => {
  // 局面1: -12%まで / 局面2: -6%まで / 局面3: -22%まで（すべて回復）
  const prices = [100, 97, 94, 88, 101, 95, 94, 102, 99, 96, 90, 85, 79.56, 110];
  const rows = computeLevelProgression(prices, [-5, -10, -15, -20]);
  assert.deepEqual(rows.map((r) => [r.reached, r.progressed]), [[3, 2], [2, 1], [1, 1]]);
  assert.equal(rows[0].lowSample, true);
  const t = computeLevelTransitionDays(prices, -3, -5);
  assert.deepEqual(t.days, [1, 0, 0]); // 局面1は97→94で1日、局面2・3は-3%と-5%を同日に通過
});

test("SP500全履歴: 統計テーブルが全データから算出され、日次データ追加で自動更新される", () => {
  const { prices, dates } = loadSp500();
  assert.ok(prices.length > 17000);
  assert.equal(dates[0].getFullYear(), 1957);

  const stats = buildStatsTable(prices, dates);
  assert.ok(stats.episodes.length > 50);
  const nByBucket = stats.depthStats.reduce((s, b) => s + b.n, 0);
  assert.equal(nByBucket, stats.episodes.filter((e) => e.resolve_idx !== null).length);
  for (const b of stats.depthStats) if (b.n) assert.ok(b.cleanRecoveryRate! >= 0 && b.cleanRecoveryRate! <= 100);
  // 2008年の局面は-30%超バケットに入る
  const gfc = stats.episodes.find((e) => e.trough_date!.getFullYear() === 2009);
  assert.ok(gfc && depthBucketIndex(gfc.min_dd) === 6);
  // 進行確率は単調：深い節目ほど到達局面数は減る
  for (let i = 1; i < stats.levelProgression.length; i++) assert.ok(stats.levelProgression[i].reached <= stats.levelProgression[i - 1].reached);
  assert.equal(stats.reboundTable.length, 6);
  assert.ok(stats.transitionDays[0].n > 30 && stats.transitionDays[0].median !== null);

  // --- 日次データ追加による自動更新 ---
  // (a) 新ATH→-12%下落→新ATH回復 の合成日次データを追加すると、エピソードが1件増え各テーブルに反映される
  const lastP = Math.max(...prices);
  const path = [1.01, 1.02, 0.99, 0.96, 0.93, 0.9, 0.88, 0.9, 0.95, 1.0, 1.03].map((m) => lastP * m);
  const prices2 = [...prices, ...path];
  const lastDate = dates[dates.length - 1];
  const dates2 = [...dates, ...path.map((_, i) => new Date(lastDate.getTime() + (i + 1) * 86400000))];
  const stats2 = buildStatsTable(prices2, dates2);
  const resolved1 = stats.episodes.filter((e) => e.resolve_idx !== null).length;
  const resolved2 = stats2.episodes.filter((e) => e.resolve_idx !== null).length;
  const hadOpen = stats.episodes.some((e) => e.resolve_idx === null);
  assert.equal(resolved2, resolved1 + 1 + (hadOpen ? 1 : 0)); // 追加した局面＋（あれば）元データ末尾の未解消局面が新ATHで解消
  const b = depthBucketIndex(-12.7);
  assert.equal(stats2.depthStats[b].n, stats.depthStats[b].n + 1);
  assert.equal(stats2.levelProgression[0].reached >= stats.levelProgression[0].reached + 1, true);
  const newEp = stats2.episodes[stats2.episodes.length - 1];
  assert.equal(newEp.resolve_idx, prices2.length - 1);
  assert.equal(isCleanRecovery(newEp, prices2), true);

  // (b) 下落途中の日次データを追加すると、未解消エピソードとして検出され、現在状態・スコアが更新される
  const prices3 = [...prices, ...[1.01, 0.97, 0.94, 0.91, 0.94].map((m) => lastP * m)];
  const stats3 = buildStatsTable(prices3);
  assert.equal(stats3.episodes[stats3.episodes.length - 1].resolve_idx, null);
  const cur = deriveCurrentState(prices3)!;
  assert.ok(Math.abs(cur.current_dd - (0.91 / 1.01 - 1) * 100) < 1e-6);
  assert.equal(cur.days_at_current_level, 4);
  assert.ok(cur.bounce_from_low_pct > 3);
  const score = computeBottomScore(cur, stats3);
  assert.equal(score.applicable, true);
  if (score.applicable) {
    assert.ok(score.score >= 0 && score.score <= 100);
    assert.equal(score.components.length, 4);
    assert.ok(score.components.find((c) => c.key === "confirm")!.value > 0);
  }
  const sim = findSimilarEpisodes(cur, stats3, prices3);
  assert.equal(sim.length, 3);
  assert.ok(sim[0].distance <= sim[1].distance && sim[1].distance <= sim[2].distance);
});

test("computeBottomScore: DD-3%未満は対象外、反発3%未満は反発確認0点", () => {
  const { prices } = loadSp500();
  const stats = buildStatsTable(prices);
  assert.equal(computeBottomScore({ current_dd: -1, days_at_current_level: 3, fake_rally_count: 0, bounce_from_low_pct: 0 }, stats).applicable, false);
  const r = computeBottomScore({ current_dd: -12, days_at_current_level: 1000, fake_rally_count: 99, bounce_from_low_pct: 1 }, stats);
  assert.equal(r.applicable, true);
  if (r.applicable) {
    assert.equal(r.components.find((c) => c.key === "confirm")!.value, 0);
    assert.equal(r.components.find((c) => c.key === "duration")!.value, 100);
    assert.equal(r.components.find((c) => c.key === "fakeRally")!.value, 100);
  }
});

test("computeReboundProgression: アンカー割れ前の到達を判定し、未確定分は分母から除外", () => {
  // -5%到達価格=94.5付近→+3%到達→アンカー割れ
  const prices = [100, 94, 97, 99, 93, 101];
  const [row] = computeReboundProgression(prices, [-5], [3, 5, 10]);
  assert.equal(row.nAnchor, 1);
  assert.deepEqual(row.rungs.map((r) => [r.hits, r.n]), [[1, 1], [1, 1], [0, 1]]);
  // 割れずにデータ終端 → +10%は未確定で分母0
  const [row2] = computeReboundProgression([100, 94, 99], [-5], [3, 10]);
  assert.deepEqual(row2.rungs.map((r) => [r.hits, r.n]), [[1, 1], [0, 0]]);
  assert.equal(computeDepthStats(detectEpisodes(prices), prices)[1].n, 1);
});
