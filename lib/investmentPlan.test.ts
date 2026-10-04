// ⑥将来の計画・実績の読み取り。実行: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { parseInvestmentExcel } from "./investmentPerformance.ts";

// 投資収支xlsx（Sheet1）と同じ配置の合成ブック：88行目「計 画」（B〜BC＝2022〜2075年）、90行目「年齢」、
// 107行目「総資産（年末）」（計画）、114行目「総資産（時点/年末）」（実績。B〜F列＝2022〜2026年のみ入力）
function buildWorkbook(opts: { actualCols?: number; yearAsText?: boolean; labels?: Partial<Record<"year" | "age" | "plan" | "actual", string>> } = {}) {
  const years = Array.from({ length: 2075 - 2022 + 1 }, (_, i) => 2022 + i); // B..BC（54列）
  const rows: unknown[][] = Array.from({ length: 120 }, () => []);
  rows[0] = ["", "2026-08-31"]; // 既存セクション用の日付ヘッダー（この機能では使わない）
  rows[87] = [opts.labels?.year ?? "計 画", ...years.map((y) => (opts.yearAsText ? `${y}年` : y))];
  rows[89] = [opts.labels?.age ?? "年齢", ...years.map((y) => y - 1975)];
  rows[106] = [opts.labels?.plan ?? "総資産（年末）", ...years.map((_, i) => 30000000 + i * 2000000)];
  const actual = [31000000, 36500000, 52000000, 78000000, 101000000];
  rows[113] = [opts.labels?.actual ?? "総資産（時点/年末）", ...actual.slice(0, opts.actualCols ?? 5)];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Sheet1");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return buf;
}

test("計画（2022〜2075年）・実績（入力済みの列まで）・年齢を読み取る", async () => {
  const data = await parseInvestmentExcel(buildWorkbook(), "投資収支.xlsx");
  const ps = data.planSeries!;
  assert.equal(ps.length, 54);
  assert.deepEqual(ps[0], { year: 2022, age: 47, plan: 30000000, actual: 31000000 });
  assert.deepEqual(ps[ps.length - 1], { year: 2075, age: 100, plan: 30000000 + 53 * 2000000, actual: null });
  assert.deepEqual(ps.filter((p) => p.actual != null).map((p) => p.year), [2022, 2023, 2024, 2025, 2026]);
  assert.ok(!data.errors.some((e) => e.startsWith("⑥")), data.errors.join("\n"));
});

test("実績は最初の空欄で打ち切り、ラベルの空白・括弧の全角半角の違いは無視、年は「2030年」表記も可", async () => {
  const wb = buildWorkbook({ yearAsText: true, labels: { year: "計画", plan: "総資産(年末)", actual: "総資産 (時点/年末)" } });
  const ps = (await parseInvestmentExcel(wb, "x.xlsx")).planSeries!;
  assert.equal(ps[0].year, 2022);
  assert.equal(ps.filter((p) => p.actual != null).length, 5);
  assert.equal(ps[10].plan, 30000000 + 10 * 2000000);
});

test("ラベルが見つからなければ作成時点の行番号（88/90/107/114行目）を使い、その旨を記録する", async () => {
  const data = await parseInvestmentExcel(buildWorkbook({ labels: { plan: "計画総資産" } }), "x.xlsx");
  assert.equal(data.planSeries![0].plan, 30000000);
  assert.ok(data.errors.some((e) => e.includes("「総資産（年末）」の行が見つからなかったため、107行目")));
});

test("⑦初心者トライアル：「大和コネクト証券」セクション内の「私（元本）」「資産評価額」だけを読む", async () => {
  const rows: unknown[][] = Array.from({ length: 60 }, () => []);
  rows[0] = ["", "2025-12-31", "2026-01-31", "2026-02-28"];
  rows[10] = ["moomoo証券"]; // 別セクション（同名ラベルを持つ）
  rows[11] = ["私（元本）", 1, 2, 3];
  rows[12] = ["資産評価額", 9, 9, 9];
  rows[47] = ["大和コネクト証券"]; // セクション見出し（日付列にデータなし）
  rows[48] = ["私（元本）", null, 400000, 450000];
  rows[49] = ["資産評価額", null, 405000, 462000];
  rows[52] = ["Coin Check"];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Sheet1");
  const data = await parseInvestmentExcel(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer, "x.xlsx");
  assert.deepEqual(data.beginnerTrial, [
    { date: "2025-12-31", principal: null, value: null },
    { date: "2026-01-31", principal: 400000, value: 405000 },
    { date: "2026-02-28", principal: 450000, value: 462000 },
  ]);
  assert.ok(!data.errors.some((e) => e.startsWith("⑦")), data.errors.join("\n"));
});
