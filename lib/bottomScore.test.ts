// 実行: npm test  （Node 24 の型ストリップで .ts を直接実行する）
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  detectEpisodes, countFakeRalliesInRange, isCleanRecovery, computeDepthStats, computeLevelProgression,
  computeReboundProgression, computeLevelTransitionDays, buildStatsTable, deriveCurrentState, depthBucketIndex,
  collectHoldSamples, computeMddHoldProbability,
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

test("depthBucketIndex の境界", () => {
  assert.equal(depthBucketIndex(-2.9), -1);
  assert.equal(depthBucketIndex(-3), 0);
  assert.equal(depthBucketIndex(-4.99), 0);
  assert.equal(depthBucketIndex(-5), 1); // ちょうど-5%は「-5%到達」として-5〜-8%側
  assert.equal(depthBucketIndex(-5.01), 1);
  assert.equal(depthBucketIndex(-45), 6);
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

  // (a') 追加した局面（MDD-13.7%→戻し50%→ATH更新）が底値確定サンプルとして1件増える
  const cond = { mddUpper: -10, mddLower: -15, minRecovery: 0.5, minDaysSinceTrough: 0 };
  const s1 = collectHoldSamples(prices, cond), s2 = collectHoldSamples(prices2, cond);
  assert.equal(s2.length, s1.length + 1);
  assert.equal(s2[s2.length - 1].held, true);

  // (b) 下落途中の日次データを追加すると、未解消エピソードとして検出され、現在状態・底値確定確率が更新される
  const prices3 = [...prices, ...[1.01, 0.97, 0.94, 0.91, 0.94].map((m) => lastP * m)];
  const stats3 = buildStatsTable(prices3);
  assert.equal(stats3.episodes[stats3.episodes.length - 1].resolve_idx, null);
  const cur = deriveCurrentState(prices3)!;
  assert.ok(Math.abs(cur.mdd - (0.91 / 1.01 - 1) * 100) < 1e-6);
  assert.equal(cur.days_since_ath, 4);
  assert.equal(cur.days_since_trough, 1);
  assert.ok(Math.abs(cur.recovery_ratio - 0.3) < 1e-9);
  const h3 = computeMddHoldProbability(prices3, stats3);
  assert.equal(h3.applicable, true);
  if (h3.applicable) {
    assert.equal(h3.tiers.length, 3);
    assert.ok(h3.tier.n > 0 && h3.tier.pHold! + h3.tier.pBreak! === 100);
    assert.equal(h3.tier.held + h3.tier.broke, h3.tier.n);
    assert.equal(h3.breakDistribution.reduce((s, b) => s + b.count, 0), h3.tier.broke);
  }
  // さらに底値を割る日を追加すると、MDD（底値）が更新される
  const prices4 = [...prices3, lastP * 0.88];
  const h4 = computeMddHoldProbability(prices4, buildStatsTable(prices4));
  assert.ok(h4.applicable && Math.abs(h4.state.mdd - (0.88 / 1.01 - 1) * 100) < 1e-6 && h4.state.days_since_trough === 0);
  // ATHを更新すると判定対象外になる
  const prices5 = [...prices4, lastP * 1.05];
  assert.equal(computeMddHoldProbability(prices5, buildStatsTable(prices5)).applicable, false);
});

test("collectHoldSamples / computeMddHoldProbability: 底値確定と底割れの判定", () => {
  const cond = { mddUpper: -3, mddLower: -5, minRecovery: 0.5, minDaysSinceTrough: 0 };
  // 底値96(-4%)→99.5まで戻す→ATH更新：底値確定
  const held = collectHoldSamples([100, 96, 99.5, 101], cond);
  assert.deepEqual(held.map((s) => [s.trough_idx, s.sample_idx, s.held, s.days_to_ath]), [[1, 2, true, 1]]);
  // 底値96→99.5→95で底割れ（新しい底値95は-5%でレンジ外）
  const broke = collectHoldSamples([100, 96, 99.5, 95, 101], cond);
  assert.deepEqual(broke.map((s) => [s.trough_idx, s.held, s.days_to_break, s.final_mdd]), [[1, false, 1, -5]]);
  // 戻し率・経過日数の条件を満たさなければサンプルにならない
  assert.equal(collectHoldSamples([100, 96, 97, 101], cond).length, 0);
  assert.equal(collectHoldSamples([100, 96, 99.5, 101], { ...cond, minDaysSinceTrough: 2 }).length, 0);
  // DD-3%未満の局面は判定対象外
  const shallow = [100, 98, 99];
  assert.equal(computeMddHoldProbability(shallow, buildStatsTable(shallow)).applicable, false);
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
