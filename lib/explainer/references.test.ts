// referenceBlocks() が組み立てるdocumentブロックのtitleが、Anthropic API側の上限（500文字）を
// 超えないことを確認する（参考情報のページタイトルが極端に長い場合に「台本を生成」全体が失敗する不具合の回帰テスト）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { referenceBlocks, capDocumentTitle, requiredRefNotes } from './references.ts';

test('capDocumentTitle：500文字以内ならそのまま、超えていれば499文字+…に切り詰める', () => {
  const short = '短いタイトル';
  assert.equal(capDocumentTitle(short), short);
  const long = 'あ'.repeat(600);
  const capped = capDocumentTitle(long);
  assert.equal(capped.length, 500);
  assert.equal(capped.endsWith('…'), true);
});

test('referenceBlocks：URL参考資料のタイトルが極端に長くても、titleは500文字を超えない', () => {
  const refs = [
    {
      id: 'r1',
      kind: 'url' as const,
      url: 'https://example.com/' + 'x'.repeat(200),
      title: 'と'.repeat(500),
      text: '本文',
      status: 'ok' as const,
    },
  ];
  const blocks = referenceBlocks(refs);
  assert.equal(blocks.length, 1);
  assert.equal(typeof blocks[0].title, 'string');
  assert.ok(blocks[0].title.length <= 500, `title.length=${blocks[0].title.length}`);
});

test('referenceBlocks：通常の短いタイトルは、参考番号とURLを含めてそのまま使われる', () => {
  const refs = [
    { id: 'r1', kind: 'url' as const, url: 'https://example.com/a', title: '普通の記事タイトル', text: '本文', status: 'ok' as const },
  ];
  const blocks = referenceBlocks(refs);
  assert.equal(blocks[0].title, '参考1：普通の記事タイトル（https://example.com/a）');
});

test('requiredRefNotes：requiredがtrueの資料だけを種別ラベル付きで列挙する', () => {
  const refs = [
    { id: 'r1', kind: 'text' as const, title: 'メモ', text: '本文', required: true },
    { id: 'r2', kind: 'text' as const, title: '任意のメモ', text: '本文2' },
    { id: 'r3', kind: 'csv' as const, title: '任天堂', text: 'Date,Close\n2026-01-01,100', sizeBytes: 10, required: true },
  ];
  const notes = requiredRefNotes(refs);
  assert.deepEqual(notes, ['メモ（テキスト）', '任天堂（CSV（株価データ））']);
});

test('requiredRefNotes：requiredなURLでも本文未取得（status!==\'ok\'）なら除外する', () => {
  const refs = [
    { id: 'r1', kind: 'url' as const, url: 'https://example.com/a', title: '記事', text: '', status: 'pending' as const, required: true },
    { id: 'r2', kind: 'url' as const, url: 'https://example.com/b', title: '記事2', text: '本文', status: 'ok' as const, required: true },
  ];
  const notes = requiredRefNotes(refs);
  assert.deepEqual(notes, ['記事2（example.com）（URL記事）']);
});
