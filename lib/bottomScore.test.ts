// 実行: npm test  （Node 24 の型ストリップで .ts を直接実行する）
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  detectEpisodes, countFakeRalliesInRange, isCleanRecovery, computeDepthStats, computeLevelProgression,
  computeReboundProgression, computeLevelTransitionDays, buildStatsTable, deriveCurrentState, depthBucketIndex,
  collectHoldSamples, computeMddHoldProbability, collectRecoverySamples, computeRecoveryMatrix,
  collectCrashOccurrences, computeCrashFrequency, CRASH_RISK_THRESHOLDS,
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
  // 節目回復統計：fromLevel(-10〜-45、8段)×steps(1〜段位index)の全マス目＝1+2+...+8=36件。データ量に関わらず固定。
  assert.equal(stats.recoveryMatrix.length, 36);
  assert.ok(stats.recoveryMatrix.some((c) => c.occurrences > 0 && c.p !== null));
  // 暴落発生確率：閾値ごとに1行、浅い閾値ほど発生件数が多い（単調減少）
  assert.equal(stats.crashFrequency.length, CRASH_RISK_THRESHOLDS.length);
  for (let i = 1; i < stats.crashFrequency.length; i++) assert.ok(stats.crashFrequency[i].count <= stats.crashFrequency[i - 1].count);
  const cf10 = stats.crashFrequency.find((r) => r.threshold === -10)!;
  assert.ok(cf10.count > 5 && cf10.nextYearProbability! > 0 && cf10.nextYearProbability! < 100);
  assert.ok(cf10.lastOccurrence !== null && cf10.yearsSinceLast !== null && cf10.yearsSinceLast >= 0);

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

test("collectRecoverySamples / computeRecoveryMatrix: 節目回復の段階数とセルの確率を手計算と一致させる", () => {
  // ATH100→-21%(79)→-15%まで回復(85,1段階)→-24%へ再下落・底割れ(76)→-10%まで回復(90)→新ATH(101)
  const prices = [100, 79, 85, 76, 90, 101];
  const samples = collectRecoverySamples(prices);
  // trough=79(-21%): fromLevel=-20、85(-15%)まで1段階回復した後76へ底割れ → stepsReached=1, held=false
  // trough=76(-24%): fromLevel=-20、90→101で底割れせず新ATHまで到達 → -15/-10/-5の3段階回復, held=true
  assert.deepEqual(
    samples.map((s) => [s.fromLevel, s.stepsReached, s.held]),
    [[-20, 1, false], [-20, 3, true]],
  );

  const matrix = computeRecoveryMatrix(prices);
  const cellsAt20 = matrix.filter((c) => c.fromLevel === -20).sort((a, b) => a.steps - b.steps);
  assert.equal(cellsAt20.length, 3); // -20%は3段階（-15/-10/-5）まで定義される
  // 発生回数(occurrences)は常に2（-20%に到達した局所トラフの数）。確率pはoccurrences基準で一定、
  // reachedのみ段階が進むほど減る。
  assert.deepEqual(
    cellsAt20.map((c) => [c.toLevel, c.occurrences, c.reached, c.bottomHeld, c.p]),
    [[-15, 2, 2, 1, 50], [-10, 2, 1, 1, 50], [-5, 2, 1, 1, 50]],
  );
});

test("computeMddHoldProbability: 節目回復統計が底値確定確率の判定tierに追加される", () => {
  // 1局面目（解消済み・上のテストと同じ）に、同じ相対パターンのATH更新後の2局面目（未解消・現在進行中）を続ける。
  // 現在地は2局面目のtrough(-24%)から-10%まで回復した状態＝節目-20%から2段階回復中。
  const prices = [100, 79, 85, 76, 90, 101, 79.79, 85.85, 76.76, 90.9];
  const stats = buildStatsTable(prices);
  const state = deriveCurrentState(prices)!;
  assert.ok(Math.abs(state.mdd - (-24)) < 1e-9 && Math.abs(state.latest_dd - (-10)) < 1e-9);

  const h = computeMddHoldProbability(prices, stats, state);
  assert.equal(h.applicable, true);
  if (h.applicable) {
    assert.equal(h.tiers.length, 4); // 既存3tier + 節目tier
    const milestone = h.tiers[0]; // 節目tierが先頭（最優先）に追加される
    assert.match(milestone.label, /節目 -20%・2段階回復（-10%）/);
    assert.deepEqual([milestone.n, milestone.held, milestone.broke, milestone.pHold, milestone.pBreak, milestone.lowSample], [2, 1, 1, 50, 50, true]);
  }

  // まだ節目から1段も回復していない（直近ddが浅い回復基準に届かない）場合は節目tierを追加しない
  const pricesNoRecovery = [100, 79, 85, 76, 77];
  const h2 = computeMddHoldProbability(pricesNoRecovery, buildStatsTable(pricesNoRecovery));
  assert.equal(h2.applicable, true);
  if (h2.applicable) assert.equal(h2.tiers.length, 3);
});

