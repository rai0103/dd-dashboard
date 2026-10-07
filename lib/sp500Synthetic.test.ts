// 実行: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildVooEquivalentSeries, scanAnomalies } from "./sp500Synthetic.ts";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const pts = (rows: [string, number][]) => rows.map(([date, price]) => ({ date: d(date), price }));

test("最新の重複日で接続し、それより前はSP500×補正係数、以降はVOOの実値。接続点で段差が無い", () => {
  const sp = pts([["2020-01-02", 3000], ["2020-01-03", 3030], ["2020-01-06", 3060], ["2020-01-07", 3000]]);
  const voo = pts([["2020-01-03", 280], ["2020-01-06", 300], ["2020-01-07", 294], ["2020-01-08", 297]]);
  const r = buildVooEquivalentSeries(sp, voo);
  assert.equal(r.mode, "spliced");
  assert.equal(r.junctionDate, "2020-01-07"); // 両方ある最も新しい日
  assert.equal(r.factor, 294 / 3000);
  assert.deepEqual(r.series.map((p) => Math.round(p.price * 100) / 100), [294, 296.94, 299.88, 294, 297]);
  // 接続点より前の騰落率はSP500と同じ
  assert.equal((r.series[1].price / r.series[0].price).toFixed(6), (3030 / 3000).toFixed(6));
  assert.deepEqual([r.sp500Count, r.vooCount], [3, 2]);
});

test("VOOが無ければSP500のまま、重複が無ければVOOのみ", () => {
  const sp = pts([["2020-01-02", 3000]]);
  assert.equal(buildVooEquivalentSeries(sp, []).mode, "sp500-only");
  assert.equal(buildVooEquivalentSeries(sp, pts([["2021-01-04", 300]])).mode, "voo-only");
});

test("異常値チェック：正でない価格と大きな日次変化", () => {
  const r = scanAnomalies(pts([["2020-01-02", 100], ["2020-01-03", 80], ["2020-01-06", 81], ["2020-01-07", 0]]), 0.12);
  assert.equal(r.nonPositive, 1);
  assert.deepEqual(r.bigMoves.map((m) => m.date), ["2020-01-03", "2020-01-07"]);
});
