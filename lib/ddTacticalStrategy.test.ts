// 実行: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  classifySpeed35, depthBucketIndex, deriveTacticalStates, decideTargetWeights,
  mergeVooQqqForTactical, simulateTacticalStrategy, describeTacticalProposal, DEPTH_BUCKETS,
  computeQqqEdgeProbabilities, baseQqqWeightFromProbability, PROB_WINDOW_DAYS, BASE_QQQ_CAP,
  buildPracticePeriods, rebasePracticePeriod, PRACTICE_START_DATE,
  buildProbabilitySnapshot, type ProbabilitySnapshot, RULE_VERSION,
  CASH_OVERLAY_CAP, DIP_OVERLAY_CAP, DIP_QQQ_TOTAL_CAP, SNAPSHOT_INTERVAL_DAYS,
} from "./ddTacticalStrategy.ts";

test("classifySpeed35: 5日以下は急落、21日以上は緩慢、それ以外は中間", () => {
  assert.equal(classifySpeed35(3), "fast");
  assert.equal(classifySpeed35(5), "fast");
  assert.equal(classifySpeed35(6), "mid");
  assert.equal(classifySpeed35(20), "mid");
  assert.equal(classifySpeed35(21), "slow");
});

test("depthBucketIndex: 底値判定と同じ深度バケット境界", () => {
  assert.equal(depthBucketIndex(-1), -1); // DD>-3%は対象外
  assert.equal(depthBucketIndex(-3), 0);
  assert.equal(depthBucketIndex(-5), 1);
  assert.equal(depthBucketIndex(-31), 6);
});

function mkDay(date: string, voo: number) { return { date: new Date(date), voo }; }

test("deriveTacticalStates: ATH更新でエピソードがリセットされ、経過日数・速度区分が追跡される", () => {
  // day0 ATH=100 → day1 97(-3%) → day2 95(-5%, 1日でDD5%到達=急落) → day3 91.5(-8.5%, deep8)
  const days = [mkDay("2020-01-01", 100), mkDay("2020-01-02", 97), mkDay("2020-01-03", 95), mkDay("2020-01-06", 91.5)];
  const states = deriveTacticalStates(days);
  assert.equal(states[0].depthBucketIndex, -1);
  assert.equal(states[1].speedLevel, "pending5");
  assert.equal(states[1].daysSinceATH, 1);
  assert.equal(states[2].speedLevel, "confirmed5");
  assert.equal(states[2].speedCategory, "fast"); // -3%→-5%が1日(idx1→idx2)なので急落
  assert.equal(states[3].speedLevel, "deep8");
  assert.equal(states[3].speedCategory, "fast");
  // 新ATHでリセットされることを確認
  const recovered = deriveTacticalStates([...days, mkDay("2020-01-07", 101)]);
  assert.equal(recovered[4].depthBucketIndex, -1);
  assert.equal(recovered[4].daysSinceATH, 0);
});

test("deriveTacticalStates: ゆっくり悪化するケースは緩慢(slow)に分類される", () => {
  // day0=ATH100, day1=97(-3%,idx3=1)。そこから25営業日かけてじわじわ95(-5%)まで下げる→idx5-idx3=25日>=21で緩慢。
  const days = [mkDay("2020-01-01", 100), mkDay("2020-01-02", 97)];
  for (let d = 1; d <= 25; d++) days.push(mkDay(`2020-02-${String(d).padStart(2, "0")}`, 97 - d * (2 / 25)));
  const states = deriveTacticalStates(days);
  const dd5 = states.find((s) => s.currentDD <= -5);
  assert.ok(dd5);
  assert.equal(dd5!.speedCategory, "slow");
});

