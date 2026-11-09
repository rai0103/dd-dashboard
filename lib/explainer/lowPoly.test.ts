// 実行: node --test lib/explainer/lowPoly.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { delaunay, samplePoints, edgeMap } from "./lowPoly.ts";

const area = (a: any, b: any, c: any) => Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;

test("delaunay：四角形は2つの三角形になり、面積の合計が元の四角形と一致する", () => {
  const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }];
  const t = delaunay(pts);
  assert.equal(t.length, 2);
  assert.equal(t.reduce((s, [a, b, c]) => s + area(pts[a], pts[b], pts[c]), 0), 100);
});

test("delaunay：ランダムな点でも、三角形の面積の合計＝凸包（外周の点を含む長方形）の面積", () => {
  const w = 200, h = 120;
  const pts = samplePoints(w, h, new Float32Array(w * h).fill(0.5), 300, 0.5, 3);
  const t = delaunay(pts);
  const sum = t.reduce((s, [a, b, c]) => s + area(pts[a], pts[b], pts[c]), 0);
  assert.ok(Math.abs(sum - (w - 1) * (h - 1)) < 1e-6 * w * h, `面積 ${sum}`);
  // 点の数n・外周の点kのとき、三角形の数は 2n − 2 − k 個（ここでは外周が長方形の辺上の点）
  assert.ok(t.length > pts.length);
});

test("edgeMap・samplePoints：輪郭のある側に点が多く集まる", () => {
  const w = 100, h = 60;
  const gray = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) gray[y * w + x] = x < 30 ? 0 : 255; // x=30に縦の境目
  const e = edgeMap(gray, w, h);
  const pts = samplePoints(w, h, e, 400, 0.9, 5);
  const near = pts.filter((p) => Math.abs(p.x - 30) < 4).length;
  // 境目付近（幅8px＝全体の8%）に、一様に置いた場合よりずっと多くの点が集まる
  assert.ok(near > pts.length * 0.25, `境目付近 ${near}/${pts.length}`);
});
