// 実行: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { detectEpisodes } from "./bottomScore.ts";
import { computeDepthConditionalQqqAmplification } from "./qqqCrossStats.ts";

function mkDates(n: number, startYear = 2000): Date[] {
  return Array.from({ length: n }, (_, i) => new Date(startYear, 0, i + 1));
}

test("computeDepthConditionalQqqAmplification: QQQがSP500の2倍下がる局面では、該当バケットのmedianRatioが2近辺になる", () => {
  // SP500: 100→94(-6%、バケット5-8%)→102で解消
  const spPrices = [100, 98, 96, 94, 97, 102];
  const spDates = mkDates(spPrices.length);
  const spEpisodes = detectEpisodes(spPrices, spDates);
  assert.equal(spEpisodes.length, 1);
  assert.ok(spEpisodes[0].min_dd <= -5 && spEpisodes[0].min_dd > -8);
  // QQQ: 同じ期間で-12%程度（SP500の約2倍）下げる
  const qqqPrices = [200, 196, 190, 176, 190, 206];
  const qqqDates = spDates;
  const result = computeDepthConditionalQqqAmplification(spEpisodes, qqqDates, qqqPrices);
  const bucket = result.find((r) => r.key === "5-8");
  assert.ok(bucket);
  assert.equal(bucket!.n, 1);
  assert.ok(bucket!.medianRatio! > 1.5 && bucket!.medianRatio! < 2.5);
  // 他のバケットはサンプルなし
  assert.equal(result.find((r) => r.key === "3-5")!.n, 0);
});

test("computeDepthConditionalQqqAmplification: QQQデータが無い/期間が重ならない場合はn=0でlowSample", () => {
  const spPrices = [100, 94, 102];
  const spDates = mkDates(spPrices.length);
  const spEpisodes = detectEpisodes(spPrices, spDates);
  const result = computeDepthConditionalQqqAmplification(spEpisodes, [], []);
  assert.ok(result.every((r) => r.n === 0 && r.medianRatio === null && r.lowSample === true));

  // QQQの範囲がSP500エピソードの期間を完全に含まない（開始が遅い）
  const lateQqqDates = [mkDates(10, 2001)[0], mkDates(10, 2001)[1]];
  const result2 = computeDepthConditionalQqqAmplification(spEpisodes, lateQqqDates, [200, 202]);
  assert.ok(result2.every((r) => r.n === 0));
});

test("computeDepthConditionalQqqAmplification: 未解消（進行中）エピソードは深度未確定のため対象外", () => {
  const spPrices = [100, 95, 90]; // 末尾まで未回復
  const spDates = mkDates(spPrices.length);
  const spEpisodes = detectEpisodes(spPrices, spDates);
  assert.equal(spEpisodes[0].resolve_idx, null);
  const result = computeDepthConditionalQqqAmplification(spEpisodes, spDates, [200, 190, 180]);
  assert.ok(result.every((r) => r.n === 0));
});
