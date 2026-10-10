// 実行: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { fxExposureOf, isCurrencyHedged } from "./fxExposure.ts";

test("カテゴリーのみ：米国系・ゴールド・暗号資産はドル、日本系は円（旧 exposureCurrency と同じ）", () => {
  assert.equal(fxExposureOf({ category: "個別（米）" }), "ドル");
  assert.equal(fxExposureOf({ category: "SP500" }), "ドル");
  assert.equal(fxExposureOf({ category: "ゴールド" }), "ドル");
  assert.equal(fxExposureOf({ category: "暗号資産" }), "ドル");
  assert.equal(fxExposureOf({ category: "個別（日）" }), "円");
  assert.equal(fxExposureOf({ category: "日本（N225・Topix）" }), "円");
});

test("日本上場・円建ての米国株系ファンドはドル（口座通貨が円でも）", () => {
  for (const name of ["eMAXIS Slim 米国株式(S&P500)", "SBI・V・S&P500インデックス・ファンド", "1655 ＩＳＳ＆Ｐ５００米国株", "楽天・プラス・Ｓ＆Ｐ５００インデックス・ファンド", "ＳＭＢＣ・ＤＣインデックスファンド（Ｓ＆Ｐ５００）", "iFreeNEXT NASDAQ100インデックス", "316A ＩＦＲＥＥＥＴＦＦＡＮＧ＋", "2013 ＩＳ米国高配当株"]) {
    assert.equal(fxExposureOf({ name, category: "その他", currency: "円", valueCurrency: "JPY" }), "ドル", name);
  }
});

test("為替ヘッジ付きは円（ヘッジなし・無は対象外）", () => {
  assert.equal(fxExposureOf({ name: "2521 上場米国株ヘッジ有", category: "SP500", currency: "ドル" }), "円");
  assert.equal(fxExposureOf({ name: "ピクテ・ゴールド（為替ヘッジあり）", category: "ゴールド", valueCurrency: "JPY" }), "円");
  assert.equal(fxExposureOf({ name: "eMAXIS 米国株式(S&P500) 円ヘッジ", category: "SP500" }), "円");
  assert.equal(isCurrencyHedged("ｉシェアーズ 米国株（為替ヘッジなし）"), false);
  assert.equal(fxExposureOf({ name: "ｉシェアーズ 米国株（為替ヘッジなし）", category: "SP500" }), "ドル");
});

test("ゴールドは楽天CSV・スクショのどちらの経路でもドル（旧ルールの不一致を解消）", () => {
  assert.equal(fxExposureOf({ name: "1540 純金上場信託（現物国内保管型）", category: "ゴールド", valueCurrency: "JPY" }), "ドル");
  assert.equal(fxExposureOf({ name: "GLD SPDR ゴールド・シェア", category: "ゴールド", currency: "円" }), "ドル");
  assert.equal(fxExposureOf({ name: "Tracers S&P500ゴールドプラス（ゴールド）", category: "ゴールド", currency: "円" }), "ドル");
});

test("対応表に無い銘柄は口座通貨（取引通貨→取込時の通貨）、現金は保有通貨、手動指定が最優先", () => {
  assert.equal(fxExposureOf({ name: "4661 オリエンタルランド", category: "個別（日）", currency: "円" }), "円");
  assert.equal(fxExposureOf({ name: "Some Fund", category: "その他", valueCurrency: "USD" }), "ドル");
  assert.equal(fxExposureOf({ name: "iDeCo", category: "iDeCo", currency: "ドル" }), "ドル"); // 投資収支Excelの合算エントリは口座設定の通貨
  assert.equal(fxExposureOf({ name: "現金(ドル)", category: "現金", currency: "ドル" }), "ドル");
  assert.equal(fxExposureOf({ name: "現金(円)", category: "現金", currency: "円" }), "円");
  assert.equal(fxExposureOf({ name: "2521 上場米国株ヘッジ有", category: "SP500", fxManual: "ドル" }), "ドル");
});
