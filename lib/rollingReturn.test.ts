// 実行: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeRollingReturnsForVideo, DEFAULT_ROLLING_PERIODS } from "./rollingReturn.ts";

// 年またぎの日次シリーズを作る（1年=4営業日の簡略モデル。日付は年初から連番）。
function mkYears(pricesByYear: number[][]): { date: string; close: number }[] {
  const out: { date: string; close: number }[] = [];
  pricesByYear.forEach((prices, yi) => {
    const year = 2000 + yi;
    prices.forEach((close, di) => out.push({ date: `${year}-${String(Math.floor(di / 28) + 1).padStart(2, "0")}-${String((di % 28) + 1).padStart(2, "0")}`, close }));
  });
  return out;
}

test("年始点を基準に、保有期間（営業日）だけ進んだ時点のリターンを1標本とする", () => {
  // 2営業日/保有期間=1営業日のカスタム設定で、年2本（2000, 2001）、各年2営業日の単純データを使う
  const points = mkYears([[100, 110], [100, 90]]); // 2000年: 100→110（+10%）, 2001年: 100→90（-10%）
  const r = summarizeRollingReturnsForVideo(points, [{ label: "1日", tradingDays: 1 }])!;
  assert.equal(r.groups.length, 1);
  const g = r.groups[0];
  assert.equal(g.n, 2);
  assert.deepEqual(g.samples, [10, -10]);
  assert.equal(g.winRate, 0.5);
  assert.equal(g.mean, 0);
  assert.equal(g.median, 0);
});

test("保有期間がデータ全体の末尾を超える場合は標本化しない（年境界はまたいでよい＝連続した営業日シリーズとして扱う）", () => {
  const points = mkYears([[100, 105, 110], [100, 95, 90]]); // 全体で6営業日（idx0〜5）
  // 保有期間=2営業日：年境界をまたいでもデータ範囲内（idx0→2, idx3→5）なので両年とも取れる
  const r2 = summarizeRollingReturnsForVideo(points, [{ label: "2日", tradingDays: 2 }])!;
  assert.equal(r2.groups[0].n, 2);
  // 保有期間=10営業日：どちらの年始点から進んでもデータ全体（6営業日）を超えるため1つも標本化できない
  const r10 = summarizeRollingReturnsForVideo(points, [{ label: "10日", tradingDays: 10 }])!;
  assert.equal(r10.groups[0].n, 0);
  assert.equal(r10.groups[0].winRate, null);
  assert.equal(r10.groups[0].mean, null);
});

test("データ不足（空・1行）はnull", () => {
  assert.equal(summarizeRollingReturnsForVideo([]), null);
  assert.equal(summarizeRollingReturnsForVideo([{ date: "2020-01-01", close: 100 }]), null);
});

test("既定の保有期間（DEFAULT_ROLLING_PERIODS）は1ヶ月・3ヶ月・6ヶ月・1年の4区分", () => {
  assert.deepEqual(DEFAULT_ROLLING_PERIODS.map((p) => p.label), ["1ヶ月", "3ヶ月", "6ヶ月", "1年"]);
});
