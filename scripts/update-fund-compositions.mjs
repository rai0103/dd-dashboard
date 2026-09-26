// 実質保有銘柄ランキング用のファンド構成データ（data/fund-compositions.json）のうち、
// 公開データから自動取得できるものを最新化する。
//   【全銘柄の保有明細 → 合計100%に正規化し、上位TOP_N＋その他】
//   S&P500      … Direxion SPXL（S&P500 3倍）の株式保有分
//   Nasdaq100   … ProShares TQQQ（Nasdaq100 3倍）の株式保有分
//   SOXL        … Direxion SOXL（ICE半導体指数 3倍）の株式保有分
//   TECL        … Direxion TECL（Technology Select Sector指数 3倍）の株式保有分
//   レバレッジETFの明細には現金・MMF・スワップも含まれるため、個別株の行だけを取り出して正規化する（＝連動指数そのものの構成比率）。
//   【公表されている上位銘柄の構成比 → そのまま使い、残りを「その他」1行に】
//   HDV（2013も同じ）… stockanalysis.com の上位25銘柄
//   ITA              … stockanalysis.com の上位25銘柄
//   上場日経高配当50（399A）… みんかぶ（PCF上位20銘柄）
//   JPXプライム150（2017）   … みんかぶ（PCF上位20銘柄）
// SMTモメンタム（日本・米国・欧州）・Zテック20は月次レポートの上位10銘柄を手作業で登録している（このスクリプトの対象外）。
// 実行: node scripts/update-fund-compositions.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const TOP_N = 30;
const FILE = join(import.meta.dirname, "..", "data", "fund-compositions.json");
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36", Accept: "text/html,*/*" };

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
async function getText(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.text();
}

/* ---------- 全銘柄の保有明細（金額ベース） ---------- */

// Direxion: TradeDate,AccountTicker,StockTicker,SecurityDescription,Shares,Price,MarketValue,Cusip,HoldingsPercent
async function fetchDirexion(ticker) {
  const text = await getText(`https://www.direxion.com/holdings/${ticker}.csv`);
  const rows = text.split(/\r?\n/).map(parseCsvLine).filter((c) => c[1] === ticker && c[2]);
  const asOf = rows[0]?.[0]?.split(" ")[0];
  return { asOf, stocks: rows.map((c) => ({ ticker: c[2], desc: c[3], value: parseFloat(c[6]) })) };
}

// ProShares: Fund Ticker,Fund Name,Security Ticker,Sedol,Description,Coupon,Maturity,Shares,Exposure Value,Market Value
async function fetchProShares(ticker) {
  const text = await getText(`https://accounts.profunds.com/etfdata/ByFund/${ticker}-psdlyhld.csv`);
  const lines = text.split(/\r?\n/);
  const asOf = lines.find((l) => l.startsWith("AS OF"))?.replace(/AS OF\s*/, "").replace(/,+$/, "");
  const stocks = lines.map(parseCsvLine).filter((c) => c[0] === ticker && c[2] && parseFloat(c[9]) > 0)
    .map((c) => ({ ticker: c[2], desc: c[4], value: parseFloat(c[9]) }));
  return { asOf, stocks };
}

// 明細に含まれるMMF・国債ファンド等（ティッカー付きでも株式ではないもの）を除外する
const NON_EQUITY = /MONEY MARKET|MNY MKT|MMKT|TREASURY|TRSRY|GOVT CASH|CASH MGMT|CASH MAN|SWAP/i;
function fullToHoldings(stocks, othersKey, othersLabel, names) {
  // 同一ティッカーが複数行ある場合は合算
  const m = new Map();
  for (const s of stocks.filter((x) => !NON_EQUITY.test(x.desc))) {
    const t = s.ticker.replace("/", ".");
    const cur = m.get(t) || { ticker: t, desc: s.desc, value: 0 };
    cur.value += s.value; m.set(t, cur);
  }
  const all = [...m.values()].sort((a, b) => b.value - a.value);
  const sum = all.reduce((s, x) => s + x.value, 0);
  const top = all.slice(0, TOP_N).map((x) => ({ ticker: x.ticker, name: names.get(x.ticker) ?? titleCase(x.desc), weight: round4(x.value / sum) }));
  const rest = all.length - top.length;
  const topSum = top.reduce((s, x) => s + x.weight, 0);
  if (rest > 0) top.push({ ticker: othersKey, name: `${othersLabel}（約${rest}銘柄）`, weight: round4(1 - topSum) });
  return top;
}

/* ---------- 上位銘柄の構成比（％ベース） ---------- */

