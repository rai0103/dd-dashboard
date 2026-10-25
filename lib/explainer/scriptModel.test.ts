import { test } from "node:test";
import assert from "node:assert/strict";
import { parseValue, normalizeVisual, sanitizeReading, katakanaToHiragana, findVerbatimOverlaps, assembleLong, normalizeScene, lintScenes, buildDescription } from "./scriptModel.ts";

test("数値の取り出し", () => {
  assert.equal(parseValue("1,234.5兆円"), 1234.5);
  assert.equal(parseValue("約12%"), 12);
  assert.equal(parseValue("−3.2"), -3.2);
  assert.equal(parseValue("１２３"), 123);
  assert.equal(parseValue("不明"), null);
});

test("数値が足りないグラフは要点の図解に切り替える（数値をでっち上げない）", () => {
  const v = normalizeVisual({ kind: "bar", items: [{ label: "A", value: "多い", text: "", icon: "chip" }, { label: "B", value: "", text: "少ない", icon: "nope" }] });
  assert.equal(v.kind, "points");
  assert.equal(v.items[1].icon, "bulb");
  const ok = normalizeVisual({ kind: "bar", items: [{ label: "A", value: "10", text: "", icon: "chip" }, { label: "B", value: "x", text: "", icon: "chip" }, { label: "C", value: "5", text: "", icon: "chip" }] });
  assert.equal(ok.kind, "bar");
  assert.equal(ok.items.length, 2);
});

test("不明な種類・不足した比較は安全な種類に寄せる", () => {
  assert.equal(normalizeVisual({ kind: "hologram" }).kind, "point");
  assert.equal(normalizeVisual({ kind: "compare", items: [{ label: "A" }] }).kind, "points");
  assert.equal(normalizeVisual({ kind: "cycle", items: [{ label: "A" }, { label: "B" }] }).kind, "flow");
});

test("読み上げ文の補正", () => {
  assert.equal(katakanaToHiragana("インフレ"), "いんふれ");
  assert.deepEqual(sanitizeReading("ニチギンが、「きんり」を、あげました！", "日銀が金利を上げました"), { reading: "にちぎんが、きんりを、あげました。", ok: true });
  assert.deepEqual(sanitizeReading("日銀が、きんりを", "日銀が金利を上げました"), { reading: "日銀が金利を上げました", ok: false });
});

test("参考資料の丸写しを見つける", () => {
  const ref = "日本銀行は本日の金融政策決定会合において、短期政策金利を0.5%程度から0.75%程度に引き上げることを決定した。";
  const copied = "日本銀行は本日の金融政策決定会合において、短期政策金利を引き上げました。";
  const paraphrased = "日銀は今日の会合で、短い期間の金利を少し上げると決めました。";
  assert.ok(findVerbatimOverlaps(copied, [ref]).length > 0);
  assert.equal(findVerbatimOverlaps(paraphrased, [ref]).length, 0);
});

test("章の扉と参考資料を入れて長尺を組み立てる", () => {
  const chapters = [
    { title: "つかみ", reading: "つかみ", role: "intro", goal: "", keyPoints: "", sceneCount: 2 },
    { title: "背景", reading: "はいけい", role: "body", goal: "", keyPoints: "", sceneCount: 2 },
    { title: "まとめ", reading: "まとめ", role: "outro", goal: "", keyPoints: "", sceneCount: 1 },
  ] as const;
  const sc = (n: string) => normalizeScene({ title: n, caption: n, narration: `${n}です。`, reading: "です。", visual: { kind: "point", emphasis: n } }, 0);
  const out = assembleLong(chapters as any, [[sc("a"), sc("b")], [sc("c")], [sc("d")]], [{ title: "参考1", detail: "" }], true, true);
  assert.equal(assembleLong(chapters as any, [[sc("a")], [sc("c")], [sc("d")]], [{ title: "参考1", detail: "" }]).some((s) => s.visual.kind === "sources"), false);
  assert.deepEqual(out.map((s) => s.visual.kind), ["point", "point", "chapter", "point", "point", "sources"]);
  assert.equal(out[2].visual.emphasis, "1");
  assert.equal(out[3].chapter, 1);
});

test("公開前チェック：出典なしの数値・同じ図解の連続", () => {
  const a = normalizeScene({ narration: "a", reading: "あ", visual: { kind: "number", items: [{ label: "x", value: "3", text: "", icon: "yen" }] } }, 0);
  const b = normalizeScene({ narration: "b", reading: "び", visual: { kind: "number", source: "参考1", items: [{ label: "x", value: "3", text: "", icon: "yen" }] } }, 0);
  const issues = lintScenes([a, b], []);
  assert.ok(issues.some((x) => x.sceneIndex === 0 && x.message.includes("出典")));
  assert.ok(issues.some((x) => x.sceneIndex === 1 && x.message.includes("同じ種類")));
});

test("概要欄に参考資料とAI利用の注記を入れる", () => {
  const d = buildDescription({ youtube: { title: "", description: "概要", tags: ["金利", "#日銀"], thumbnailText: "", shortTitle: "", shortDescription: "短い" }, sources: [{ title: "日銀発表", detail: "2026年10月" }] }, ["https://example.com/a"]);
  assert.match(d, /■ 参考資料/);
  assert.match(d, /https:\/\/example.com\/a/);
  assert.match(d, /AIで構成/);
  assert.match(d, /#金利 #日銀/);
  assert.match(buildDescription({ youtube: { title: "", description: "", tags: ["x"], thumbnailText: "", shortTitle: "", shortDescription: "短い" }, sources: [] }, [], true), /#shorts/);
});

import { predictTotalSec, suggestRate } from "./scriptModel.ts";
test("目標時間に収まる声の速さを提案する", () => {
  const scenes = Array.from({ length: 20 }, () => ({ narration: "あ".repeat(80), minSec: 6 }));
  // 80字÷5字/秒=16秒＋1.1秒 → 20場面で342秒
  assert.equal(Math.round(predictTotalSec(scenes, 1)), 342);
  const r = suggestRate(scenes, 300)!;
  assert.ok(r > 1 && r < 1.3);
  assert.ok(predictTotalSec(scenes, r) <= 300);
  assert.equal(suggestRate(scenes, 100), null); // 2倍でも収まらない
  // 実測があれば実測を優先（1.5倍で各10秒 → 1.0倍なら各15秒）
  assert.equal(Math.round(predictTotalSec(scenes, 1, { rate: 1.5, secs: scenes.map(() => 10) })), 20 * 16.1);
});