test("decideTargetWeights: 平常時はVOO100%、急落時は現金、緩慢時はQQQ押し目買い（統計スナップショット無しは中立値扱い）", () => {
  const normal = decideTargetWeights({ idx: 0, date: new Date(), currentDD: -1, daysSinceATH: 0, speedLevel: "normal", speedCategory: null, depthBucketIndex: -1 });
  assert.deepEqual(normal.weights, { qqq: 0, voo: 1, cash: 0 });

  const fast = decideTargetWeights({ idx: 0, date: new Date(), currentDD: -6, daysSinceATH: 10, speedLevel: "confirmed5", speedCategory: "fast", depthBucketIndex: 1 });
  assert.equal(fast.weights.qqq, 0);
  assert.ok(fast.weights.cash > 0);

  const slow = decideTargetWeights({ idx: 0, date: new Date(), currentDD: -6, daysSinceATH: 30, speedLevel: "confirmed5", speedCategory: "slow", depthBucketIndex: 1 });
  assert.equal(slow.weights.cash, 0);
  assert.ok(slow.weights.qqq > 0);
});

test("decideTargetWeights: 配分の合計は常に1", () => {
  for (const bi of [-1, 0, 1, 2, 3, 4, 5, 6]) {
    for (const cat of ["fast", "slow", null] as const) {
      const w = decideTargetWeights({ idx: 0, date: new Date(), currentDD: bi === -1 ? -1 : DEPTH_BUCKETS[bi].upper, daysSinceATH: 10, speedLevel: bi === -1 ? "normal" : "confirmed5", speedCategory: cat, depthBucketIndex: bi }).weights;
      assert.ok(Math.abs(w.qqq + w.voo + w.cash - 1) < 1e-9);
    }
  }
});

// テスト用に深度バケットbiの行だけ値を持つProbabilitySnapshotを組み立てる（他のバケットは中立＝データ無し扱い）。
function mkSnapshotForBucket(bi: number, opts: { spP?: number; qqqP?: number; ampRatio?: number; ampN?: number } = {}): ProbabilitySnapshot {
  const emptyRow = { from: 0, to: 0, reached: 0, progressed: 0, p: null as number | null, lowSample: true };
  const spProgression = DEPTH_BUCKETS.map((_, i) => i === bi && opts.spP != null ? { ...emptyRow, reached: 100, progressed: opts.spP, p: opts.spP, lowSample: false } : emptyRow);
  const qqqProgression = DEPTH_BUCKETS.map((_, i) => i === bi && opts.qqqP != null ? { ...emptyRow, reached: 100, progressed: opts.qqqP, p: opts.qqqP, lowSample: false } : emptyRow);
  const crossAmp = DEPTH_BUCKETS.map((b, i) => i === bi && opts.ampRatio != null
    ? { key: b.key, label: b.label, n: opts.ampN ?? 20, medianRatio: opts.ampRatio, lowSample: false }
    : { key: b.key, label: b.label, n: 0, medianRatio: null, lowSample: true });
  return { asOfIdx: 0, spProgression, qqqProgression, crossAmp };
}

test("decideTargetWeights: 過去にさらに深い節目まで進んだ割合（breakRisk）が高いほど現金化を強め、低いほど押し目買いを強める", () => {
  const stateFast = { idx: 0, date: new Date(), currentDD: -6, daysSinceATH: 10, speedLevel: "confirmed5" as const, speedCategory: "fast" as const, depthBucketIndex: 1 };
  const highRisk = decideTargetWeights(stateFast, 0.5, mkSnapshotForBucket(1, { spP: 85 }), -1);
  const lowRisk = decideTargetWeights(stateFast, 0.5, mkSnapshotForBucket(1, { spP: 15 }), -1);
  assert.ok(highRisk.weights.cash > lowRisk.weights.cash);

  const stateSlow = { ...stateFast, speedCategory: "slow" as const };
  const highConfDip = decideTargetWeights(stateSlow, 0.5, mkSnapshotForBucket(1, { spP: 15 }), -1); // breakRisk低い＝確信度高い
  const lowConfDip = decideTargetWeights(stateSlow, 0.5, mkSnapshotForBucket(1, { spP: 85 }), -1);
  assert.ok(highConfDip.weights.qqq > lowConfDip.weights.qqq);
});

