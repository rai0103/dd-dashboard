import { test } from "node:test";
import assert from "node:assert/strict";
import { segmentReading, displayOf, readingOf, applyMixedEdit, parseKanaInt, alignedCopyRuns, buildNarrTemplate, applyNarrTemplate, isVariableSeg } from "./videoNarrText.ts";

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


test("alignedCopyRuns：一致範囲を正しく求める", () => {
  const runs = alignedCopyRuns("げんざい、ぷらすじゅうぱーせんとです。", "げんざい、ぷらすごぱーせんとです。");
  // 先頭「げんざい、ぷらす」と末尾「ぱーせんとです。」は一致範囲のはず
  const headRun = runs.find((r) => r.aAt === 0);
  assert.ok(headRun);
  assert.equal("げんざい、ぷらすじゅうぱーせんとです。".slice(headRun.aAt, headRun.aAt + headRun.len), "げんざい、ぷらす");
  const tailRun = runs[runs.length - 1];
  assert.equal("げんざい、ぷらすじゅうぱーせんとです。".slice(tailRun.aAt, tailRun.aAt + tailRun.len), "ぱーせんとです。");
});

test("buildNarrTemplate→applyNarrTemplate：言い回しを記憶し、変動要素（％・方向語）だけ差し替える", () => {
  const defaultReading = "げんざいのどろーだうんは、まいなすじゅっぱーせんとで、げらくです。";
  const editedReading = "どろーだうんは、げんざい、まいなすじゅっぱーせんとまで、げらく、しています。";
  const tpl = buildNarrTemplate(defaultReading, editedReading);
  assert.ok(tpl);
  // 新しい日のデータ（％・方向語が変わった）に適用
  const freshDefault = "げんざいのどろーだうんは、まいなすにじゅっぱーせんとで、ぼうらくです。";
  const applied = applyNarrTemplate(tpl, freshDefault);
  assert.equal(applied, "どろーだうんは、げんざい、まいなすにじゅっぱーせんとまで、ぼうらく、しています。");
});

test("buildNarrTemplate：変更が無ければnull", () => {
  const rd = "げんざいのどろーだうんは、まいなすじゅっぱーせんとです。";
  assert.equal(buildNarrTemplate(rd, rd), null);
});

test("buildNarrTemplate：数値そのものを書き換えた場合はその変数は無視される（固定文字列として記憶）", () => {
  // 「じゅっぱーせんと」を言い回しも数値もまとめて書き換えた場合、対応が取れず変数化されない
  const defaultReading = "げんざいは、まいなすじゅっぱーせんとです。";
  const editedReading = "げんざいは、だいたいまいなすじゅっぱーせんとくらいです。";
  const tpl = buildNarrTemplate(defaultReading, editedReading);
  // 「まいなすじゅっぱーせんと」部分は一致範囲に含まれるはずなので、変数スロットとして認識される
  assert.ok(tpl);
  const varCount = tpl!.chunks.filter((c) => c.kind === "var").length;
  assert.ok(varCount >= 1);
});

test("applyNarrTemplate：変動要素の個数が変わった場合はnull（安全側でフォールバック）", () => {
  const defaultReading = "げんざいのどろーだうんは、まいなすじゅっぱーせんとで、げらくです。";
  const editedReading = "どろーだうんは、げんざい、まいなすじゅっぱーせんとまで、げらく、しています。";
  const tpl = buildNarrTemplate(defaultReading, editedReading);
  assert.ok(tpl);
  // 変動要素が1つ減った文（方向語が無い）に適用すると個数が合わずnull
  const freshDefault = "げんざいのどろーだうんは、まいなすにじゅっぱーせんとです。";
  assert.equal(applyNarrTemplate(tpl!, freshDefault), null);
});

test("isVariableSeg：numと方向語termだけがtrue", () => {
  const segs = segmentReading("げんざい、まいなすじゅっぱーせんとで、げらくです。");
  const flags = segs.map((s) => isVariableSeg(s));
  assert.ok(flags.some((f) => f === true));
  const plainIdx = segs.findIndex((s) => s.kind === "plain");
  if (plainIdx >= 0) assert.equal(flags[plainIdx], false);
});
