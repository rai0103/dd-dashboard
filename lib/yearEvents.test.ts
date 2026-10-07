// 実行: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { marketEventsFor, presidentFor } from "./yearEvents.ts";
import { computeYearStats } from "./yearCompare.ts";

test("市場イベント：発生年は補足付き、継続中・複数年のイベントは2年目以降に「（〇年目）」", () => {
  assert.deepEqual(marketEventsFor(2008, 2026), ["サブプライム・世界金融危機（2年目）", "リーマンショック（9月破綻・10月暴落）"]);
  assert.deepEqual(marketEventsFor(2022, 2026), ["ロシアのウクライナ侵攻（2月）", "米FRB急速利上げ"]);
  assert.deepEqual(marketEventsFor(2023, 2026), ["ロシアのウクライナ侵攻（2年目）", "SVB破綻（3月）"]);
  assert.deepEqual(marketEventsFor(2001, 2026), ["ITバブル崩壊（2年目）", "米同時多発テロ（9月）"]);
  assert.deepEqual(marketEventsFor(2017, 2026), []);
  // 継続中（end: null）のイベントは currentYear までで止まる
  assert.deepEqual(marketEventsFor(2027, 2026, [{ start: 2022, end: null, label: "X" }]), []);
});

test("大統領：通常の年は〇年目、1月の就任は「→に交代」、1月以外の交代は月を添える", () => {
  assert.equal(presidentFor(2016), "オバマ大統領（民主党）8年目");
  assert.equal(presidentFor(2021), "トランプ（共和党）→バイデン大統領（民主党）に交代");
  assert.equal(presidentFor(2025), "バイデン（民主党）→トランプ大統領（共和党・2期目）に交代");
  assert.equal(presidentFor(2026), "トランプ大統領（共和党・2期目）2年目");
  assert.equal(presidentFor(1963), "ケネディ（民主党）→ジョンソン大統領（民主党）に交代（11月）");
  assert.equal(presidentFor(1974), "ニクソン（共和党）→フォード大統領（共和党）に交代（8月）");
  assert.equal(presidentFor(1958), "アイゼンハワー大統領（共和党）6年目");
});

test("年ごとの統計：騰落率は前年最終値から、MDD・ATH更新は既存のdd（ATH基準）、DD-3%は年初来高値基準で連続は1回", () => {
  const pts = [
    { date: "2019-12-31", price: 100, dd: 0 },
    { date: "2020-01-02", price: 105, dd: 0 }, // ATH更新
    { date: "2020-01-03", price: 101, dd: -3.81 }, // 年初来高値105から-3.8% → 1回目
    { date: "2020-01-06", price: 100, dd: -4.76 }, // 連続中（数えない）
    { date: "2020-01-07", price: 104, dd: -0.95 }, // -3%より浅く戻る
    { date: "2020-01-08", price: 101.5, dd: -3.33 }, // 2回目
    { date: "2020-01-09", price: 110, dd: 0 }, // ATH更新
  ];
  const s = computeYearStats(pts, [2020]).get(2020)!;
  assert.equal(Math.round(s.returnPct * 10) / 10, 10);
  assert.equal(s.mdd, -4.76);
  assert.equal(s.athCount, 2);
  assert.equal(s.dd3Count, 2);
  assert.equal(s.lastDate, "2020-01-09");
});
