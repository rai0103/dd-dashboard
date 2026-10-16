// 実行: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifySpeed35, depthBucketIndex, deriveTacticalStates, decideTargetWeights,
  mergeVooQqqForTactical, simulateTacticalStrategy, describeTacticalProposal, DEPTH_BUCKETS,
  computeQqqEdgeProbabilities, baseQqqWeightFromProbability, PROB_WINDOW_DAYS, BASE_QQQ_CAP,
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

test("decideTargetWeights: 平常時はVOO100%、急落時は現金、緩慢時はQQQ押し目買い", () => {
  const normal = decideTargetWeights({ idx: 0, date: new Date(), currentDD: -1, daysSinceATH: 0, speedLevel: "normal", speedCategory: null, depthBucketIndex: -1 });
  assert.deepEqual(normal.weights, { qqq: 0, voo: 1, cash: 0 });

  const fast = decideTargetWeights({ idx: 0, date: new Date(), currentDD: -6, daysSinceATH: 10, speedLevel: "confirmed5", speedCategory: "fast", depthBucketIndex: 1 });
  assert.equal(fast.weights.qqq, 0);
  assert.ok(fast.weights.cash > 0);

  const slow = decideTargetWeights({ idx: 0, date: new Date(), currentDD: -6, daysSinceATH: 30, speedLevel: "confirmed5", speedCategory: "slow", depthBucketIndex: 1 });
  assert.equal(slow.weights.cash, 0);
  assert.ok(slow.weights.qqq > 0);

  // 深度が深いほど守り/攻めが強まる
  const fastDeep = decideTargetWeights({ idx: 0, date: new Date(), currentDD: -22, daysSinceATH: 60, speedLevel: "deep8", speedCategory: "fast", depthBucketIndex: 5 });
  assert.ok(fastDeep.weights.cash > fast.weights.cash);
});

test("decideTargetWeights: 配分の合計は常に1", () => {
  for (const bi of [-1, 0, 1, 2, 3, 4, 5, 6]) {
    for (const cat of ["fast", "slow", null] as const) {
      const w = decideTargetWeights({ idx: 0, date: new Date(), currentDD: bi === -1 ? -1 : DEPTH_BUCKETS[bi].upper, daysSinceATH: 10, speedLevel: bi === -1 ? "normal" : "confirmed5", speedCategory: cat, depthBucketIndex: bi }).weights;
      assert.ok(Math.abs(w.qqq + w.voo + w.cash - 1) < 1e-9);
    }
  }
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
function mkResult(state, voo = 95) {
  return { days: [{ idx: 0, date: state.date, voo, qqq: voo * 2, state, weights: { qqq: 0, voo: 1, cash: 0 }, reason: "test", equity: 10000, vooHoldEquity: 10000 }] };
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

test("describeTacticalProposal: 急落・警戒（fast）は現金積み増し(一時避難)アクション、上限到達後はcappedになる", () => {
  const notCapped = describeTacticalProposal(mkResult(mkState({ depthBucketIndex: 1, speedLevel: "confirmed5", speedCategory: "fast" }), 93));
  assert.ok(notCapped.actions.some((a) => a.kind === "cash_up"));

  const capped = describeTacticalProposal(mkResult(mkState({ depthBucketIndex: 5, speedLevel: "confirmed5", speedCategory: "fast" }), 80));
  assert.ok(capped.actions.some((a) => a.kind === "capped"));
  assert.ok(!capped.actions.some((a) => a.kind === "cash_up"));
});

test("describeTacticalProposal: 緩慢・安心寄り（slow）はQQQナンピン買いアクション、上限到達後はcappedになる", () => {
  const notCapped = describeTacticalProposal(mkResult(mkState({ depthBucketIndex: 1, speedLevel: "confirmed5", speedCategory: "slow" }), 93));
  assert.ok(notCapped.actions.some((a) => a.kind === "qqq_buy"));

  const capped = describeTacticalProposal(mkResult(mkState({ depthBucketIndex: 5, speedLevel: "confirmed5", speedCategory: "slow" }), 80));
  assert.ok(capped.actions.some((a) => a.kind === "capped"));
  assert.ok(!capped.actions.some((a) => a.kind === "qqq_buy"));
});

test("describeTacticalProposal: DD局面では必ずexit_voo100アクション（ATH復帰）が末尾に含まれる", () => {
  const proposal = describeTacticalProposal(mkResult(mkState({ depthBucketIndex: 1, speedLevel: "confirmed5", speedCategory: "fast" }), 93));
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
