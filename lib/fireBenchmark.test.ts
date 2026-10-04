// ⑤FIREトライアルのSP500比較（各月の起点＝総資産（前月末/月初）−取り崩し）。実行: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { simulateMonthlyRebasedBenchmark } from "./investmentPerformance.ts";

const d = (s: string) => { const [y, m, day] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, day)); };
// SP500：12/31=100、1/30(金)=110、2/27(金)=99、3/31=99
const FULL = [{ date: d("2025-12-31"), price: 100 }, { date: d("2026-01-30"), price: 110 }, { date: d("2026-02-27"), price: 99 }, { date: d("2026-03-31"), price: 99 }];

test("起点＝前月末総資産−|取り崩し|（ボーナス月も同じ計算）、月末評価を翌月の列に置く、最新月は出さない", () => {
  const monthly = [
    { date: "2026-01-31", prevMonthTotal: 50_000_000, withdrawal: -400_000 },
    { date: "2026-02-28", prevMonthTotal: 52_000_000, withdrawal: -400_000 },
    { date: "2026-03-31", prevMonthTotal: 51_000_000, withdrawal: -1_200_000 }, // ボーナス込みの取り崩し
  ];
  const r = simulateMonthlyRebasedBenchmark(FULL, monthly);
  assert.deepEqual(r, [
    { date: "2026-02-28", month: "2026-01-31", base: 49_600_000, simulatedValue: 54_560_000 }, // 1月：+10%（1/31は土曜→1/30の価格）
    { date: "2026-03-31", month: "2026-02-28", base: 51_600_000, simulatedValue: 46_440_000 }, // 2月：−10%
  ]);
  // 取り崩しが正の数で入力されていても控除する
  assert.equal(simulateMonthlyRebasedBenchmark(FULL, [{ ...monthly[0], withdrawal: 400_000 }, monthly[1]])[0].base, 49_600_000);
});

test("④前月比・前年末比：Excelの列が無ければ口座別の時系列から算出（値の無い列は飛ばす）", async () => {
  const { accountChanges } = await import("./investmentPerformance.ts");
  const accountSeries = [
    { date: "2025-11-30", accounts: { A: 90, B: null } },
    { date: "2025-12-31", accounts: { A: 100, B: 50 } },
    { date: "2026-08-31", accounts: { A: 120, B: null } },
    { date: "2026-09-30", accounts: { A: 115, B: 70 } },
  ];
  const data = { accountSeries, accountRecentChange: { A: { monthChange: null, yearEndChange: null } } };
  assert.deepEqual(accountChanges(data, "A"), { monthChange: -5, yearEndChange: 15 });
  assert.deepEqual(accountChanges(data, "B"), { monthChange: 20, yearEndChange: 20 }); // 8月は値なし→12月と比較
  // 今年から集計した口座（前年末残高0）：前年末比＝現在の評価額
  const newAcc = { accountSeries: [...accountSeries.slice(0, 2).map((p) => ({ ...p, accounts: { C: null } })), { date: "2026-08-31", accounts: { C: 30 } }, { date: "2026-09-30", accounts: { C: 40 } }], accountRecentChange: {} };
  assert.deepEqual(accountChanges(newAcc, "C"), { monthChange: 10, yearEndChange: 40 });
  assert.deepEqual(accountChanges({ ...data, accountRecentChange: { A: { monthChange: 7, yearEndChange: null } } }, "A"), { monthChange: 7, yearEndChange: 15 });
});
