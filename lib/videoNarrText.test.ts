import { test } from "node:test";
import assert from "node:assert/strict";
import { segmentReading, displayOf, readingOf, applyMixedEdit, parseKanaInt } from "./videoNarrText.ts";

test("かなの整数を読む", () => {
  assert.deepEqual(parseKanaInt("じゅうさん", 0), [13, 5]);
  assert.deepEqual(parseKanaInt("にせんにじゅうろく", 0), [2026, 9]);
});

test("読みを通常の文章にし、読みへ戻せる", () => {
  const rd = "ことしの、えすあんどぴーごひゃくは、ぷらすじゅうに、てん、さんぱーせんとです。";
  const sg = segmentReading(rd);
  assert.equal(displayOf(sg), "今年の、S&P500は、+12.3%です。");
  assert.equal(readingOf(sg), rd);
});

test("用語をひらがなに直すと学習対象になり、読みが変わる", () => {
  const rd = "えすあんどぴーごひゃくの、ぶんせきです。";
  const sg = segmentReading(rd);
  const r = applyMixedEdit(sg, "えすあんどぴー500の、分析です。".replace("500", "ごひゃく").replace("えすあんどぴーごひゃく", "えすあんどぴーごひゃくだよ"));
  assert.equal(r.learn.length, 1);
  assert.equal(r.learn[0].surface, "S&P500");
  const sg2 = segmentReading(rd, [], { [r.learn[0].key]: { surface: "S&P500", to: r.learn[0].to } });
  assert.equal(readingOf(sg2).startsWith(r.learn[0].to), true);
});
