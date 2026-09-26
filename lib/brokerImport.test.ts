// 実行: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BROKERS, brokerByKey, guessBrokerCategory, exposureCurrency, extractionToPreviewRows, previewRowsToHoldings,
  replaceBrokerHoldings, aggregateLabelsReplacedByBrokers, holdingDisplayName, rowValue, type Extraction,
} from "./brokerImport.ts";

const moomoo = brokerByKey("moomoo")!;
let n = 0;
const genId = () => `id-${++n}`;

// moomoo「口座」画面の10銘柄（IonQは 12株 × $45.48 = $545.76）
const SAMPLE: Extraction = {
  account_total: 1234567, account_total_currency: "JPY", notes: "",
  holdings: [
    { name: "IonQ", code: "IONQ", quantity: 12, market_value: 545.76, current_price: 45.48, avg_cost: 38.2, currency: "USD" },
    { name: "Meta Platforms", code: "META", quantity: 2, market_value: 1512.4, current_price: 756.2, avg_cost: 610, currency: "USD" },
    { name: "NVIDIA", code: "NVDA", quantity: 10, market_value: 2245.8, current_price: 224.58, avg_cost: 150, currency: "USD" },
    { name: "Palantir Technologies", code: "PLTR", quantity: 8, market_value: 1480.0, current_price: 185.0, avg_cost: 120, currency: "USD" },
    { name: "Rocket Lab", code: "RKLB", quantity: 20, market_value: 1102.0, current_price: 55.1, avg_cost: 30, currency: "USD" },
    { name: "SoFi Technologies", code: "SOFI", quantity: 30, market_value: 891.0, current_price: 29.7, avg_cost: 18, currency: "USD" },
    { name: "Direxion Daily Semiconductor Bull 3X", code: "SOXL", quantity: 15, market_value: 1051.5, current_price: 70.1, avg_cost: 55, currency: "USD" },
    { name: "SPCH", code: "SPCH", quantity: 5, market_value: 250.0, current_price: 50.0, avg_cost: 48, currency: "USD" },
    { name: "SpaceX", code: "SPCX", quantity: 3, market_value: null, current_price: 148.7, avg_cost: 120, currency: "USD" },
    { name: "Tesla", code: "TSLA", quantity: 4, market_value: 1760.0, current_price: 440.0, avg_cost: 300, currency: "USD" },
  ],
};

test("BROKERS: moomoo証券が設定リストに登録されている", () => {
  assert.equal(BROKERS[0].key, "moomoo");
  assert.equal(moomoo.label, "moomoo証券");
  assert.equal(moomoo.defaultRank, "D");
  assert.equal(brokerByKey("unknown"), null);
});

test("カテゴリー推定と為替区分（米国株関連はドル・日本株関連は円）", () => {
  assert.equal(guessBrokerCategory("SOXL", "Direxion Semiconductor Bull 3X", "USD"), "レバレッジETF（米）");
  assert.equal(guessBrokerCategory("VOO", "Vanguard S&P 500", "USD"), "SP500");
  assert.equal(guessBrokerCategory("TSLA", "Tesla", "USD"), "個別（米）");
  assert.equal(guessBrokerCategory("7203", "トヨタ自動車", "JPY"), "個別（日）");
  assert.equal(exposureCurrency("個別（米）"), "ドル");
  assert.equal(exposureCurrency("SP500"), "ドル"); // 日本上場のS&P500投信でもドル
  assert.equal(exposureCurrency("個別（日）"), "円");
  assert.equal(exposureCurrency("日本（N225・Topix）"), "円");
});

test("銘柄名は「ティッカー 銘柄名」形式、評価額が無ければ数量×現在値で補完", () => {
  assert.equal(holdingDisplayName("ionq", "IonQ"), "IONQ IonQ");
  assert.equal(holdingDisplayName("SPCH", "SPCH"), "SPCH");
  assert.equal(holdingDisplayName("TSLA", "TSLA Tesla"), "TSLA Tesla");
  assert.equal(holdingDisplayName("META", "Meta Platforms"), "META Meta Platforms");
  assert.equal(holdingDisplayName("SOFI", "SoFi Technologies"), "SOFI SoFi Technologies");
  assert.equal(rowValue({ marketValue: null, quantity: 3, currentPrice: 148.7 }), 446.1);
});

