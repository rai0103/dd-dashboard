import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyReadingDict, applyReadingDictToText, learnFromReadingEdit, readingPromptLine, setUserReadings, upsertReading, getReadingDict } from './readingDict.ts';

test('組み込みの読み方：続報→ぞくほう、新たな→あらたな（新しいの読みは直さない）', () => {
  setUserReadings([]);
  const narr = 'ドイツ銀行の続報です。新たな問題が見つかり、新しい対応が求められています。';
  const rd = 'どいつぎんこうの、ぞっぽうです。あたらしいもんだいが、みつかり、あたらしいたいおうが、もとめられています。';
  assert.equal(applyReadingDict(rd, narr), 'どいつぎんこうの、ぞくほうです。あらたなもんだいが、みつかり、あたらしいたいおうが、もとめられています。');
  assert.equal(applyReadingDictToText('新たな続報'), 'あらたなぞくほう');
});

test('ナレーションに語が無ければ読み上げ文は変えない', () => {
  setUserReadings([]);
  assert.equal(applyReadingDict('あたらしいせいさい', '新しい制裁'), 'あたらしいせいさい');
});

test('読み上げ文の直しから語と読みを推定する', () => {
  assert.deepEqual(learnFromReadingEdit('どいつぎんこうの、ぞっぽうです。', 'どいつぎんこうの、ぞくほうです。', 'ドイツ銀行の続報です。'), { word: '続報', reading: 'ぞくほう', wrong: ['ぞっぽう'], user: true });
  assert.deepEqual(learnFromReadingEdit('あたらしいせいさいを、はっぴょう。', 'あらたなせいさいを、はっぴょう。', '新たな制裁を発表。'), { word: '新たな', reading: 'あらたな', wrong: ['あたらしい'], user: true });
});

test('制作者が覚えさせた読みはプロンプトと補正に入る', () => {
  setUserReadings([]);
  upsertReading({ word: '市場', reading: 'しじょう', wrong: ['いちば'], user: true });
  assert.match(readingPromptLine(), /市場＝しじょう/);
  assert.equal(applyReadingDict('かぶしきいちばが', '株式市場が'), 'かぶしきしじょうが');
  assert.ok(getReadingDict().some((e) => e.word === '続報'));
  setUserReadings([]);
});