test("decideTargetWeights: SP500自身とQQQ自身の統計は平均され、どちらか一方しか無ければそちらだけが使われる", () => {
  const stateFast = { idx: 0, date: new Date(), currentDD: -6, daysSinceATH: 10, speedLevel: "confirmed5" as const, speedCategory: "fast" as const, depthBucketIndex: 1 };
  const spOnly = decideTargetWeights(stateFast, 0.5, mkSnapshotForBucket(1, { spP: 80 }), -1); // QQQ自身はDD-3%未満（qqqBucketIndex=-1）
  const spAndQqqAgree = decideTargetWeights(stateFast, 0.5, mkSnapshotForBucket(1, { spP: 80, qqqP: 80 }), 1);
  // 両者が同じ値で一致する場合、平均も同じ値になるのでcashは一致する
  assert.ok(Math.abs(spOnly.weights.cash - spAndQqqAgree.weights.cash) < 1e-6);
  const spHighQqqLow = decideTargetWeights(stateFast, 0.5, mkSnapshotForBucket(1, { spP: 80, qqqP: 20 }), 1);
  // QQQ自身は警戒度が低いので、平均を取った分、SP500単独より現金化が弱まる
  assert.ok(spHighQqqLow.weights.cash < spOnly.weights.cash);
});

test("decideTargetWeights: SP500→QQQ増幅率（相関関係）が高いほど押し目買いを弱め・現金化を強める（強める方向にのみ働く）", () => {
  const stateSlow = { idx: 0, date: new Date(), currentDD: -6, daysSinceATH: 30, speedLevel: "confirmed5" as const, speedCategory: "slow" as const, depthBucketIndex: 1 };
  const lowAmp = decideTargetWeights(stateSlow, 0.5, mkSnapshotForBucket(1, { spP: 50, ampRatio: 1.0 }), -1);
  const highAmp = decideTargetWeights(stateSlow, 0.5, mkSnapshotForBucket(1, { spP: 50, ampRatio: 1.8 }), -1);
  assert.ok(highAmp.weights.qqq < lowAmp.weights.qqq); // 増幅率が高い→押し目買いは弱める

  const stateFast = { ...stateSlow, speedCategory: "fast" as const };
  const lowAmpCash = decideTargetWeights(stateFast, 0.5, mkSnapshotForBucket(1, { spP: 50, ampRatio: 1.0 }), -1);
  const highAmpCash = decideTargetWeights(stateFast, 0.5, mkSnapshotForBucket(1, { spP: 50, ampRatio: 1.8 }), -1);
  assert.ok(highAmpCash.weights.cash > lowAmpCash.weights.cash); // 増幅率が高い→現金化は強める

  // サンプル不足（低いQQQ増幅率でも<1）では補正しない方向にのみ働く：ampRatio<1でも押し目買いを強めない
  const lowAmpUnder1 = decideTargetWeights(stateSlow, 0.5, mkSnapshotForBucket(1, { spP: 50, ampRatio: 0.6 }), -1);
  assert.ok(lowAmpUnder1.weights.qqq <= lowAmp.weights.qqq + 1e-9);
});

test("RULE_VERSION: v3（過去の実績統計に基づく全面刷新版）", () => {
  assert.equal(RULE_VERSION, "v3");
});

test("buildProbabilitySnapshot: SP500の下落エピソードから節目間進行確率・QQQ増幅率を算出し、QQQデータが無ければqqqProgressionは空", () => {
  // 100→80(-20%、バケット15-20%)→105で解消。途中-15%(idx4)を経由してから-20%(idx5)まで進む。
  const vooPrefix = [100, 97, 95, 90, 85, 80, 90, 105].map((price, i) => ({ date: new Date(2020, 0, i + 1), price }));
  const snapshot = buildProbabilitySnapshot(vooPrefix, []);
  assert.equal(snapshot.qqqProgression.length, 0);
  assert.ok(snapshot.spProgression.length > 0);
  // -15%→-20%の遷移行（PROGRESSION_LEVELSの並びで該当する行）は、今回のエピソードで到達・進行の両方が起きている
  const row1520 = snapshot.spProgression.find((r) => r.from === -15 && r.to === -20);
  assert.ok(row1520);
  assert.equal(row1520!.reached, 1);
  assert.equal(row1520!.progressed, 1);
  assert.ok(snapshot.crossAmp.every((a) => a.n === 0)); // QQQデータが無いので増幅率は算出不可
});

