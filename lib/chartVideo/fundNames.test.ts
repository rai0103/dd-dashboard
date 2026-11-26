import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fundAbbr, fundKey } from './fundNames.ts';

test('正式名称の略称', () => {
  assert.equal(fundAbbr('eMAXIS Slim 米国株式(S&P500)'), 'eMAXIS Slim S&P500');
  assert.equal(fundAbbr('eMAXIS Slim 国内株式(TOPIX)'), 'eMAXIS Slim TOPIX');
  assert.equal(fundAbbr('iFree 日経225インデックス'), 'iFree 日経225');
  assert.equal(fundAbbr('iFreeレバレッジ FANG＋'), 'iFreeレバレッジ FANG+');
  assert.equal(fundAbbr('iFreeNEXT NASDAQ100インデックス'), 'iFreeNEXT NASDAQ100');
  assert.equal(fundAbbr('1540 純金上場信託（現物国内保管型）'), '純金上場信託(1540)');
  assert.equal(fundAbbr('NEXT FUNDS 日経平均レバレッジ・インデックス連動型上場投信'), 'NF日経レバ');
  assert.equal(fundAbbr('NF日経レバ'), 'NF日経レバ');
  assert.equal(fundAbbr('eMAXIS Slim 全世界株式(オール・カントリー)'), 'eMAXIS Slim オルカン');
});

test('同じ銘柄の書き方の違いは同じ鍵になる', () => {
  assert.equal(fundKey('iFree日経225インデックス'), fundKey('iFree 日経225インデックス'));
  assert.equal(fundKey('NEXT FUNDS 日経平均レバレッジ・インデックス連動型上場投信'), fundKey('NF日経レバ'));
  assert.equal(fundKey('純金上場信託（現物国内保管型）'), fundKey('1540 純金上場信託（現物国内保管型）'));
  assert.notEqual(fundKey('iFree 日経225インデックス'), fundKey('NF日経レバ'));
});
