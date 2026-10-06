// 実行: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeSyncData, type SyncData } from "./syncMerge.ts";

const J = (v: unknown) => JSON.stringify(v);
const h = (owner: string, name: string, amount: number, broker?: string) => ({ id: `${owner}-${name}`, owner, name, amount, ...(broker ? { broker } : {}) });

// 前回同期時点：楽天＋moomoo（旧）
const BASE: SyncData = {
  portfolio_holdings: J([h("楽天(shin)", "VOO", 100), h("moomoo", "TSLA", 10, "moomoo")]),
  holdings_as_of: J({ "楽天(shin)": "2026-09-30" }),
  broker_summaries: J({}),
  lifecycle_settings: J({ phase: 1 }),
};

test("スマホでmoomooを取込（サーバー側）→ 開きっぱなしのPCでCoincheckを取込（この端末）：両方の更新が残る", () => {
  const server: SyncData = { // スマホが先に送信
    ...BASE,
    portfolio_holdings: J([h("楽天(shin)", "VOO", 100), h("moomoo", "TSLA", 12, "moomoo"), h("moomoo", "NVDA", 5, "moomoo")]),
    holdings_as_of: J({ "楽天(shin)": "2026-09-30", moomoo: "2026-10-03" }),
    broker_summaries: J({ moomoo: { broker: "moomoo", importedAt: "2026-10-03T12:35:00Z", asOf: null } }),
  };
  const local: SyncData = { // PCは古いmoomooのまま、Coincheckを追加
    ...BASE,
    portfolio_holdings: J([h("楽天(shin)", "VOO", 100), h("moomoo", "TSLA", 10, "moomoo"), h("Coin Check", "BTC", 50, "coincheck")]),
    holdings_as_of: J({ "楽天(shin)": "2026-09-30", "Coin Check": "2026-10-03" }),
    broker_summaries: J({ coincheck: { broker: "coincheck", importedAt: "2026-10-03T12:40:00Z", asOf: "2026-10-03" } }),
  };
  const m = mergeSyncData(BASE, local, server);
  const holdings = JSON.parse(m.portfolio_holdings);
  assert.deepEqual(holdings.map((x: any) => `${x.owner}:${x.name}:${x.amount}`), ["楽天(shin):VOO:100", "moomoo:TSLA:12", "moomoo:NVDA:5", "Coin Check:BTC:50"]);
  assert.deepEqual(JSON.parse(m.holdings_as_of), { "楽天(shin)": "2026-09-30", moomoo: "2026-10-03", "Coin Check": "2026-10-03" });
  assert.deepEqual(Object.keys(JSON.parse(m.broker_summaries)).sort(), ["coincheck", "moomoo"]);
  assert.equal(m.lifecycle_settings, BASE.lifecycle_settings);
});

test("片方だけ変わったキーはその値、両方で同じ口座・同じ項目が変わったらこの端末（更新日は新しい方）", () => {
  const server = { ...BASE, lifecycle_settings: J({ phase: 2 }), holdings_as_of: J({ "楽天(shin)": "2026-10-02" }) };
  const local = { ...BASE, holdings_as_of: J({ "楽天(shin)": "2026-10-01" }), portfolio_holdings: J([h("楽天(shin)", "VOO", 101), h("moomoo", "TSLA", 10, "moomoo")]) };
  const m = mergeSyncData(BASE, local, server);
  assert.deepEqual(JSON.parse(m.lifecycle_settings), { phase: 2 });
  assert.deepEqual(JSON.parse(m.holdings_as_of), { "楽天(shin)": "2026-10-02" });
  assert.equal(JSON.parse(m.portfolio_holdings)[0].amount, 101);
  // 他端末で口座ごと削除された場合は削除が反映される
  const server2 = { ...BASE, portfolio_holdings: J([h("楽天(shin)", "VOO", 100)]) };
  assert.deepEqual(JSON.parse(mergeSyncData(BASE, BASE, server2).portfolio_holdings).map((x: any) => x.owner), ["楽天(shin)"]);
});

test("価格履歴は日付単位でマージ、base無し（初回）は更新日・サマリーを合算しこの端末を優先", () => {
  const base = { voo_price_history: J([{ date: "2026-10-01", price: 1 }]) };
  const local = { voo_price_history: J([{ date: "2026-10-01", price: 1 }, { date: "2026-10-03", price: 3 }]) };
  const server = { voo_price_history: J([{ date: "2026-10-01", price: 1 }, { date: "2026-10-02", price: 2 }]) };
  assert.deepEqual(JSON.parse(mergeSyncData(base, local, server).voo_price_history).map((p: any) => p.date), ["2026-10-01", "2026-10-02", "2026-10-03"]);

  const m = mergeSyncData(null, { holdings_as_of: J({ a: "2026-10-01" }), lifecycle_settings: J({ phase: 1 }) }, { holdings_as_of: J({ b: "2026-10-02" }), lifecycle_settings: J({ phase: 2 }) });
  assert.deepEqual(JSON.parse(m.holdings_as_of), { a: "2026-10-01", b: "2026-10-02" });
  assert.deepEqual(JSON.parse(m.lifecycle_settings), { phase: 1 });
});

test("取引履歴：両端末で別々に取り込んだ取引は取引キーで合算する（重複しない）", () => {
  const th = (keys: string[], updatedAt: string) => JSON.stringify({ version: 1, trades: keys.map((key) => ({ key })), updatedAt });
  const base: SyncData = { trade_history: th(["a"], "2026-10-01") };
  const out = mergeSyncData(base, { trade_history: th(["a", "b"], "2026-10-02") }, { trade_history: th(["a", "c"], "2026-10-03") });
  const merged = JSON.parse(out.trade_history);
  assert.deepEqual(merged.trades.map((t: { key: string }) => t.key), ["a", "b", "c"]);
  assert.equal(merged.updatedAt, "2026-10-03");
});