test("mergeVooQqqForTactical: 両方に値がある日付だけを残す", () => {
  const voo = [{ date: new Date("2020-01-01"), price: 100 }, { date: new Date("2020-01-02"), price: 101 }];
  const qqq = [{ date: new Date("2020-01-02"), price: 200 }];
  const merged = mergeVooQqqForTactical(voo, qqq);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].voo, 101);
  assert.equal(merged[0].qqq, 200);
});

test("simulateTacticalStrategy: 一本調子の上昇（DDなし）ではVOOガチホと完全一致する", () => {
  const days = Array.from({ length: 50 }, (_, i) => ({ date: new Date(2020, 0, i + 1), voo: 100 + i, qqq: 200 + i * 2 }));
  const result = simulateTacticalStrategy(days, 10000)!;
  assert.ok(result);
  assert.equal(result.outperformancePct, 0); // 一度もDD-3%に到達しないので常にVOO100%＝ガチホと同じ
  assert.equal(result.finalEquity, result.finalVooHoldEquity);
});

test("simulateTacticalStrategy: 急落からの素早い回復では、VOOを一部現金化した分だけ最大下落率が緩和される", () => {
  // 100→85(-15%、1日で急落=fast)→急回復して110まで戻す。QQQはVOOと無相関に動かし、現金クッションの効果だけを見る。
  const vooP = [100, 96, 93, 90, 87, 85, 90, 95, 100, 105, 110];
  const qqqP = [200, 202, 204, 206, 208, 210, 212, 214, 216, 218, 220];
  const days = vooP.map((p, i) => ({ date: new Date(2020, 0, i + 1), voo: p, qqq: qqqP[i] }));
  const result = simulateTacticalStrategy(days, 10000)!;
  assert.ok(result);
  // 戦略側は底値圏で一部現金化しているため、VOO100%保有より最大下落率(MDD)が小さい（＝マイナス幅が浅い）はず
  assert.ok(result.strategyMaxDD > result.vooMaxDD);
});

test("describeTacticalProposal: 次の指値（買い増し/現金積み増しの節目価格）と逆指値（ATH復帰）を返す", () => {
  const days = [100, 97, 95, 93].map((p, i) => ({ date: new Date(2020, 0, i + 1), voo: p, qqq: p * 2 }));
  const result = simulateTacticalStrategy(days, 10000)!;
  const proposal = describeTacticalProposal(result);
  assert.ok(proposal.nextBuyTrigger);
  assert.ok(proposal.exitTrigger);
  assert.equal(proposal.exitTrigger!.price, 100);
});

function mkState(overrides) {
  return { idx: 0, date: new Date(), currentDD: -1, daysSinceATH: 0, speedLevel: "normal", speedCategory: null, depthBucketIndex: -1, daysSinceDD3: null, ...overrides };
}
function mkResult(state, voo = 95, weights = { qqq: 0, voo: 1, cash: 0 }) {
  return { days: [{ idx: 0, date: state.date, voo, qqq: voo * 2, state, weights, reason: "test", equity: 10000, vooHoldEquity: 10000 }] };
}

test("describeTacticalProposal: 平常時はwatchアクションのみで、ポジション解消(exit)トリガーはない", () => {
  const proposal = describeTacticalProposal(mkResult(mkState({ depthBucketIndex: -1, speedLevel: "normal" }), 99));
  assert.equal(proposal.actions.length, 1);
  assert.equal(proposal.actions[0].kind, "watch");
  assert.equal(proposal.exitTrigger, null);
});

test("describeTacticalProposal: 速度未確定（pending5）は急落/緩慢の両分岐を同じ価格で提示する", () => {
  const proposal = describeTacticalProposal(mkResult(mkState({ depthBucketIndex: 0, speedLevel: "pending5", speedCategory: null, daysSinceDD3: 2 }), 97));
  const kinds = proposal.actions.map((a) => a.kind);
  assert.ok(kinds.includes("pending_fast"));
  assert.ok(kinds.includes("pending_slow"));
  const fastAction = proposal.actions.find((a) => a.kind === "pending_fast");
  const slowAction = proposal.actions.find((a) => a.kind === "pending_slow");
  assert.equal(fastAction.price, slowAction.price); // 同じ-5%到達価格で分岐するだけ
  assert.ok(fastAction.label.includes("あと3営業日")); // 5 - daysSinceDD3(2) = 3
});

