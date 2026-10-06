// 実行: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { prepareSeries, extractEpisodes, computeAccelStats, currentAccelState, computeAccelSensor, wilsonInterval, DEFAULT_ACCEL_CONFIG } from "./accelSensor.ts";

// 終値の配列から日次シリーズを作る（日付は連番の営業日扱い）。
const mk = (closes: number[]) => closes.map((close, i) => ({ date: `2020-01-${String(i + 1).padStart(2, "0")}`, close }));

test("基本：−3%で開始、−5%到達日でacc、高値更新で終了。終了済みだけが標本", () => {
  // 100 → 97(−3%:i3) → 96 → 95(−5%:i5, acc=2) → 90(maxDD 10%) → 101(高値更新で終了)
  const s = prepareSeries(mk([100, 97, 96, 95, 90, 101]));
  const { episodes, current } = extractEpisodes(s);
  assert.equal(current, null);
  assert.equal(episodes.length, 1);
  const e = episodes[0];
  assert.deepEqual([e.startIdx, e.judgeIdx, e.acc, Math.round(e.maxDD * 100), e.endReason, e.peakDate], [1, 3, 2, 10, "newHigh", "2020-01-01"]);
});

test("ギャップダウンで−3%と−5%を同日に超えたら i5 = i3（acc = 0）", () => {
  const { episodes } = extractEpisodes(prepareSeries(mk([100, 99, 93, 92, 101])));
  assert.equal(episodes[0].acc, 0);
  assert.equal(episodes[0].startIdx, episodes[0].judgeIdx);
});

test("半値戻しで終了し、基準高値をその日の終値にリセットして次のエピソードを探す（高値を更新できない期間も分割される）", () => {
  // 100 → 80（maxDD 20%）→ 91（DD 9% ≤ 10% で半値戻し終了、peak=91）→ 88（91から3.3%：次のエピソード開始）→ 92（高値更新で終了）
  const { episodes, current } = extractEpisodes(prepareSeries(mk([100, 96, 80, 91, 88, 92])));
  assert.equal(current, null);
  assert.equal(episodes.length, 2);
  assert.equal(episodes[0].endReason, "halfRetrace");
  assert.equal(episodes[1].peak, 91);
  assert.equal(episodes[1].endReason, "newHigh");
});

test("終了していない最新のエピソードは標本に含めず、進行中として返す", () => {
  const ex = extractEpisodes(prepareSeries(mk([100, 95, 101, 97, 96])));
  assert.equal(ex.episodes.length, 1);
  assert.ok(ex.current);
  assert.equal(ex.current.startDate, "2020-01-04");
});

test("現在の状態：平常／−3%超過中（あと何%で判定・経過営業日）／−5%到達済み（判定バケット）", () => {
  const normal = computeAccelSensor(mk([100, 101, 99])).state;
  assert.equal(normal.status, "normal");
  assert.equal(Math.round((normal.currentDD ?? 0) * 1000) / 10, 2);
  const over3 = computeAccelSensor(mk([100, 96, 96.5])).state;
  assert.equal(over3.status, "over3");
  assert.equal(over3.elapsedDays, 1);
  assert.equal(Math.round((over3.remainingToJudge ?? 0) * 1000) / 10, 1.5); // DD3.5% → 5%まであと1.5%
  assert.equal(over3.bucket, null); // まだ高速・低速どちらの可能性もある
  const slowFixed = computeAccelSensor(mk([100, 96, 96, 96, 96, 96])).state; // −3%から4営業日経過・未到達 → 到達しても4日以上
  assert.equal(slowFixed.bucket?.label, "4日以上（低速）");
  assert.equal(slowFixed.bucketFixed, false);
  const reached = computeAccelSensor(mk([100, 96, 94])).state;
  assert.deepEqual([reached.status, reached.acc, reached.bucket?.label, reached.bucketFixed], ["reached5", 1, "0〜3日（高速）", true]);
});

test("統計：−5%到達エピソードだけが母集団、バケット別・しきい値別の割合と標本数", () => {
  const closes = [
    100, 96, 94, 89, 101, // ep1: acc1, maxDD≈11.9%（高速・10%以上）
    97.9, 97.5, 97.0, 96.5, 95.9, 102, // ep2: 101から−3%(97.9)開始、acc4(95.9)、maxDD≈5.0%（低速）
    98, 103, // ep3: −5%未到達（母集団外）
  ];
  const s = prepareSeries(mk(closes));
  const ex = extractEpisodes(s);
  const st = computeAccelStats(s, ex.episodes);
  assert.equal(st.episodeCount, 3);
  assert.equal(st.judgedCount, 2);
  assert.deepEqual(st.buckets.map((b) => b.n), [1, 1]);
  const fast10 = st.buckets[0].rates.find((r) => r.threshold === 0.1);
  assert.deepEqual([fast10?.hits, fast10?.p], [1, 1]);
  assert.equal(st.overall.rates.find((r) => r.threshold === 0.1)?.p, 0.5);
  assert.equal(st.overall.lowSample, true);
  assert.deepEqual([st.accMedian, st.accMax, st.periodStart, st.periodEnd], [2.5, 4, "2020-01-01", "2020-01-13"]);
});

test("入力の整形：日付の重複は後勝ち、欠損（null・空）は除外、日付順に並べる", () => {
  const s = prepareSeries([{ date: "2020-01-03", close: 3 }, { date: "2020-01-01", close: 1 }, { date: "2020-01-02", close: null }, { date: "2020-01-03", close: 30 }, { date: new Date("2020-01-04T00:00:00Z"), price: 4 }]);
  assert.deepEqual(s, [{ date: "2020-01-01", close: 1 }, { date: "2020-01-03", close: 30 }, { date: "2020-01-04", close: 4 }]);
});

test("データ不足：空・1行でも落ちない", () => {
  const empty = computeAccelSensor([]);
  assert.equal(empty.stats.judgedCount, 0);
  assert.equal(empty.state.status, "normal");
  assert.equal(empty.stats.overall.rates[0].p, null);
  assert.equal(computeAccelSensor(mk([100])).state.currentDD, 0);
});

test("Wilson信頼区間（95%）", () => {
  const [lo, hi] = wilsonInterval(26, 50) as [number, number];
  assert.equal(lo.toFixed(4), "0.3851");
  assert.equal(hi.toFixed(4), "0.6520");
  assert.deepEqual(wilsonInterval(0, 11)?.map((v) => v.toFixed(3)), ["0.000", "0.259"]);
  assert.equal(wilsonInterval(0, 0), null);
});

test("設定値（しきい値・バケット・半値戻し係数）を変えて計算できる", () => {
  const cfg = { ...DEFAULT_ACCEL_CONFIG, startDD: 0.02, judgeDD: 0.04, buckets: [{ label: "全部", min: 0, max: Infinity }] };
  const r = computeAccelSensor(mk([100, 98, 96, 101]), cfg);
  assert.equal(r.stats.judgedCount, 1);
  assert.equal(r.stats.buckets[0].label, "全部");
});
