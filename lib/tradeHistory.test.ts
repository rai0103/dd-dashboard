// 実行: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTradeCsv, mergeTrades, computeRealizedEvents, aggregateRanking, splitRanking, periodOptions, parseCsv } from "./tradeHistory.ts";

const q = (cols: (string | number)[]) => cols.map((c) => `"${c}"`).join(",");
const JP_HEAD = ["約定日", "受渡日", "銘柄コード", "銘柄名", "市場名称", "口座区分", "取引区分", "売買区分", "信用区分", "弁済期限", "数量［株］", "単価［円］", "手数料［円］", "税金等［円］", "諸費用［円］", "税区分", "受渡金額［円］"];
const jp = (date: string, code: string, tk: string, bk: string, qty: number, amount: string) => q([date, date, code, `銘柄${code}`, "東証", "特定", tk, bk, "-", "-", qty, "0", "0", "0", "0", "-", amount]);
const US_HEAD = ["約定日", "受渡日", "ティッカー", "銘柄名", "口座", "取引区分", "売買区分", "信用区分", "弁済期限", "決済通貨", "数量［株］", "単価［USドル］", "約定代金［USドル］", "為替レート", "手数料［USドル］", "税金［USドル］", "受渡金額［USドル］", "受渡金額［円］"];
const us = (date: string, tk: string, sym: string, tk2: string, bk: string, qty: number, cur: string, fx: string, usd: string, yen: string) => q([date, date, sym, sym, "特定", tk2, bk, "-", "-", cur, qty, "0", "0", fx, "0", "0", usd, yen]);
const IV_HEAD = ["約定日", "受渡日", "ファンド名", "分配金", "口座", "取引", "買付方法", "数量［口］", "単価", "経費", "為替レート", "受付金額[現地通貨]", "受渡金額/(ポイント利用)[円]", "決済通貨"];
const iv = (date: string, fund: string, type: string, qty: number, yen: string) => q([date, date, fund, "再投資型", "特定", type, "", qty, "10,000", "0", "-", "-", yen, "円"]);
const csv = (head: string[], rows: string[]) => [q(head), ...rows].join("\r\n");

test("CSVパーサー：ダブルクォート内のカンマ・エスケープ、空行を除外", () => {
  assert.deepEqual(parseCsv('"a","1,234","x""y"\r\n\r\n"b","2",""\r\n'), [["a", "1,234", 'x"y'], ["b", "2", ""]]);
});

test("見出しから種別を判別し、取引区分・売買区分を分類する（日本株）", () => {
  const r = parseTradeCsv(csv(JP_HEAD, [
    jp("2024/1/5", "1111", "現物", "買付", 100, "100,250"),
    jp("2024/2/5", "1111", "現物", "売付", 100, "120,000"),
    jp("2024/3/1", "2222", "信用新規", "買建", 100, "-"),
    jp("2024/3/8", "2222", "信用返済", "売埋", 100, "22,154"),
    jp("2024/3/9", "3333", "信用返済", "買埋", 100, "-4,982"),
    jp("2024/4/1", "2222", "現引", "", 100, "2,192,761"),
    jp("2024/5/1", "1111", "", "入庫", 20, "-"),
  ]));
  assert.equal(r.kind, "JP");
  assert.equal(r.error, null);
  assert.deepEqual(r.trades.map((t) => [t.action, t.margin, t.amountJpy]), [
    ["buy", false, 100250], ["sell", false, 120000], ["marginOpen", true, null], ["marginClose", true, 22154], ["marginClose", true, -4982], ["delivery", false, 2192761], ["transferIn", false, null],
  ]);
  assert.equal(r.trades[0].date, "2024-01-05");
});

test("米国株：積立（売買区分空欄）は買付、外貨決済はUSドル×為替レートで円換算、信用返済はUSドルの決済損益を円換算", () => {
  const r = parseTradeCsv(csv(US_HEAD, [
    us("2024/1/5", "", "VYM", "積立", "", 3, "ＵＳドル", "130.000", "337.08", "-"),
    us("2024/1/6", "", "SPXL", "現物", "買付", 3, "円", "130.000", "-", "34,941.00"),
    us("2024/2/1", "", "AAPL", "信用返済", "売埋", 56, "ＵＳドル", "144.000", "234.87", "-"),
    us("2024/3/1", "", "GOOGL", "入庫（分割）", "", 76, "-", "-", "-", "-"),
  ]));
  assert.equal(r.kind, "US");
  assert.deepEqual(r.trades.map((t) => [t.action, Math.round((t.amountJpy ?? NaN) * 100) / 100]), [["buy", 43820.4], ["buy", 34941], ["marginClose", 33821.28], ["transferIn", NaN]]);
});