test("describeTacticalProposal: 急落・警戒（fast）は現金積み増し(一時避難)アクション、現金が上限に達した日はcappedになる", () => {
  const notCapped = describeTacticalProposal(mkResult(mkState({ depthBucketIndex: 1, speedLevel: "confirmed5", speedCategory: "fast" }), 93, { qqq: 0, voo: 0.9, cash: 0.1 }));
  assert.ok(notCapped.actions.some((a) => a.kind === "cash_up"));

  const capped = describeTacticalProposal(mkResult(mkState({ depthBucketIndex: 5, speedLevel: "confirmed5", speedCategory: "fast" }), 80, { qqq: 0, voo: 1 - CASH_OVERLAY_CAP, cash: CASH_OVERLAY_CAP }));
  assert.ok(capped.actions.some((a) => a.kind === "capped"));
  assert.ok(!capped.actions.some((a) => a.kind === "cash_up"));
});

test("describeTacticalProposal: 緩慢・安心寄り（slow）はQQQナンピン買いアクション、QQQ比率が上限に達した日はcappedになる", () => {
  const notCapped = describeTacticalProposal(mkResult(mkState({ depthBucketIndex: 1, speedLevel: "confirmed5", speedCategory: "slow" }), 93, { qqq: 0.1, voo: 0.9, cash: 0 }));
  assert.ok(notCapped.actions.some((a) => a.kind === "qqq_buy"));

  const capped = describeTacticalProposal(mkResult(mkState({ depthBucketIndex: 5, speedLevel: "confirmed5", speedCategory: "slow" }), 80, { qqq: DIP_QQQ_TOTAL_CAP, voo: 1 - DIP_QQQ_TOTAL_CAP, cash: 0 }));
  assert.ok(capped.actions.some((a) => a.kind === "capped"));
  assert.ok(!capped.actions.some((a) => a.kind === "qqq_buy"));
});

test("describeTacticalProposal: DD局面では必ずexit_voo100アクション（ATH復帰）が末尾に含まれる", () => {
  const proposal = describeTacticalProposal(mkResult(mkState({ depthBucketIndex: 1, speedLevel: "confirmed5", speedCategory: "fast" }), 93, { qqq: 0, voo: 0.9, cash: 0.1 }));
  assert.equal(proposal.actions[proposal.actions.length - 1].kind, "exit_voo100");
});

test("computeQqqEdgeProbabilities: 完結した保有期間が無いうちはp=0.5、QQQが一貫して上回る系列ではp=1に収束する", () => {
  const n = PROB_WINDOW_DAYS + 8;
  const days = Array.from({ length: n }, (_, i) => ({ voo: 100 * Math.pow(1.0003, i), qqq: 100 * Math.pow(1.0006, i) }));
  const probs = computeQqqEdgeProbabilities(days);
  assert.equal(probs[0], 0.5);
  assert.equal(probs[PROB_WINDOW_DAYS - 1], 0.5); // まだ1期も完結していない
  assert.equal(probs[PROB_WINDOW_DAYS], 1); // ちょうど1期完結、QQQの勝ち
  assert.equal(probs[n - 1], 1); // 以降も一貫してQQQが勝つので1のまま
});

test("baseQqqWeightFromProbability: p<=50%は0、p=100%でBASE_QQQ_CAP、線形に比例する", () => {
  assert.equal(baseQqqWeightFromProbability(0.5), 0);
  assert.equal(baseQqqWeightFromProbability(0.3), 0);
  assert.equal(baseQqqWeightFromProbability(1), BASE_QQQ_CAP);
  assert.equal(baseQqqWeightFromProbability(0.75), Number((BASE_QQQ_CAP * 0.5).toFixed(4)));
});

