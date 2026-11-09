// 実行: node --test lib/explainer/autoImages.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { pickImageScenes, splitFreeAi } from "./autoImages.ts";

const s = (kind: string, extra: any = {}) => ({ visual: { kind }, imageId: null, ...extra });

test("pickImageScenes：割合どおりに選び、タイトル・数値の図解・固定場面は除く", () => {
  const sc = [s("title"), s("points"), s("image"), s("bar"), s("illustration"), s("flow"), s("keyword", { fixedKey: "fixed:x" }), s("compare"), s("points"), s("cta")];
  // 画像にできる場面：points, image, illustration, flow, compare, points ＝6場面。50%で3場面
  const p = pickImageScenes(sc as any, 0.5);
  assert.equal(p.length, 3);
  assert.ok(p.includes(2) && p.includes(4)); // image・イメージ図が優先
  assert.ok(!p.includes(0) && !p.includes(3) && !p.includes(6) && !p.includes(9));
});

test("pickImageScenes：すでに画像がある場面は割合に数え、足りない分だけ選ぶ", () => {
  const sc = [s("points", { imageId: "a" }), s("points"), s("points"), s("points")];
  assert.deepEqual(pickImageScenes(sc as any, 0.25), []);
  assert.equal(pickImageScenes(sc as any, 0.5).length, 1);
  assert.deepEqual(pickImageScenes(sc as any, 0), []);
});

test("splitFreeAi：写真で見つかりやすい場面からフリー素材に、残りをAI生成に", () => {
  const fit: Record<number, number> = { 1: 9, 3: 2, 5: 7, 7: 1 };
  const r = splitFreeAi([1, 3, 5, 7], (i) => fit[i], 0.5);
  assert.deepEqual(r.free, [1, 5]);
  assert.deepEqual(r.ai, [3, 7]);
  assert.deepEqual(splitFreeAi([1, 3], (i) => fit[i], 0).ai, []);
  assert.deepEqual(splitFreeAi([1, 3], (i) => fit[i], 1).free, []);
});
