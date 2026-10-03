// iDeCo（SMBC・DCナビ）スクショ取り込み。実行: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  brokerByKey, extractionToPreviewRows, previewRowsToHoldings, replaceBrokerHoldings, aggregateLabelsReplacedByBrokers,
  reconcileWithAccountTotal, reconciliationTarget, buildBrokerSummary, profitChecks, type Extraction,
} from "./brokerImport.ts";

const ideco = brokerByKey("ideco")!;
let n = 0;
const genId = () => `id-${++n}`;

// DCナビ「資産状況」画面のサンプル（worker/test/ideco_sample.html と同じ架空値）
// 資産評価額 2,181,860円 ＝ 取得価額 1,700,000円 ＋ 評価損益 481,860円
export const IDECO_SAMPLE: Extraction = {
  account_total: 2181860, account_total_currency: "JPY", notes: "", cash: [], section_totals: [],
  summary: { unrealized_pl: 481860, return_rate_pct: 6.82, risk: "11.25%" },
  as_of: "2026-10-02",
  holdings: [
    { section: "国内株式", name: "三井住友・DC日本株式インデックスファンドS", code: "", quantity: null, market_value: 412350, current_price: null, avg_cost: null, currency: "JPY", cost_basis: 300000, unrealized_pl: 112350, unrealized_pl_pct: 37.45 },
    { section: "外国株式", name: "三井住友・DC外国株式インデックスファンドS", code: "", quantity: null, market_value: 685920, current_price: null, avg_cost: null, currency: "JPY", cost_basis: 450000, unrealized_pl: 235920, unrealized_pl_pct: 52.43 },
    { section: "外国株式", name: "eMAXIS Slim 米国株式(S&P500)", code: "", quantity: null, market_value: 528400, current_price: null, avg_cost: null, currency: "JPY", cost_basis: 400000, unrealized_pl: 128400, unrealized_pl_pct: 32.1 },
    { section: "外国債券", name: "三井住友・DC外国債券インデックスファンド", code: "", quantity: null, market_value: 156780, current_price: null, avg_cost: null, currency: "JPY", cost_basis: 150000, unrealized_pl: 6780, unrealized_pl_pct: 4.52 },
    { section: "バランス", name: "三井住友・DC年金バランス30（債券重点型）", code: "", quantity: null, market_value: 98410, current_price: null, avg_cost: null, currency: "JPY", cost_basis: 100000, unrealized_pl: -1590, unrealized_pl_pct: -1.59 },
    { section: "元本確保型", name: "三井住友銀行確定拠出年金定期預金（5年）", code: "", quantity: null, market_value: 300000, current_price: null, avg_cost: null, currency: "JPY", cost_basis: 300000, unrealized_pl: 0, unrealized_pl_pct: 0 },
  ],
};

test("iDeCo：商品カテゴリー＋商品名から分類・クラスの初期値を推定", () => {
  const rows = extractionToPreviewRows(IDECO_SAMPLE, ideco);
  assert.deepEqual(rows.map((r) => [r.category, r.rank]), [
    ["日本（N225・Topix）", "E"],
    ["その他ETF・投信（米）", "E"],
    ["SP500", "C"],
    ["その他ETF・投信（米）", "E"],
    ["その他ETF・投信（日）", "E"],
    ["現金", "A"],
  ]);
  assert.equal(rows[0].section, "国内株式");
  assert.equal(rows[4].unrealizedPl, -1590);
});

test("iDeCo：資産評価額・評価損益との照合、取得価額等を保持して登録、サマリーを作成", () => {
  const rows = extractionToPreviewRows(IDECO_SAMPLE, ideco);
  const rec = reconcileWithAccountTotal(rows, null, reconciliationTarget(IDECO_SAMPLE))!;
  assert.equal(rec.diffJpy, 0);
  const pc = profitChecks(rows, IDECO_SAMPLE.summary);
  assert.deepEqual(pc, { rowsPl: 481860, screenPl: 481860, diff: 0, mismatchedRows: [] });
  // 読み取り誤り（簿価損益の桁落ち）は行単位で検出
  assert.deepEqual(profitChecks(rows.map((r, i) => (i === 1 ? { ...r, unrealizedPl: 23592 } : r)), IDECO_SAMPLE.summary).mismatchedRows, ["三井住友・DC外国株式インデックスファンドS"]);

  const { holdings, errors } = previewRowsToHoldings(rows, ideco, null, genId);
  assert.deepEqual(errors, []);
  assert.equal(holdings.reduce((s, h) => s + h.amount, 0), 2181860);
  assert.ok(holdings.every((h) => h.owner === "iDeCo" && h.broker === "ideco"));
  assert.deepEqual([holdings[1].costBasis, holdings[1].unrealizedPl, holdings[1].unrealizedPlPct, holdings[1].productCategory], [450000, 235920, 52.43, "外国株式"]);
  assert.equal(holdings[5].currency, "円");
  assert.equal(holdings[1].currency, "ドル"); // 外国株式インデックスは為替区分ドル

  const summary = buildBrokerSummary(ideco, IDECO_SAMPLE, holdings, new Date("2026-10-03T00:00:00Z"));
  assert.deepEqual(summary, {
    broker: "ideco", label: "iDeCo", importedAt: "2026-10-03T00:00:00.000Z", asOf: "2026-10-02",
    totalValue: 2181860, screenTotal: 2181860, costBasis: 1700000, unrealizedPl: 481860, returnRatePct: 6.82, risk: "11.25%",
  });
  // 画面に評価損益が無ければ 評価額−取得価額 で補完
  assert.equal(buildBrokerSummary(ideco, { ...IDECO_SAMPLE, summary: null }, holdings, new Date()).unrealizedPl, 481860);
});

test("iDeCo：再取り込みで前回分を置き換え、投資収支Excelの合算「iDeCo」は非表示に", () => {
  const first = previewRowsToHoldings(extractionToPreviewRows(IDECO_SAMPLE, ideco), ideco, null, genId).holdings;
  const existing = [{ id: "r1", name: "VOO", owner: "楽天(shin)", amount: 1 } as any, { id: "i0", name: "iDeCo", amount: 2000000 } as any];
  const after1 = replaceBrokerHoldings(existing, ideco, first);
  assert.equal(after1.length, 7);
  assert.ok(aggregateLabelsReplacedByBrokers(after1).has("iDeCo"));
  // 翌月：評価額が変わった4商品だけの画面を取り込み直しても増殖しない
  const next = { ...IDECO_SAMPLE, holdings: IDECO_SAMPLE.holdings.slice(0, 4).map((h) => ({ ...h, market_value: (h.market_value as number) + 1000 })) };
  const after2 = replaceBrokerHoldings(after1, ideco, previewRowsToHoldings(extractionToPreviewRows(next, ideco), ideco, null, genId).holdings);
  assert.equal(after2.filter((h: any) => h.broker === "ideco").length, 4);
  assert.equal(after2.length, 5);
});

test("読み取り結果に混ざった空行（名称・評価額なし）は除く", () => {
  const blank = { section: "", name: "", code: "", quantity: null, market_value: null, current_price: null, avg_cost: null, currency: "JPY" as const, cost_basis: null, unrealized_pl: null, unrealized_pl_pct: null };
  const rows = extractionToPreviewRows({ ...IDECO_SAMPLE, holdings: [...IDECO_SAMPLE.holdings, blank] }, ideco);
  assert.equal(rows.length, 6);
  assert.deepEqual(previewRowsToHoldings(rows, ideco, null, genId).errors, []);
});
