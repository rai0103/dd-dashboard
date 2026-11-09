// 実行: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { stripRefMarks, stripRefMarksReading, stripRefMarksScene, applyGlossary } from "./scriptModel.ts";
import { emptyVisual } from "./types.ts";

const sc = (narration: string, reading = "", extra: any = {}) => ({ id: "x", title: "", caption: "", narration, reading, visual: { ...emptyVisual("points") }, chapter: 1, minSec: 3, imageId: null, ...extra });

test("stripRefMarks：参考・添付の番号と、続く「によると」等を取り除く", () => {
  assert.equal(stripRefMarks("参考1によると、売上は3割増えました。"), "売上は3割増えました。");
  assert.equal(stripRefMarks("売上は3割増えました（参考2）。"), "売上は3割増えました。");
  assert.equal(stripRefMarks("参考1の日経新聞の記事では、増収とされています。"), "日経新聞の記事では、増収とされています。");
  assert.equal(stripRefMarks("添付2と3の資料から、次のことがわかります。"), "次のことがわかります。");
  assert.equal(stripRefMarks("参考1 総務省 情報通信白書"), "総務省 情報通信白書");
  assert.equal(stripRefMarks("【参考3：日銀】金利は0.5%です。"), "金利は0.5%です。");
  // 番号の無い「参考」はそのまま
  assert.equal(stripRefMarks("この資料を参考にしてください。"), "この資料を参考にしてください。");
  assert.equal(stripRefMarks("参考資料一覧"), "参考資料一覧");
});

test("stripRefMarksReading：読み上げ文の番号も取り除き、「さんこうに」は残す", () => {
  assert.equal(stripRefMarksReading("さんこういちによると、うりあげは"), "うりあげは");
  assert.equal(stripRefMarksReading("このしりょうをさんこうにしてください"), "このしりょうをさんこうにしてください");
});

test("stripRefMarksScene：ナレーションだけ取れて読み上げ文で取れなければ要確認にする", () => {
  const a = stripRefMarksScene(sc("参考1によると、増えました。", "ふえました。") as any);
  assert.equal(a.narration, "増えました。");
  assert.equal(a.readingStale, true);
  const b = stripRefMarksScene(sc("参考1によると、増えました。", "さんこういちによると、ふえました。") as any);
  assert.equal(b.reading, "ふえました。");
  assert.ok(!b.readingStale);
});

test("applyGlossary：初出にだけ説明を添え、2回目以降の説明は取り除く", () => {
  const g = [{ term: "スターリンク", termReading: "すたーりんく", gloss: "低軌道衛星を使ったインターネット通信サービス", glossReading: "ていきどうえいせいをつかったいんたーねっとつうしんさーびす" }];
  const out = applyGlossary([
    sc("スターリンクが日本で広がっています。", "すたーりんくがにほんでひろがっています。"),
    sc("低軌道衛星を使ったインターネット通信サービスのスターリンクは、山でも使えます。", "ていきどうえいせいをつかったいんたーねっとつうしんさーびすのすたーりんくは、やまでもつかえます。"),
  ] as any, g);
  assert.equal(out[0].narration, "低軌道衛星を使ったインターネット通信サービスのスターリンクが日本で広がっています。");
  assert.equal(out[0].reading, "ていきどうえいせいをつかったいんたーねっとつうしんさーびすのすたーりんくがにほんでひろがっています。");
  assert.equal(out[1].narration, "スターリンクは、山でも使えます。");
  assert.equal(out[1].reading, "すたーりんくは、やまでもつかえます。");
});

test("applyGlossary：初出ですでに「〜とは」で説明していれば足さない・語の一部には反応しない", () => {
  const g = [{ term: "ETF", gloss: "上場投資信託" }];
  const out = applyGlossary([sc("ETFとは、取引所で売買できる投資信託です。"), sc("ETFを買う人が増えました。")] as any, g);
  assert.equal(out[0].narration, "ETFとは、取引所で売買できる投資信託です。");
  assert.equal(out[1].narration, "ETFを買う人が増えました。");
  const g2 = [{ term: "スター", gloss: "人気者" }];
  assert.equal(applyGlossary([sc("スターリンクです。")] as any, g2)[0].narration, "スターリンクです。");
});
