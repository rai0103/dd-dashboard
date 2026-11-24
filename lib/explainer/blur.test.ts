import { test } from 'node:test';
import assert from 'node:assert/strict';
import { regionFromDrag, blurRadiusPx } from './blur.ts';

test('ドラッグした範囲を0〜1に収める（逆向き・はみ出しも）', () => {
  assert.deepEqual(regionFromDrag(0.6, 0.5, 0.2, 0.1), { x: 0.2, y: 0.1, w: 0.39999999999999997, h: 0.4 });
  assert.deepEqual(regionFromDrag(-0.2, 0.9, 0.3, 1.4), { x: 0, y: 0.9, w: 0.3, h: 0.09999999999999998 });
  assert.equal(regionFromDrag(0.5, 0.5, 0.505, 0.6), null);
});

test('ぼかしの半径は画像の長辺に比例する', () => {
  assert.equal(blurRadiusPx(20, 1000, 500), 20);
  assert.equal(blurRadiusPx(20, 1920, 1080), 38);
  assert.equal(blurRadiusPx(0, 100, 100), 1);
});
