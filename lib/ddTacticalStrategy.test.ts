// 実行: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifySpeed35, depthBucketIndex, deriveTacticalStates, decideTargetWeights,
  mergeVooQqqForTactical, simulateTacticalStrategy, describeTacticalProposal, DEPTH_BUCKETS,
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
