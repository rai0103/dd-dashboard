// 実行: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { backtestRsiTrigger, rsiTriggerStatus, xirr, calDays } from "./rsiTrigger.ts";

const D = (s: string) => new Date(`${s}T00:00:00Z`);
const pts = (rows: [string, number, number | null][]) => rows.map(([d, price, rsi]) => ({ date: D(d), price, rsi }));
const P = { buy: 30, sell: 70, exitDays: 130, base: 1_000_000, mmfRate: 0 };

test("backtest：RSI≦30で買い、RSI≧70で売る（RSI利確）", () => {
  const { trades, summary } = backtestRsiTrigger(pts([
    ["2024-01-01", 100, 50], ["2024-01-02", 90, 25], ["2024-01-10", 95, 50], ["2024-02-01", 120, 75], ["2024-02-02", 121, 50],
  ]), P);
  assert.equal(trades.length, 1);
  assert.equal(trades[0].reason, "RSI利確");
  assert.equal(trades[0].days, 30);
  assert.equal(Math.round(trades[0].value), Math.round(1_000_000 * 120 / 90));
  assert.equal(summary.closed, 1);
  assert.equal(summary.winRate, 100);
});

test("backtest：撤退実日数（暦日）に達した日の終値で期限撤退し、翌日以降の再エントリーも数える", () => {
  const { trades } = backtestRsiTrigger(pts([
    ["2024-01-01", 100, 20], ["2024-03-01", 95, 50], ["2024-05-09", 90, 50], ["2024-05-10", 88, 25], ["2024-05-11", 85, 25], ["2024-06-01", 99, 72],
  ]), { ...P, exitDays: 130 });
  // 1/1買い → 5/9は129日で未達 → 5/10は130日で期限撤退（この日はRSI25だが売った日には買わない）→ 5/11に再び買い → 6/1にRSI利確
  assert.equal(trades.length, 2);
  assert.equal(trades[0].reason, "期限撤退");
  assert.equal(trades[0].days, 130);
  assert.ok(Math.abs(trades[0].ret - (-12)) < 1e-9);
  assert.equal(Math.round(trades[0].minValue), 880000);
  assert.equal(trades[1].reason, "RSI利確");
  assert.equal(trades[1].buyPrice, 85);
});

test("backtest：最後まで売りサインが出なければ保有中として残す", () => {
  const { trades, summary } = backtestRsiTrigger(pts([["2024-01-01", 100, 50], ["2024-01-02", 80, 28], ["2024-01-05", 90, 50]]), P);
  assert.equal(trades.length, 1);
  assert.equal(trades[0].reason, "保有中");
  assert.equal(summary.closed, 0);
  assert.equal(summary.open?.days, 3);
});

test("backtest：待機中はMMFの利回りで増える（全期間待機なら通算年率＝MMFの利率）", () => {
  const { summary } = backtestRsiTrigger(pts([["2020-01-01", 100, 50], ["2021-01-01", 100, 50], ["2022-01-01", 100, 50]]), { ...P, mmfRate: 0.035 });
  assert.ok(Math.abs((summary.cagrWithMmf ?? 0) - 3.5) < 0.01);
});

test("xirr：1年で10%増なら年率10%", () => {
  const r = xirr([{ date: D("2023-01-01"), amount: -100 }, { date: D("2024-01-01"), amount: 110 }])!;
  assert.ok(Math.abs(r - 0.1) < 0.001);
});

test("status：保有中の残り実日数・期限日、利確・期限撤退・買いサイン・待機中", () => {
  const pos = { date: D("2026-10-01"), price: 100 };
  const h = rsiTriggerStatus({ price: 110, rsi: 50 }, P, pos, D("2026-11-12"));
  assert.equal(h.kind, "hold");
  assert.equal(h.elapsed, calDays(D("2026-10-01"), D("2026-11-12")));
  assert.equal(h.remaining, 130 - 42);
  assert.equal(h.deadline?.toISOString().slice(0, 10), "2027-02-08");
  assert.equal(Math.round(h.pnlYen!), 100000);
  assert.equal(rsiTriggerStatus({ price: 110, rsi: 71 }, P, pos, D("2026-11-12")).kind, "take");
  assert.equal(rsiTriggerStatus({ price: 110, rsi: 50 }, P, pos, D("2027-02-08")).kind, "timeout");
  assert.equal(rsiTriggerStatus({ price: 110, rsi: 29 }, P, null, D("2026-11-12")).kind, "buy");
  const w = rsiTriggerStatus({ price: 110, rsi: 49.8 }, P, null, D("2026-11-12"));
  assert.equal(w.kind, "wait");
  assert.ok(Math.abs((w.toBuy ?? 0) - 19.8) < 1e-9);
});
