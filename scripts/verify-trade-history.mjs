// 楽天証券の取引履歴CSVの取り込み・実現損益ランキングを、実ファイルで確認する（ファイルは個人データのためリポジトリには置かない）。
// 実行: node scripts/verify-trade-history.mjs "C:/…/tradehistory(JP)_*.csv" "C:/…/tradehistory(US)_*.csv" "C:/…/tradehistory(INVST)_*.csv"
import { readFileSync } from "node:fs";
import { decodeCp932, parseTradeCsv, mergeTrades, computeRealizedEvents, aggregateRanking, splitRanking, TRADE_KIND_LABEL } from "../lib/tradeHistory.ts";

const files = process.argv.slice(2);
if (!files.length) { console.error("使い方: node scripts/verify-trade-history.mjs <CSV>..."); process.exit(2); }
let trades = [];
for (const f of files) {
  const res = parseTradeCsv(decodeCp932(readFileSync(f)));
  if (res.error) { console.error(f, res.error); process.exit(1); }
  const m = mergeTrades(trades, res.trades);
  trades = m.trades;
  const byAction = {};
  for (const t of res.trades) byAction[t.action] = (byAction[t.action] ?? 0) + 1;
  console.log(`${TRADE_KIND_LABEL[res.kind]}: ${res.trades.length}行 → 新規${m.added}件・重複${m.skipped}件・判別不能${res.unknownRows}行 ${JSON.stringify(byAction)}`);
  const again = mergeTrades(trades, parseTradeCsv(decodeCp932(readFileSync(f))).trades);
  console.log(`  同じファイルを再取り込み → 新規${again.added}件・重複${again.skipped}件`);
}
const events = computeRealizedEvents(trades);
const yen = (v) => `${v < 0 ? "-" : ""}¥${Math.abs(Math.round(v)).toLocaleString()}`;
const show = (title, f) => {
  const rows = aggregateRanking(events, trades, f);
  const { top, bottom } = splitRanking(rows, 10);
  const total = rows.reduce((s, r) => s + r.pnl, 0);
  console.log(`\n■ ${title}：合計 ${yen(total)}（${rows.length}銘柄・利益${rows.filter((r) => r.pnl > 0).length}・損失${rows.filter((r) => r.pnl < 0).length}・取得価額不明を含む${rows.filter((r) => r.unknownBasis).length}）`);
  console.log("  上位:", top.map((r) => `${r.symbol} ${r.name.slice(0, 14)}(${TRADE_KIND_LABEL[r.kind]}) ${yen(r.pnl)} [${r.tradeCount}件]${r.unknownBasis ? "※" : ""}`).join(" / "));
  console.log("  下位:", bottom.map((r) => `${r.symbol} ${r.name.slice(0, 14)}(${TRADE_KIND_LABEL[r.kind]}) ${yen(r.pnl)} [${r.tradeCount}件]${r.unknownBasis ? "※" : ""}`).join(" / "));
};
show("全期間・全て・全て", { period: { type: "all" }, kind: "all", tradeType: "all" });
for (const k of ["JP", "US", "INVST"]) show(`全期間・${TRADE_KIND_LABEL[k]}`, { period: { type: "all" }, kind: k, tradeType: "all" });
show("全期間・全て・信用", { period: { type: "all" }, kind: "all", tradeType: "margin" });
show("2025年・全て", { period: { type: "year", value: "2025" }, kind: "all", tradeType: "all" });
show("2026-09・全て", { period: { type: "month", value: "2026-09" }, kind: "all", tradeType: "all" });
const unknown = events.filter((e) => e.unknownBasis);
console.log(`\n取得価額不明を含む売却: ${unknown.length}件`, unknown.slice(0, 15).map((e) => `${e.date} ${e.symbol} ${yen(e.pnl)}`).join(" / "));
