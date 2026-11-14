// 実行: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNkxBundle, parseStooqDaily, mergeNkx, nkxStoredRows, nkxNextStart, isStaleSinceTokyo, NKX_START, NKX_BUNDLE_LAST } from "./nkxSeries.ts";

test("parseNkxBundle：バンドル済みの日経平均は1949/5/16から日付昇順・すべて正の値", () => {
  const s = parseNkxBundle();
  assert.equal(s[0].date.toISOString().slice(0, 10), NKX_START);
  assert.equal(s[s.length - 1].date.toISOString().slice(0, 10), NKX_BUNDLE_LAST);
  assert.ok(s.length > 19000);
  for (let i = 1; i < s.length; i++) assert.ok(s[i].date > s[i - 1].date && s[i].price > 0);
});

test("parseStooqDaily：StooqのCSVから1949/5/16以降の終値だけを取り出す", () => {
  const s = parseStooqDaily("Date,Open,High,Low,Close,Volume\n1949-05-01,1,1,1,176.21,\n1949-05-16,176.21,176.21,176.21,176.21,\n2026-11-16,1,2,0.5,61500.5,123\n");
  assert.deepEqual(s.map((p) => [p.date.toISOString().slice(0, 10), p.price]), [["1949-05-16", 176.21], ["2026-11-16", 61500.5]]);
  assert.deepEqual(parseStooqDaily("No data"), []);
});

test("mergeNkx・nkxStoredRows・nkxNextStart：追加分を後勝ちでつなぎ、保存はバンドル最終日より後だけ", () => {
  const b = parseStooqDaily("Date,Close\n2026-11-12,60819.36\n2026-11-13,61142.35\n");
  const st = parseStooqDaily("Date,Close\n2026-11-13,61200\n2026-11-16,61500\n");
  const m = mergeNkx(b, st);
  assert.deepEqual(m.map((p) => p.price), [60819.36, 61200, 61500]);
  assert.deepEqual(nkxStoredRows(m).map((r) => r.date), ["2026-11-16"]);
  assert.equal(nkxNextStart(m), "2026-11-17");
});

test("isStaleSinceTokyo：翌営業日の18:00（東京時間）を過ぎても終値が無ければ未更新", () => {
  // 金曜11/13の終値 → 月曜11/16 17:59 JST はまだ更新待ち、18:00 以降は未更新
  assert.equal(isStaleSinceTokyo("2026-11-13", new Date("2026-11-16T08:59:00Z")), false);
  assert.equal(isStaleSinceTokyo("2026-11-13", new Date("2026-11-16T09:00:00Z")), true);
});