// stockanalysis.com のETF保有銘柄ページ。ページ内の埋め込みデータ {no:1,n:"社名",s:"$XOM",as:"9.10%"} を読む。
async function fetchStockAnalysis(etf) {
  const html = await getText(`https://stockanalysis.com/etf/${etf.toLowerCase()}/holdings/`);
  const rows = [...html.matchAll(/\{no:\d+,n:"([^"]*)",s:"([^"]*)",as:"([0-9.]+)%"/g)]
    .map((m) => ({ ticker: m[2].replace(/^\$/, "").replace(/^[a-z]+\//, "").toUpperCase(), desc: m[1], pct: parseFloat(m[3]) }));
  const asOf = html.match(/As of ([A-Z][a-z]{2} \d{1,2}, \d{4})/)?.[1];
  return { asOf, rows };
}

// みんかぶ（国内ETF）の組入銘柄ページ。管理会社公表PCFの上位銘柄（コード・銘柄名・構成比）の表を読む。
async function fetchMinkabuEtf(code) {
  const html = await getText(`https://minkabu.jp/stock/${code}/fund_selection`);
  const rows = [...html.matchAll(/<td class="vamd tac wsnw">([0-9][0-9A-Z]{3})<\/td>[\s\S]*?<a href="https:\/\/minkabu\.jp\/stock\/[0-9A-Z]+">([^<]+)<\/a>[\s\S]*?<td class="vamd tac wsnw">([0-9.]+)%<\/td>/g)]
    .map((m) => ({ ticker: `${m[1]}.T`, desc: m[2], pct: parseFloat(m[3]) }));
  const asOf = html.match(/(\d{4}\/\d{2}\/\d{2}) 現在/)?.[1];
  return { asOf, rows };
}

function partialToHoldings(rows, othersKey, othersLabel, names) {
  const top = rows.map((r) => ({ ticker: r.ticker, name: names.get(r.ticker) ?? r.desc, weight: round4(r.pct / 100) }));
  const topSum = top.reduce((s, x) => s + x.weight, 0);
  if (topSum < 0.9999) top.push({ ticker: othersKey, name: `${othersLabel}（上位${rows.length}銘柄以外）`, weight: round4(1 - topSum) });
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
  { key: "SP500", kind: "full", src: () => fetchDirexion("SPXL"), others: ["OTHERS_SP500", "その他S&P500構成銘柄"] },
  { key: "Nasdaq", kind: "full", src: () => fetchProShares("TQQQ"), others: ["OTHERS_NASDAQ100", "その他Nasdaq100構成銘柄"] },
  { key: "SOXL", kind: "full", src: () => fetchDirexion("SOXL"), others: ["OTHERS_SOXL", "その他ICE半導体指数構成銘柄"] },
  { key: "TECL", kind: "full", src: () => fetchDirexion("TECL"), others: ["OTHERS_TECL", "その他テクノロジー・セレクト・セクター指数構成銘柄"] },
  { key: "HDV", kind: "partial", src: () => fetchStockAnalysis("HDV"), others: ["OTHERS_HDV", "その他HDV構成銘柄"] },
  { key: "ITA", kind: "partial", src: () => fetchStockAnalysis("ITA"), others: ["OTHERS_ITA", "その他ITA構成銘柄"] },
  { key: "NikkeiHighDiv50", kind: "partial", src: () => fetchMinkabuEtf("399A"), others: ["OTHERS_NHD50", "その他日経平均高配当株50構成銘柄"] },
  { key: "JPXPrime150", kind: "partial", src: () => fetchMinkabuEtf("2017"), others: ["OTHERS_JPXP150", "その他JPXプライム150構成銘柄"] },
];
const asOfs = [];
for (const t of targets) {
  const fund = data.funds.find((f) => f.key === t.key);
  if (!fund) throw new Error(`fund ${t.key} not found in JSON`);
  const res = await t.src();
  if (t.kind === "full") {
    if (res.stocks.length < 20) throw new Error(`${t.key}: too few stock rows (${res.stocks.length})`);
    fund.holdings = fullToHoldings(res.stocks, t.others[0], t.others[1], names);
  } else {
    if (res.rows.length < 10) throw new Error(`${t.key}: too few rows (${res.rows.length})`);
    fund.holdings = partialToHoldings(res.rows, t.others[0], t.others[1], names);
  }
  asOfs.push(`${t.key}:${res.asOf}`);
  console.log(t.key, res.asOf, "top:", fund.holdings.slice(0, 5).map((h) => `${h.ticker} ${(h.weight * 100).toFixed(2)}%`).join(", "));
}
data.autoUpdated = asOfs.join(" / ");
writeFileSync(FILE, JSON.stringify(data, null, 2) + "\n");
console.log("updated", FILE);
