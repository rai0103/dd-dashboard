// 実行: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { nyseHolidays, nextTradingDay, isStaleSince, easternStamp } from "./marketClock.ts";

test("NYSEの休場日（振替・聖金曜日を含む）", () => {
  assert.deepEqual([...nyseHolidays(2026)].sort(), ["2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25"]);
  assert.deepEqual([...nyseHolidays(2027)].sort(), ["2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24"]);
  assert.equal(nyseHolidays(2022).has("2022-01-01"), false); // 元日が土曜：前年12/31は振替しない
  assert.equal(nyseHolidays(2021).has("2021-12-31"), false);
  assert.equal(nyseHolidays(2021).has("2021-06-18"), false); // ジューンティーンスは2022年から
});

test("翌取引日：週末・祝日を飛ばす", () => {
  assert.equal(nextTradingDay("2026-10-06"), "2026-10-07");
  assert.equal(nextTradingDay("2026-10-09"), "2026-10-12"); // 金→月（コロンブスデーは取引日）
  assert.equal(nextTradingDay("2026-11-25"), "2026-11-27"); // 感謝祭を飛ばす
  assert.equal(nextTradingDay("2026-04-02"), "2026-04-06"); // 聖金曜日＋週末
});

test("未更新の判定：翌取引日の9:30 ET（夏時間・冬時間）を過ぎたら", () => {
  assert.equal(easternStamp(new Date("2026-10-07T13:29:00Z")), "2026-10-07 09:29");
  assert.equal(isStaleSince("2026-10-06", new Date("2026-10-07T13:29:00Z")), false);
  assert.equal(isStaleSince("2026-10-06", new Date("2026-10-07T13:30:00Z")), true);
  assert.equal(isStaleSince("2026-10-09", new Date("2026-10-11T20:00:00Z")), false); // 日曜はまだ最新扱い
  assert.equal(isStaleSince("2026-11-25", new Date("2026-11-27T14:29:00Z")), false); // 冬時間 9:29 EST
  assert.equal(isStaleSince("2026-11-25", new Date("2026-11-27T14:30:00Z")), true);
});
