import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixWebmDuration } from './webmDuration.ts';

// 最小のWebM：EBMLヘッダ／Segment（サイズ不明）／Info（TimecodeScale=1,000,000）／Cluster（Timecode=0）
const sample = () => new Uint8Array([
  0x1a, 0x45, 0xdf, 0xa3, 0x84, 0x42, 0x82, 0x81, 0x77,
  0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
  0x15, 0x49, 0xa9, 0x66, 0x84, 0x2a, 0xd7, 0xb1, 0x81,
  0x1f, 0x43, 0xb6, 0x75, 0x83, 0xe7, 0x81, 0x00,
]);
// TimecodeScale 0x2AD7B1 の値を 1,000,000 にする（4バイト）
const withScale = () => {
  const u = sample();
  const a = Array.from(u);
  a.splice(21, 9, 0x15, 0x49, 0xa9, 0x66, 0x87, 0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40);
  return new Uint8Array(a);
};
const readDuration = (u: Uint8Array) => {
  for (let i = 0; i + 11 <= u.length; i++) if (u[i] === 0x44 && u[i + 1] === 0x89 && u[i + 2] === 0x88) return new DataView(u.buffer, u.byteOffset).getFloat64(i + 3);
  return null;
};

test('WebMにDurationを書き足す（ミリ秒）', () => {
  const out = fixWebmDuration(withScale(), 45_250);
  assert.equal(readDuration(out), 45_250);
  // Clusterはそのまま末尾に残る
  assert.deepEqual(Array.from(out.slice(-8)), [0x1f, 0x43, 0xb6, 0x75, 0x83, 0xe7, 0x81, 0x00]);
});

test('既にDurationがあれば値だけ書き換える', () => {
  const once = fixWebmDuration(withScale(), 10_000);
  const twice = fixWebmDuration(once, 12_000);
  assert.equal(twice.length, once.length);
  assert.equal(readDuration(twice), 12_000);
});

test('WebMでないデータや長さ0は元のまま返す', () => {
  const junk = new Uint8Array([1, 2, 3, 4]);
  assert.equal(fixWebmDuration(junk, 1000), junk);
  const w = withScale();
  assert.equal(fixWebmDuration(w, 0), w);
});