test("投資信託：再投資は買付として扱い、解約は売却", () => {
  const r = parseTradeCsv(csv(IV_HEAD, [iv("2024/1/5", "F", "買付", 10000, "10,000"), iv("2024/2/5", "F", "再投資", 100, "105"), iv("2024/3/5", "F", "解約", 5050, "6,000")]));
  assert.equal(r.kind, "INVST");
  assert.deepEqual(r.trades.map((t) => t.action), ["buy", "buy", "sell"]);
  const [e] = computeRealizedEvents(r.trades);
  // 平均取得単価 = (10,000+105)/10,100口 → 5,050口の原価 = 5,052.5 → 損益 = 6,000 - 5,052.5
  assert.equal(Math.round(e.pnl * 10) / 10, 947.5);
});

test("差分取り込み：同じファイルは0件追加、追加行だけを取り込む。同じ内容の約定が2件あっても両方残す", () => {
  const rows = [jp("2024/1/5", "1111", "現物", "買付", 100, "100,000"), jp("2024/1/5", "1111", "現物", "買付", 100, "100,000")];
  const first = parseTradeCsv(csv(JP_HEAD, rows)).trades;
  assert.equal(first.length, 2);
  assert.notEqual(first[0].key, first[1].key);
  const m1 = mergeTrades([], first);
  assert.deepEqual([m1.added, m1.skipped], [2, 0]);
  const again = mergeTrades(m1.trades, parseTradeCsv(csv(JP_HEAD, rows)).trades);
  assert.deepEqual([again.added, again.skipped], [0, 2]);
  const later = mergeTrades(m1.trades, parseTradeCsv(csv(JP_HEAD, [...rows, jp("2024/2/5", "1111", "現物", "売付", 200, "210,000")])).trades);
  assert.deepEqual([later.added, later.skipped, later.trades.length], [1, 2, 3]);
});

test("移動平均で実現損益：途中の追加買付で平均単価が変わる", () => {
  const { trades } = parseTradeCsv(csv(JP_HEAD, [
    jp("2024/1/5", "1111", "現物", "買付", 100, "100,000"),
    jp("2024/1/6", "1111", "現物", "買付", 100, "200,000"),
    jp("2024/2/1", "1111", "現物", "売付", 100, "180,000"), // 平均1,500円 → 原価150,000 → +30,000
    jp("2024/3/1", "1111", "現物", "買付", 100, "300,000"), // 残100株(150,000)+100株(300,000) → 平均2,250円
    jp("2024/4/1", "1111", "現物", "売付", 200, "400,000"), // 原価450,000 → -50,000
  ]));
  assert.deepEqual(computeRealizedEvents(trades).map((e) => Math.round(e.pnl)), [30000, -50000]);
});

test("入庫・出庫：分割（入庫のみ）・併合（同日の入庫＋出庫）は損益を出さず数量だけ合わせ、取得額の合計は変えない", () => {
  const { trades } = parseTradeCsv(csv(JP_HEAD, [
    jp("2024/1/5", "1111", "現物", "買付", 300, "1,780,370"),
    jp("2024/9/26", "1111", "", "入庫", 300, "-"), // 1:2分割
    jp("2024/11/5", "1111", "現物", "売付", 200, "404,500"),
    jp("2025/1/5", "2222", "現物", "買付", 200, "350,000"),
    jp("2025/2/1", "2222", "", "入庫", 20, "-"), jp("2025/2/1", "2222", "", "出庫", 200, "-"), // 10:1併合
    jp("2025/3/1", "2222", "現物", "売付", 20, "400,000"),
  ]));
  const ev = computeRealizedEvents(trades);
  assert.deepEqual(ev.map((e) => [e.symbol, Math.round(e.pnl), e.unknownBasis]), [["1111", -188957, false], ["2222", 50000, false]]);
});

