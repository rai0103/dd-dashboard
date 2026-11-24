import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findProperNouns } from './properNouns.ts';

test('人物・建物・地名・企業名らしい語を見つける', () => {
  const r = findProperNouns(['ドイツ銀行の株価が急落', 'トランプ大統領が関税を発表', '東京タワーと富士山', 'NVIDIAの決算']);
  for (const w of ['ドイツ銀行', 'トランプ大統領', '東京タワー', '富士山', 'NVIDIA']) assert.ok(r.includes(w), `${w} が無い：${r.join(',')}`);
});

test('一般的な語・略語は拾わない', () => {
  assert.deepEqual(findProperNouns(['インフレとデフレのリスク', 'GDPとCPIの推移', 'ドローダウンの平均']), []);
});
