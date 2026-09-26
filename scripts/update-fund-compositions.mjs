// 実質保有銘柄ランキング用のファンド構成データ（data/fund-compositions.json）のうち、
// 公開されている日次保有明細CSVから取得できる指数を最新化する。
//   S&P500      … Direxion SPXL（S&P500 3倍）の株式保有分
//   Nasdaq100   … ProShares TQQQ（Nasdaq100 3倍）の株式保有分
//   SOXL        … Direxion SOXL（ICE半導体指数 3倍）の株式保有分
//   TECL        … Direxion TECL（Technology Select Sector指数 3倍）の株式保有分
// レバレッジETFの明細には現金・MMF・スワップも含まれるため、個別株の行だけを取り出して合計100%に正規化する
// （＝連動指数そのものの構成比率）。上位TOP_N銘柄を個別に持ち、残りは「その他」1行にまとめる。
// 実行: node scripts/update-fund-compositions.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const TOP_N = 30;
const FILE = join(import.meta.dirname, "..", "data", "fund-compositions.json");
const UA = { "User-Agent": "Mozilla/5.0" };

function parseCsvLine(line) {
  const out = []; let cur = "", q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === "," && !q) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// Direxion: TradeDate,AccountTicker,StockTicker,SecurityDescription,Shares,Price,MarketValue,Cusip,HoldingsPercent
async function fetchDirexion(ticker) {
  const text = await (await fetch(`https://www.direxion.com/holdings/${ticker}.csv`, { headers: UA })).text();
  const rows = text.split(/\r?\n/).map(parseCsvLine).filter((c) => c[1] === ticker && c[2]);
  const asOf = rows[0]?.[0]?.split(" ")[0];
  return { asOf, stocks: rows.map((c) => ({ ticker: c[2], desc: c[3], value: parseFloat(c[6]) })) };
}

// ProShares: Fund Ticker,Fund Name,Security Ticker,Sedol,Description,Coupon,Maturity,Shares,Exposure Value,Market Value
async function fetchProShares(ticker) {
  const text = await (await fetch(`https://accounts.profunds.com/etfdata/ByFund/${ticker}-psdlyhld.csv`, { headers: UA })).text();
  const lines = text.split(/\r?\n/);
  const asOf = lines.find((l) => l.startsWith("AS OF"))?.replace(/AS OF\s*/, "").replace(/,+$/, "");
  const stocks = lines.map(parseCsvLine).filter((c) => c[0] === ticker && c[2] && parseFloat(c[9]) > 0)
    .map((c) => ({ ticker: c[2], desc: c[4], value: parseFloat(c[9]) }));
  return { asOf, stocks };
}

// 明細に含まれるMMF・国債ファンド等（ティッカー付きでも株式ではないもの）を除外する
const NON_EQUITY = /MONEY MARKET|MNY MKT|MMKT|TREASURY|TRSRY|GOVT CASH|CASH MGMT|CASH MAN|SWAP/i;
function toHoldings(stocks, othersKey, othersLabel, existingNames) {
  // 同一ティッカーが複数行ある場合は合算
  const m = new Map();
  for (const s of stocks.filter((x) => !NON_EQUITY.test(x.desc))) { const t = s.ticker.replace("/", "."); const cur = m.get(t) || { ticker: t, desc: s.desc, value: 0 }; cur.value += s.value; m.set(t, cur); }
  const all = [...m.values()].sort((a, b) => b.value - a.value);
  const sum = all.reduce((s, x) => s + x.value, 0);
  const top = all.slice(0, TOP_N).map((x) => ({ ticker: x.ticker, name: existingNames.get(x.ticker) ?? titleCase(x.desc), weight: round4(x.value / sum) }));
  const rest = all.length - top.length;
  const topSum = top.reduce((s, x) => s + x.weight, 0);
  if (rest > 0) top.push({ ticker: othersKey, name: `${othersLabel}（約${rest}銘柄）`, weight: round4(1 - topSum) });
  return top;
}
const round4 = (v) => Math.round(v * 10000) / 10000;
function titleCase(s) { return String(s).toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\s+/g, " ").trim(); }

const data = JSON.parse(readFileSync(FILE, "utf8"));
// 既存データの日本語表記（例：Tesla（テスラ））を引き継ぐ
const names = new Map();
for (const f of data.funds) for (const h of f.holdings) if (!h.ticker.startsWith("OTHERS")) names.set(h.ticker, h.name);
for (const [t, n] of Object.entries(data.displayNames ?? {})) names.set(t, n);

const targets = [
  { key: "SP500", src: () => fetchDirexion("SPXL"), others: ["OTHERS_SP500", "その他S&P500構成銘柄"] },
  { key: "Nasdaq", src: () => fetchProShares("TQQQ"), others: ["OTHERS_NASDAQ100", "その他Nasdaq100構成銘柄"] },
  { key: "SOXL", src: () => fetchDirexion("SOXL"), others: ["OTHERS_SOXL", "その他ICE半導体指数構成銘柄"] },
  { key: "TECL", src: () => fetchDirexion("TECL"), others: ["OTHERS_TECL", "その他テクノロジー・セレクト・セクター指数構成銘柄"] },
];
const asOfs = [];
for (const t of targets) {
  const fund = data.funds.find((f) => f.key === t.key);
  if (!fund) throw new Error(`fund ${t.key} not found in JSON`);
  const { asOf, stocks } = await t.src();
  if (stocks.length < 20) throw new Error(`${t.key}: too few stock rows (${stocks.length})`);
  fund.holdings = toHoldings(stocks, t.others[0], t.others[1], names);
  asOfs.push(`${t.key}:${asOf}`);
  console.log(t.key, asOf, stocks.length, "stocks; top:", fund.holdings.slice(0, 5).map((h) => `${h.ticker} ${(h.weight * 100).toFixed(2)}%`).join(", "));
}
data.autoUpdated = asOfs.join(" / ");
writeFileSync(FILE, JSON.stringify(data, null, 2) + "\n");
console.log("updated", FILE);
