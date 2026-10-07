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

test("年ごとの統計：ATH更新・DD-3%は全期間の史上最高値基準で、年をまたいで継続する下落局面は新規に数えない", () => {
  const pts = [
    { date: "2019-12-02", price: 100 },
    { date: "2019-12-31", price: 96 }, // 史上最高値100から-4%：2019年に1回
    { date: "2020-01-02", price: 95 }, // 前年から継続（2020年の新規ではない）
    { date: "2020-01-03", price: 98 }, // -2%：-3%より浅く回復
    { date: "2020-01-06", price: 96.5 }, // 再び-3.5%：2020年の新規1回
    { date: "2020-01-07", price: 100 }, // 史上最高値と同値（更新ではない）
    { date: "2020-01-08", price: 104 }, // 史上最高値を更新
    { date: "2021-01-04", price: 90 }, // 104から-13.5%：2021年に1回
    { date: "2021-06-01", price: 95 }, // 下落継続・更新なし
  ];
  const st = computeYearStats(pts, [2019, 2020, 2021]);
  const s19 = st.get(2019)!, s20 = st.get(2020)!, s21 = st.get(2021)!;
  assert.deepEqual([s19.athCount, s19.dd3Count], [0, 1]);
  assert.deepEqual([s20.athCount, s20.dd3Count], [1, 1]);
  assert.equal(Math.round(s20.returnPct * 10) / 10, 8.3); // 96 → 104
  assert.equal(Math.round(s20.mdd * 10) / 10, -5); // 史上最高値100から95
  assert.deepEqual([s21.athCount, s21.dd3Count], [0, 1]);
  assert.equal(s21.lastDate, "2021-06-01");
});