test("collectCrashOccurrences / computeCrashFrequency: 発生件数・発生日・頻度統計を手計算と一致させる", () => {
  // 年末マーカー（前年騰落率の算出用）を含む合成データ：
  // エピソードE: 1998/6に-12%（節目-10%のみ到達、-15%には届かない）→1999/3に新ATHで解消
  // エピソードD: 2000/6に-25%まで直接下落（節目-10/-15/-20/-25到達）→2000/12に-20%まで一時回復（まだ解消せず）
  //              →2001/3に-40%まで再下落（節目-30/-35/-40到達、-45には届かない）→2001/8に新ATHで解消
  const dates = [
    "1996-12-31", "1997-12-31", "1998-06-01", "1999-03-01", "1999-12-31",
    "2000-06-01", "2000-12-31", "2001-03-01", "2001-08-01", "2001-12-31",
  ].map((s) => new Date(s));
  const prices = [100, 105, 92.4, 110, 120, 90, 96, 72, 125, 130];

  // 節目-10%：エピソードE（1998年・単独で-10%のみ到達）とエピソードD（2000年、他の節目と同時到達）の2件
  const occ10 = collectCrashOccurrences(prices, dates, -10);
  assert.deepEqual(occ10.map((o) => [o.year, o.date!.toISOString().slice(0, 10)]), [[1998, "1998-06-01"], [2000, "2000-06-01"]]);
  // 節目-15%〜-25%：エピソードDのみ（エピソードEの最終MDDは-12%なので到達しない）、到達日はすべて2000/6/1（下落開始日に一気に到達）
  for (const th of [-15, -20, -25]) {
    const occ = collectCrashOccurrences(prices, dates, th);
    assert.deepEqual(occ.map((o) => [o.year, o.date!.toISOString().slice(0, 10)]), [[2000, "2000-06-01"]]);
  }
  // 節目-30%〜-40%：エピソードDのみだが、到達日は2001/3/1（2000/12の一時回復をはさんで再下落した後）
  for (const th of [-30, -35, -40]) {
    const occ = collectCrashOccurrences(prices, dates, th);
    assert.deepEqual(occ.map((o) => [o.year, o.date!.toISOString().slice(0, 10)]), [[2001, "2001-03-01"]]);
  }
  // 節目-45%：どちらのエピソードも到達しない（0件）
  assert.equal(collectCrashOccurrences(prices, dates, -45).length, 0);

  const rows = computeCrashFrequency(prices, dates, [-10, -15, -30, -45]);
  const r10 = rows.find((r) => r.threshold === -10)!;
  assert.equal(r10.count, 2);
  // 前年騰落率：1998年発生分の前年(1997)=105/100-1=+5%、2000年発生分の前年(1999)=120/92.4-1
  const expectedPrior1999 = (120 / 92.4 - 1) * 100;
  assert.deepEqual(r10.priorYearReturns.map((p) => p.year), [1997, 1999]);
  assert.ok(Math.abs(r10.priorYearReturns[0].return - 5) < 1e-9);
  assert.ok(Math.abs(r10.priorYearReturns[1].return - expectedPrior1999) < 1e-9);
  assert.ok(Math.abs(r10.priorYearAvg! - (5 + expectedPrior1999) / 2) < 0.1); // priorYearAvgは小数1桁に丸められる
  assert.equal(r10.priorYearPositiveShare, 100); // 両方ともプラス

  const r15 = rows.find((r) => r.threshold === -15)!;
  assert.equal(r15.count, 1);
  assert.deepEqual(r15.priorYearReturns, [{ year: 1999, return: expectedPrior1999 }]);

  const r30 = rows.find((r) => r.threshold === -30)!;
  assert.equal(r30.count, 1);
  // 2001年発生分の前年(2000)=96/120-1=-20%ちょうど
  assert.deepEqual(r30.priorYearReturns.map((p) => [p.year, Math.round(p.return * 10) / 10]), [[2000, -20]]);
  assert.equal(r30.priorYearPositiveShare, 0); // マイナスだった

  // 発生ゼロの閾値：count=0・lastOccurrence=null・平均間隔null・前年傾向も空。ポアソン近似は発生率0→確率0%（nullではない）
  const r45 = rows.find((r) => r.threshold === -45)!;
  assert.deepEqual([r45.count, r45.lastOccurrence, r45.avgIntervalYears, r45.yearsSinceLast, r45.priorYearAvg, r45.priorYearPositiveShare], [0, null, null, null, null, null]);
  assert.equal(r45.nextYearProbability, 0);
  assert.equal(r45.lowSample, true);

  // 頻度統計の内部整合性：平均間隔×発生件数＝データ期間、今後1年以内確率＝1-e^(-件数/データ期間)（ポアソン過程近似）
  for (const r of rows) {
    if (r.count > 0) {
      assert.ok(Math.abs(r.avgIntervalYears! * r.count - r.coverageYears) < 0.05);
      assert.ok(Math.abs(r.nextYearProbability! - (1 - Math.exp(-r.count / r.coverageYears)) * 100) < 0.1);
    }
    assert.equal(r.lastOccurrence, r.occurrences.length ? r.occurrences[r.occurrences.length - 1] : null);
  }
});