test("口座間振替（同日の入庫と出庫が同数）は保有に影響しない／保有の無い状態での入庫は取得価額不明として印を付ける", () => {
  const { trades } = parseTradeCsv(csv(US_HEAD, [
    us("2020/1/5", "", "PFE", "現物", "買付", 10, "円", "100", "-", "50,000"),
    us("2020/11/17", "", "PFE", "入庫", "", 10, "-", "-", "-", "-"), us("2020/11/17", "", "PFE", "出庫", "", 10, "-", "-", "-", "-"),
    us("2021/1/5", "", "PFE", "現物", "売付", 10, "円", "100", "-", "60,000"),
    us("2020/11/18", "", "VTRS", "入庫", "", 16, "-", "-", "-", "-"),
    us("2020/12/1", "", "VTRS", "現物", "売付", 16, "円", "100", "-", "28,029"),
  ]));
  const ev = computeRealizedEvents(trades);
  assert.deepEqual(ev.map((e) => [e.symbol, Math.round(e.pnl), e.unknownBasis]), [["VTRS", 28029, true], ["PFE", 10000, false]]);
});

test("ティッカー変更（FB→META）は同一銘柄として取得額を引き継ぐ", () => {
  const { trades } = parseTradeCsv(csv(US_HEAD, [
    us("2022/6/3", "", "FB", "現物", "買付", 20, "円", "130", "-", "492,261"),
    us("2022/6/28", "", "META", "現物", "買付", 10, "円", "130", "-", "233,813"),
    us("2022/7/29", "", "META", "現物", "売付", 30, "円", "130", "-", "644,263"),
  ]));
  const [e] = computeRealizedEvents(trades);
  assert.equal(e.unknownBasis, false);
  assert.equal(Math.round(e.pnl), 644263 - 492261 - 233813);
});

test("集計：期間（年・月）・商品種別・取引種別で絞り込み、上位・下位に分ける", () => {
  const { trades: jpT } = parseTradeCsv(csv(JP_HEAD, [
    jp("2024/1/5", "1111", "現物", "買付", 100, "100,000"), jp("2024/2/5", "1111", "現物", "売付", 100, "150,000"),
    jp("2025/3/1", "2222", "信用新規", "買建", 100, "-"), jp("2025/3/8", "2222", "信用返済", "売埋", 100, "-20,000"),
  ]));
  const { trades: ivT } = parseTradeCsv(csv(IV_HEAD, [iv("2025/1/5", "F", "買付", 10000, "10,000"), iv("2025/3/9", "F", "解約", 10000, "13,000")]));
  const trades = [...jpT, ...ivT];
  const ev = computeRealizedEvents(trades);
  const all = aggregateRanking(ev, trades, { period: { type: "all" }, kind: "all", tradeType: "all" });
  assert.deepEqual(all.map((r) => [r.symbol, r.pnl, r.tradeCount]).sort(), [["1111", 50000, 2], ["2222", -20000, 2], ["F", 3000, 2]]);
  assert.deepEqual(aggregateRanking(ev, trades, { period: { type: "year", value: "2025" }, kind: "all", tradeType: "all" }).map((r) => r.symbol).sort(), ["2222", "F"]);
  assert.deepEqual(aggregateRanking(ev, trades, { period: { type: "month", value: "2024-02" }, kind: "all", tradeType: "all" }).map((r) => r.symbol), ["1111"]);
  assert.deepEqual(aggregateRanking(ev, trades, { period: { type: "all" }, kind: "INVST", tradeType: "all" }).map((r) => r.symbol), ["F"]);
  assert.deepEqual(aggregateRanking(ev, trades, { period: { type: "all" }, kind: "all", tradeType: "margin" }).map((r) => r.symbol), ["2222"]);
  assert.deepEqual(aggregateRanking(ev, trades, { period: { type: "all" }, kind: "all", tradeType: "cash" }).map((r) => r.symbol).sort(), ["1111", "F"]);
  const { top, bottom } = splitRanking(all, 10);
  assert.deepEqual(top.map((r) => r.symbol), ["1111", "F"]);
  assert.deepEqual(bottom.map((r) => r.symbol), ["2222"]);
  assert.deepEqual(periodOptions(ev), { years: ["2025", "2024"], months: ["2025-03", "2024-02"] });
});

test("見出しが楽天の取引履歴でないCSVはエラー", () => {
  assert.ok(parseTradeCsv('"a","b"\r\n"1","2"').error);
});
