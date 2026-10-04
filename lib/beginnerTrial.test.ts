// ⑦初心者トライアル：Excelとスクショの優先順位・縦軸。実行: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveBeginnerTrial, trialAxis } from "./investmentPerformance.ts";

const excel = [
  { date: "2026-08-31", principal: 1_000_000, value: 1_100_000 },
  { date: "2026-09-30", principal: 1_050_000, value: 1_159_978 },
];
const EXCEL_AT = "2026-10-02T09:00:00.000Z"; // 月初にExcelを更新

test("月初のExcel更新の後に同じ月のスクショを登録：スクショを優先（当月の点を追加、元本＝評価額−評価損益）", () => {
  const r = resolveBeginnerTrial(excel, EXCEL_AT, { asOf: "2026-10-04", importedAt: "2026-10-04T12:00:00.000Z", value: 1_178_329, principal: 1_014_820 });
  assert.deepEqual(r.latest, { date: "2026-10-04", value: 1_178_329, principal: 1_014_820, source: "screenshot" });
  assert.deepEqual(r.points.map((p) => p.date), ["2026-08-31", "2026-09-30", "2026-10-04"]);
  assert.equal(r.principalCarriedFrom, null);
});

test("スクショに評価損益が無ければ元本はExcelの直近値を引き継ぐ。同じ月の列があれば置き換える", () => {
  const r = resolveBeginnerTrial(excel, EXCEL_AT, { asOf: "2026-09-30", importedAt: "2026-10-05T00:00:00.000Z", value: 1_170_000, principal: null });
  assert.deepEqual(r.latest, { date: "2026-09-30", value: 1_170_000, principal: 1_050_000, source: "screenshot" });
  assert.equal(r.points.length, 2);
  assert.equal(r.points[1].value, 1_170_000);
  assert.equal(r.principalCarriedFrom, "2026-09-30");
});

test("Excelの方が新しい時点（翌月の月末列が追加された）ならExcel。同じ内容のExcelを再アップロードしただけではスクショを上書きしない", () => {
  const shot = { asOf: "2026-10-04", importedAt: "2026-10-04T12:00:00.000Z", value: 1_178_329, principal: 1_014_820 };
  const newer = [...excel, { date: "2026-10-31", principal: 1_100_000, value: 1_220_000 }];
  assert.equal(resolveBeginnerTrial(newer, "2026-11-02T00:00:00.000Z", shot).latest!.source, "excel");
  assert.equal(resolveBeginnerTrial(excel, "2026-10-10T00:00:00.000Z", shot).latest!.source, "screenshot");
  // 同じ日付ならアップロード・登録日時が新しい方
  const sameDay = { ...shot, asOf: "2026-09-30" };
  assert.equal(resolveBeginnerTrial(excel, "2026-10-05T00:00:00.000Z", sameDay).latest!.source, "excel");
  assert.equal(resolveBeginnerTrial(excel, "2026-10-01T00:00:00.000Z", sameDay).latest!.source, "screenshot");
  assert.equal(resolveBeginnerTrial(excel, EXCEL_AT, null).latest!.source, "excel");
});

test("縦軸は実データに合わせて自動、目標は近づいたときだけ表示", () => {
  const a = trialAxis([450_000, 1_050_000, 1_178_329], 10_000_000);
  assert.equal(a.showGoal, false);
  assert.ok(a.domain[0] <= 450_000 && a.domain[1] >= 1_178_329 && a.domain[1] < 2_000_000, JSON.stringify(a));
  assert.ok(a.ticks.length >= 3 && a.ticks.length <= 8);
  const b = trialAxis([6_000_000, 8_500_000], 10_000_000);
  assert.equal(b.showGoal, true);
  assert.ok(b.domain[1] >= 10_000_000);
});
