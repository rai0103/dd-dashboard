// Coincheck（暗号資産）スクショ取り込み。実行: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  brokerByKey, extractionToPreviewRows, previewRowsToHoldings, replaceBrokerHoldings, aggregateLabelsReplacedByBrokers,
  reconcileWithAccountTotal, reconciliationTarget, holdingDisplayName, type Extraction,
} from "./brokerImport.ts";

const coincheck = brokerByKey("coincheck")!;
let n = 0;
const genId = () => `id-${++n}`;

// 取引アカウント画面のサンプル（worker/test/coincheck_sample.html と同じ架空値）
// 合計評価額 1,063,280円 ＝ 暗号資産 1,010,940円 ＋ 日本円 52,340円
export const COINCHECK_SAMPLE: Extraction = {
  account_total: 1063280, account_total_currency: "JPY", notes: "", section_totals: [],
  cash: [{ currency: "JPY", amount: 52340 }],
  holdings: [
    { code: "BTC", name: "ビットコイン", quantity: 0.03152, market_value: 512380, current_price: 16255710, avg_cost: null, currency: "JPY", section: "" },
    { code: "ETH", name: "イーサリアム", quantity: 0.8421, market_value: 318560, current_price: 378292, avg_cost: null, currency: "JPY", section: "" },
    { code: "XRP", name: "エックスアールピー", quantity: 1250, market_value: 118750, current_price: 95, avg_cost: null, currency: "JPY", section: "" },
    { code: "SOL", name: "ソラナ", quantity: 2.5, market_value: 61250, current_price: 24500, avg_cost: null, currency: "JPY", section: "" },
  ],
};

test("Coincheck：暗号資産はすべて「暗号資産」カテゴリー・Eクラス、日本円は現金（Aクラス）", () => {
  const rows = extractionToPreviewRows(COINCHECK_SAMPLE, coincheck);
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.slice(0, 4).map((r) => [r.code, r.category, r.rank]), [["BTC", "暗号資産", "E"], ["ETH", "暗号資産", "E"], ["XRP", "暗号資産", "E"], ["SOL", "暗号資産", "E"]]);
  assert.deepEqual([rows[4].name, rows[4].category, rows[4].rank], ["現金(円)", "現金", "A"]);
  assert.equal(holdingDisplayName("BTC", "ビットコイン"), "BTC ビットコイン");
});

test("Coincheck：合計評価額と一致、口座主「Coin Check」で登録し投資収支Excelの合算を置き換え", () => {
  const rows = extractionToPreviewRows(COINCHECK_SAMPLE, coincheck);
  const rec = reconcileWithAccountTotal(rows, null, reconciliationTarget(COINCHECK_SAMPLE))!;
  assert.equal(rec.diffJpy, 0);
  const { holdings, errors } = previewRowsToHoldings(rows, coincheck, null, genId);
  assert.deepEqual(errors, []);
  assert.equal(holdings.reduce((s, h) => s + h.amount, 0), 1063280);
  assert.ok(holdings.every((h) => h.owner === "Coin Check" && h.broker === "coincheck"));
  assert.equal(holdings[0].name, "BTC ビットコイン");
  assert.equal(holdings[0].quantity, 0.03152);
  assert.equal(holdings[0].currency, "ドル"); // 暗号資産の為替区分はドル
  assert.equal(holdings[4].currency, "円");

  const existing = [{ id: "c0", name: "Coin Check", amount: 900000 } as any, { id: "r1", name: "VOO", owner: "楽天(shin)", amount: 1 } as any];
  const after = replaceBrokerHoldings(existing, coincheck, holdings);
  assert.equal(after.length, 6);
  assert.ok(aggregateLabelsReplacedByBrokers(after).has("Coin Check"));
});