test("decideTargetWeights: 平常時でも実績優位確率が高ければベースQQQを持つ（消極的すぎる平常時VOO100%を解消）", () => {
  const normalNoEdge = decideTargetWeights({ idx: 0, date: new Date(), currentDD: -1, daysSinceATH: 0, speedLevel: "normal", speedCategory: null, depthBucketIndex: -1 }, 0.5);
  assert.deepEqual(normalNoEdge.weights, { qqq: 0, voo: 1, cash: 0 });

  const normalWithEdge = decideTargetWeights({ idx: 0, date: new Date(), currentDD: -1, daysSinceATH: 0, speedLevel: "normal", speedCategory: null, depthBucketIndex: -1 }, 1);
  assert.equal(normalWithEdge.weights.qqq, BASE_QQQ_CAP);
  assert.ok(normalWithEdge.weights.qqq > 0);

  // 急落時はベースQQQがあっても一旦解消して現金化する（近い将来の下落リスクを優先）
  const fastWithEdge = decideTargetWeights({ idx: 0, date: new Date(), currentDD: -6, daysSinceATH: 10, speedLevel: "confirmed5", speedCategory: "fast", depthBucketIndex: 1 }, 1);
  assert.equal(fastWithEdge.weights.qqq, 0);
  assert.ok(fastWithEdge.weights.cash > 0);
});

test("decideTargetWeights: 配分の合計は、実績優位確率が高い場合も常に1", () => {
  for (const bi of [-1, 0, 1, 2, 3, 4, 5, 6]) {
    for (const cat of ["fast", "slow", null]) {
      for (const p of [0.5, 0.75, 1]) {
        const w = decideTargetWeights({ idx: 0, date: new Date(), currentDD: bi === -1 ? -1 : DEPTH_BUCKETS[bi].upper, daysSinceATH: 10, speedLevel: bi === -1 ? "normal" : "confirmed5", speedCategory: cat, depthBucketIndex: bi }, p).weights;
        assert.ok(Math.abs(w.qqq + w.voo + w.cash - 1) < 1e-9);
      }
    }
  }
});

test("simulateTacticalStrategy: DDが一度も起きない期間でも、QQQの実績優位が積み上がればベースQQQ比率を持つ", () => {
  const n = PROB_WINDOW_DAYS + 50;
  // 一本調子の上昇で、QQQがVOOよりわずかに速く伸び続ける（DD-3%は一度も発生しない）
  const days = Array.from({ length: n }, (_, i) => ({ date: new Date(2000, 0, i + 1), voo: 100 * Math.pow(1.0003, i), qqq: 100 * Math.pow(1.0006, i) }));
  const result = simulateTacticalStrategy(days, 10000);
  assert.ok(result);
  const lastDay = result.days[result.days.length - 1];
  assert.equal(lastDay.state.depthBucketIndex, -1); // 平常時のまま
  assert.ok(lastDay.weights.qqq > 0.2); // 実績優位確率が積み上がり、ベースQQQ(上限30%近く)を保有している
  assert.ok(result.outperformancePct > 0); // その結果、VOO100%保有より上振れする
});