test("moomoo 10銘柄：USD評価額を円換算して個別登録し、合算エントリを削除する", () => {
  const rows = extractionToPreviewRows(SAMPLE, moomoo);
  assert.equal(rows.length, 10);
  assert.ok(rows.every((r) => r.rank === "D"));
  assert.equal(rows.find((r) => r.code === "SOXL")!.category, "レバレッジETF（米）");

  const usdJpy = 150;
  const { holdings, errors } = previewRowsToHoldings(rows, moomoo, usdJpy, genId);
  assert.deepEqual(errors, []);
  assert.deepEqual(holdings.map((h) => h.ticker), ["IONQ", "META", "NVDA", "PLTR", "RKLB", "SOFI", "SOXL", "SPCH", "SPCX", "TSLA"]);
  const ionq = holdings[0];
  assert.equal(ionq.name, "IONQ IonQ");
  assert.equal(ionq.amount, Math.round(545.76 * 150)); // 81,864円
  assert.equal(ionq.currency, "ドル");
  assert.equal(ionq.owner, "moomoo証券");
  assert.equal(ionq.broker, "moomoo");
  assert.equal(holdings.find((h) => h.ticker === "SPCX")!.amount, Math.round(446.1 * 150));

  // 既存：楽天の保有＋moomoo証券の合算1件
  const existing = [
    { id: "r1", name: "VOO バンガード・S&P 500 ETF", owner: "shin", amount: 1000000 } as any,
    { id: "m0", name: "moomoo証券", owner: "moomoo証券", amount: 1500000 } as any,
  ];
  const after = replaceBrokerHoldings(existing, moomoo, holdings);
  assert.equal(after.length, 11);
  assert.ok(!after.some((h) => h.name === "moomoo証券"), "合算エントリが削除されている");
  assert.ok(after.some((h) => h.id === "r1"), "楽天の保有は残る");

  // 再取り込み：前回の個別銘柄は全削除され、増殖しない
  const rows2 = extractionToPreviewRows({ ...SAMPLE, holdings: SAMPLE.holdings.slice(0, 3) }, moomoo);
  const again = replaceBrokerHoldings(after, moomoo, previewRowsToHoldings(rows2, moomoo, 151, genId).holdings);
  assert.equal(again.length, 4);
  assert.equal(again.filter((h: any) => h.broker === "moomoo").length, 3);

  // 投資収支Excel由来の「moomoo証券」合算（仮想エントリ）を非表示にする対象
  assert.deepEqual([...aggregateLabelsReplacedByBrokers(after)], ["moomoo証券"]);
  assert.deepEqual([...aggregateLabelsReplacedByBrokers(existing)], []);
});

test("除外した行・評価額不明・為替レート未取得はエラーとして弾く", () => {
  const rows = extractionToPreviewRows(SAMPLE, moomoo);
  rows[1].include = false;
  rows[2].marketValue = null; rows[2].currentPrice = null;
  const r1 = previewRowsToHoldings(rows, moomoo, 150, genId);
  assert.equal(r1.holdings.length, 8);
  assert.equal(r1.errors.length, 1);
  const r2 = previewRowsToHoldings(rows, moomoo, null, genId);
  assert.equal(r2.holdings.length, 0);
  assert.ok(r2.errors.every((e) => e.includes("USD/JPY")) || r2.errors.length === 9);
});

test("純資産（JPY）との照合：moomooの換算レートを逆算すれば丸め誤差の範囲で一致する", async () => {
  const { reconcileWithAccountTotal, isPlausibleBrokerRate } = await import("./brokerImport.ts");
  // サンプル画面：保有10銘柄 $20,050.31 ＋ 現金 $312.45、純資産 ¥3,200,619（moomoo側レート 157.18 で換算）
  const ext: Extraction = { ...SAMPLE, cash: [{ currency: "USD", amount: 312.45 }], account_total: 3200619, account_total_currency: "JPY" };
  ext.holdings = ext.holdings.map((h) => (h.code === "SPCX" ? { ...h, market_value: 892.2, quantity: 6 } : h));
  const base = [545.76, 2256.9, 5614.5, 2739.75, 2324.8, 1736.4, 1425.0, 324.0, 892.2, 2191.0];
  ext.holdings = ext.holdings.map((h, i) => ({ ...h, market_value: base[i] }));
  const rows = extractionToPreviewRows(ext, moomoo);
  assert.equal(rows.length, 11);
  const cash = rows.find((r) => r.category === "現金")!;
  assert.equal(cash.name, "現金(ドル)");
  assert.equal(cash.rank, "A");

  const market = reconcileWithAccountTotal(rows, 157.3, ext)!;
  assert.ok(Math.abs(market.diffJpy - 20362.76 * 0.12) < 1, `市場レートでは約¥2,444ずれる: ${market.diffJpy}`);
  assert.ok(Math.abs(market.impliedRate! - 157.18) < 0.0001);
  assert.ok(isPlausibleBrokerRate(market.impliedRate, 157.3));

  const broker = reconcileWithAccountTotal(rows, market.impliedRate, ext)!;
  assert.ok(Math.abs(broker.diffJpy) < 1, `逆算レートなら¥1未満: ${broker.diffJpy}`);
  const { holdings } = previewRowsToHoldings(rows, moomoo, market.impliedRate, genId);
  const sum = holdings.reduce((s, h) => s + h.amount, 0);
  assert.ok(Math.abs(sum - 3200619) <= 11, `保存する円換算額の合計（行ごとの四捨五入込み）: ${sum}`);
  assert.equal(holdings.find((h) => h.category === "現金")!.currency, "ドル");

  // 読み取り誤り（NVDAの桁落ち）があると逆算レートが市場レートから大きく外れ、採用しない
  const bad = rows.map((r) => (r.code === "NVDA" ? { ...r, marketValue: 561.45 } : r));
  const rb = reconcileWithAccountTotal(bad, 157.3, ext)!;
  assert.ok(!isPlausibleBrokerRate(rb.impliedRate, 157.3), `impliedRate=${rb.impliedRate}`);
  assert.ok(Math.abs(rb.diffPct) > 20);
});
