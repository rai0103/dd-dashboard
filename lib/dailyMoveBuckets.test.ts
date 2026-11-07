// 実行: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeDailyMoveBucketsForVideo, DEFAULT_MOVE_BUCKETS, DEFAULT_MOVE_HORIZONS } from "./dailyMoveBuckets.ts";

const mk = (closes: number[]) => closes.map((close, i) => ({ date: `2020-01-${String(i + 1).padStart(2, "0")}`, close }));

test("下落日を絶対値で1%刻みに分類し、指定ホライズン後のリターンを集計する（direction既定=down）", () => {
  // 日次リターン: 100→98(-2%,i1) →96.04(-2%,i2) →104(+8.3%,i3,上昇なので下落バケットには入らない) →100(-3.8%,i4)
  const points = mk([100, 98, 96.04, 104, 100]);
  const r = summarizeDailyMoveBucketsForVideo(points, { buckets: [{ label: "1〜3%", min: 1, max: 3 }], horizonsDays: [1] })!;
  assert.equal(r.direction, "down");
  const b = r.buckets[0];
  // -2%(i1), -2%(i2), -3.8%(i4は3%超なので対象外) → 該当は i1, i2 の2件
  assert.equal(b.n, 2);
  // i1の1営業日後: i2 (96.04/98-1 = -2%) → i2の1営業日後: i3 (104/96.04-1 = +8.3%)
  assert.equal(b.horizons[0].n, 2);
  assert.ok(b.horizons[0].mean !== null);
});

test("上昇日（direction='up'）も同じロジックで集計できる", () => {
  const points = mk([100, 102, 104.04, 96, 100]);
  const r = summarizeDailyMoveBucketsForVideo(points, { direction: "up", buckets: [{ label: "1〜3%", min: 1, max: 3 }], horizonsDays: [1] })!;
  assert.equal(r.direction, "up");
  assert.equal(r.buckets[0].n, 2); // +2%, +2% の2件（-7.8%は下落なので対象外）
});

test("標本が無いホライズンはn=0・平均等はnull", () => {
  const points = mk([100, 90]); // -10%の1件のみ、データが短くホライズン後が無い
  const r = summarizeDailyMoveBucketsForVideo(points, { buckets: [{ label: "9〜11%", min: 9, max: 11 }], horizonsDays: [1] })!;
  assert.equal(r.buckets[0].n, 1);
  assert.equal(r.buckets[0].horizons[0].n, 0);
  assert.equal(r.buckets[0].horizons[0].mean, null);
  assert.equal(r.buckets[0].horizons[0].winRate, null);
});

test("データ不足（空・1行のみ＝リターンが1件も計算できない）はnull", () => {
  assert.equal(summarizeDailyMoveBucketsForVideo([]), null);
  assert.equal(summarizeDailyMoveBucketsForVideo(mk([100])), null);
});

test("最後の区分（5%超）はmaxがnullで上限なし", () => {
  const last = DEFAULT_MOVE_BUCKETS[DEFAULT_MOVE_BUCKETS.length - 1];
  assert.equal(last.max, null);
  assert.deepEqual(DEFAULT_MOVE_HORIZONS, [1, 5, 20, 60]);
});