test("simulateTacticalStrategy: 実データ（SP500全履歴の直近部分＋合成QQQ）で、統計スナップショットを挟んでも妥当な時間で完走し、配分が常に正常範囲に収まる", () => {
  const text = readFileSync(join(import.meta.dirname, "..", "sample-data", "S&P500.csv"), "utf8").replace(/^﻿/, "");
  const rows = text.trim().split(/\r?\n/).slice(1).map((l) => { const [d, p] = l.split(","); return { date: new Date(d.replace(/\//g, "-")), price: parseFloat(p) }; })
    .filter((r) => !isNaN(r.price) && !isNaN(r.date.getTime())).sort((a, b) => a.date.getTime() - b.date.getTime());
  const recent = rows.slice(-4000); // 直近約16年分（2020年コロナショック・2022年ベア相場を含む）
  // QQQは合成：SP500の約2倍の値動き＋独立したノイズを加えた系列（相関関係の算出が機能することを確認するため）。
  let qqqPrice = 100;
  const voo = recent.map((r, i) => ({ date: r.date, price: r.price }));
  const qqq = recent.map((r, i) => {
    if (i > 0) {
      const retSp = r.price / recent[i - 1].price - 1;
      qqqPrice *= 1 + retSp * 2 + (Math.sin(i * 0.37) * 0.001);
    }
    return { date: r.date, price: qqqPrice };
  });
  const merged = mergeVooQqqForTactical(voo, qqq);
  const started = Date.now();
  const result = simulateTacticalStrategy(merged, 10000);
  const elapsedMs = Date.now() - started;
  assert.ok(result);
  assert.ok(elapsedMs < 30000, `simulateTacticalStrategy took too long: ${elapsedMs}ms`);
  assert.equal(result.ruleVersion, RULE_VERSION);
  for (const d of result.days) {
    const { qqq: wq, voo: wv, cash: wc } = d.weights;
    assert.ok(Math.abs(wq + wv + wc - 1) < 1e-6);
    assert.ok(wc >= 0 && wc <= CASH_OVERLAY_CAP + 1e-6);
    assert.ok(wq >= 0 && wq <= DIP_QQQ_TOTAL_CAP + 1e-6);
    assert.ok(Number.isFinite(d.equity) && d.equity > 0);
  }
});

test("buildPracticePeriods: 開始年は実践開始日〜年末、以降は暦年(1/1〜12/31)で区切られる", () => {
  const periods = buildPracticePeriods(new Date(2028, 5, 1));
  assert.equal(periods.length, 3); // 2026, 2027, 2028
  assert.equal(periods[0].startDate.getTime(), PRACTICE_START_DATE.getTime());
  assert.equal(periods[0].endDate.getFullYear(), 2026);
  assert.equal(periods[0].endDate.getMonth(), 11);
  assert.equal(periods[0].endDate.getDate(), 31);
  assert.equal(periods[1].startDate.getTime(), new Date(2027, 0, 1).getTime());
  assert.equal(periods[1].endDate.getTime(), new Date(2027, 11, 31).getTime());
  assert.equal(periods[2].startDate.getTime(), new Date(2028, 0, 1).getTime());
});

test("buildPracticePeriods: 保有データが実践開始年より前でも、実践開始年の1期間だけを返す", () => {
  const periods = buildPracticePeriods(new Date(2020, 0, 1));
  assert.equal(periods.length, 1);
  assert.equal(periods[0].startDate.getTime(), PRACTICE_START_DATE.getTime());
});

test("rebasePracticePeriod: 期間開始日の評価額をどちらも100として指数化し、以後の差がoutperformancePctになる", () => {
  // QQQがVOOより速く伸び続ける系列。PRACTICE_START_DATEをまたぐように日付を作る。
  const base = new Date(2026, 9, 1); // 2026-10-01（実践開始日より前から始める）
  const n = 400;
  const days = Array.from({ length: n }, (_, i) => {
    const d = new Date(base);
    d.setDate(d.getDate() + i);
    return { date: d, voo: 100 * Math.pow(1.0004, i), qqq: 100 * Math.pow(1.001, i) };
  });
  const result = simulateTacticalStrategy(days, 10000);
  assert.ok(result);
  const periods = buildPracticePeriods(result.endDate);
  const period2026 = periods.find((p) => p.key === "2026");
  assert.ok(period2026);
  const rebased = rebasePracticePeriod(result, period2026);
  assert.ok(rebased);
  assert.equal(rebased.points[0].strategyIndex, 100);
  assert.equal(rebased.points[0].vooIndex, 100);
  assert.equal(rebased.points[0].date.getTime(), PRACTICE_START_DATE.getTime()); // 実践開始日が起点
  const last = rebased.points[rebased.points.length - 1];
  assert.ok(last.strategyIndex !== 100 || last.vooIndex !== 100); // 期間内に変化がある
  assert.equal(rebased.outperformancePct, Number((last.strategyIndex - last.vooIndex).toFixed(2)));
});

test("rebasePracticePeriod: 期間内にデータが無ければnull（まだ始まっていない将来の期間）", () => {
  const base = new Date(2026, 9, 16);
  const days = Array.from({ length: 10 }, (_, i) => {
    const d = new Date(base);
    d.setDate(d.getDate() + i);
    return { date: d, voo: 100 + i, qqq: 100 + i * 2 };
  });
  const result = simulateTacticalStrategy(days, 10000);
  assert.ok(result);
  const future = { key: "2099", label: "2099年", startDate: new Date(2099, 0, 1), endDate: new Date(2099, 11, 31) };
  assert.equal(rebasePracticePeriod(result, future), null);
});
