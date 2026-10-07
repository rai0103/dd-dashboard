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

test("年ごとの統計：DD-3%は高値を更新するまで1局面（−3%の上下動では増えない）。通期＝史上最高値基準、年内＝年初来高値基準", () => {
  const pts = [
    { date: "2019-12-02", price: 100 }, // 史上最高値
    { date: "2019-12-31", price: 96 }, // 史上最高値から-4%：通期 2019年に1回
    { date: "2020-01-02", price: 95 }, // 前年から継続（通期は新規ではない）。年内は高値95から開始
    { date: "2020-01-03", price: 98 }, // 通期-2%（一時的に-3%より浅い）。年内は高値98へ更新
    { date: "2020-01-06", price: 94 }, // 通期-6%（同じ局面のまま＝数えない）。年内は98から-4.1%：年内1回
    { date: "2020-01-07", price: 97 }, // 年内-1%（高値98未更新＝同じ局面）
    { date: "2020-01-08", price: 94.5 }, // 年内-3.6%（同じ局面のまま）
    { date: "2020-01-09", price: 100 }, // 史上最高値と同値（更新ではない）。年内高値更新→年内の局面終了
    { date: "2020-01-10", price: 96.5 }, // 年内100から-3.5%：年内2回目。通期は100基準で-3.5%だが局面継続中（更新していない）
    { date: "2020-01-13", price: 104 }, // 史上最高値を更新 → 通期の局面終了
    { date: "2020-01-14", price: 100 }, // 104から-3.8%：通期 2020年に1回、年内3回目
    { date: "2021-01-04", price: 90 }, // 継続中（通期は新規ではない）。年内は90が高値の起点
    { date: "2021-06-01", price: 95 }, // 年内高値更新・下落なし
  ];
  const st = computeYearStats(pts, [2019, 2020, 2021]);
  const s19 = st.get(2019)!, s20 = st.get(2020)!, s21 = st.get(2021)!;
  assert.deepEqual([s19.athCount, s19.dd3Count], [0, 1]);
  assert.deepEqual([s20.athCount, s20.dd3Count, s20.dd3CountYtd], [1, 1, 3]);
  assert.equal(Math.round(s20.returnPct * 10) / 10, 4.2); // 96 → 100
  assert.equal(Math.round(s20.mdd * 10) / 10, -6); // 史上最高値100から94
  assert.deepEqual([s21.athCount, s21.dd3Count, s21.dd3CountYtd], [0, 0, 0]);
  assert.equal(s21.lastDate, "2021-06-01");
});
