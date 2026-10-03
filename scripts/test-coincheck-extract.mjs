// Coincheckスクショ取り込みの結合テスト：サンプル（worker/test/coincheck_sample.html）をスマホ解像度で画像化し、
// デプロイ済みWorkerの /api/extract-holdings で読み取って、合計評価額・4通貨（評価額・保有数量）・日本円残高が期待どおりか、
// アプリと同じロジック（lib/brokerImport.ts）で暗号資産＝Eクラスとして登録でき、合計評価額と一致するかを検証する。
// 実行: node scripts/test-coincheck-extract.mjs [画像ファイル...]（画像を渡すと実画面を読み取って結果を表示するだけ）
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = join(import.meta.dirname, "..");
const WORKER = process.env.WORKER_URL || "https://stock-prices.shinichiogasawara0103.workers.dev";
const TOKEN = process.env.NEXT_PUBLIC_SYNC_TOKEN || readEnvLocal("NEXT_PUBLIC_SYNC_TOKEN");
function readEnvLocal(key) {
  const f = join(ROOT, ".env.local");
  if (!existsSync(f)) return "";
  return readFileSync(f, "utf8").split(/\r?\n/).find((l) => l.startsWith(`${key}=`))?.slice(key.length + 1).trim() ?? "";
}

// 通貨 → [評価額（円）, 保有数量]
const EXPECTED = { BTC: [512380, 0.03152], ETH: [318560, 0.8421], XRP: [118750, 1250], SOL: [61250, 2.5] };
const TOTAL = 1063280, JPY_CASH = 52340;

const imgArgs = process.argv.slice(2);
let images;
if (imgArgs.length) {
  images = imgArgs.map((f) => ({ mediaType: /\.jpe?g$/i.test(f) ? "image/jpeg" : "image/png", data: readFileSync(f).toString("base64") }));
} else {
  const { chromium } = await import(pathToFileURL(join(ROOT, "node_modules", "playwright-core", "index.mjs")).href);
  const browser = await chromium.launch({ executablePath: process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe" });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
  await page.goto(pathToFileURL(join(ROOT, "worker", "test", "coincheck_sample.html")).href);
  const buf = await page.screenshot({ fullPage: true, type: "png" });
  writeFileSync(join(ROOT, "worker", "test", "coincheck_sample.png"), buf);
  await browser.close();
  images = [{ mediaType: "image/png", data: buf.toString("base64") }];
}

const t0 = Date.now();
const res = await fetch(`${WORKER}/api/extract-holdings`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Sync-Token": TOKEN },
  body: JSON.stringify({ broker: "coincheck", images }),
});
const j = await res.json();
if (!res.ok) { console.error("HTTP", res.status, j); process.exit(1); }
const ex = j.extraction;
console.log(`model=${j.model} stop=${j.stopReason} ${((Date.now() - t0) / 1000).toFixed(1)}s tokens in=${j.usage?.input_tokens} out=${j.usage?.output_tokens}`);
console.log("合計評価額:", ex.account_total, ex.account_total_currency, "| 現金:", JSON.stringify(ex.cash), "| notes:", ex.notes);

const lib = await import(pathToFileURL(join(ROOT, "lib", "brokerImport.ts")).href);
const cc = lib.brokerByKey("coincheck");
const rows = lib.extractionToPreviewRows(ex, cc);
console.table(rows.map((r) => ({ 通貨: r.code, 名称: r.name, 数量: r.quantity, 評価額: r.marketValue, レート: r.currentPrice, 分類: r.category, クラス: r.rank })));
const rec = lib.reconcileWithAccountTotal(rows, null, lib.reconciliationTarget(ex));
console.log(`合計評価額 ¥${rec?.accountTotalJpy?.toLocaleString()} / 読み取った合計 ¥${rec?.computedJpy?.toLocaleString()} / 差 ¥${rec?.diffJpy}`);
const { holdings, errors } = lib.previewRowsToHoldings(rows, cc, null, () => "x");
if (imgArgs.length) process.exit(0);

let failed = 0;
const ng = (...a) => { failed++; console.error("NG", ...a); };
for (const [code, [value, qty]] of Object.entries(EXPECTED)) {
  const r = rows.find((x) => x.code === code);
  if (!r) { ng("見つからない:", code); continue; }
  if (r.marketValue !== value || r.quantity !== qty || r.valueCurrency !== "JPY") ng(code, r.marketValue, r.quantity, r.valueCurrency);
  if (r.category !== "暗号資産" || r.rank !== "E") ng(code, "分類", r.category, r.rank);
}
if (rows.filter((r) => r.category === "暗号資産").length !== 4) ng("暗号資産の行数（保有0のETCは除く）", rows.length);
const cash = rows.find((r) => r.category === "現金");
if (!cash || cash.marketValue !== JPY_CASH) ng("日本円残高", cash);
if (ex.account_total !== TOTAL) ng("合計評価額", ex.account_total);
if (!rec || rec.diffJpy !== 0) ng("合計評価額との差", rec?.diffJpy);
if (errors.length) ng("登録エラー", errors);
if (holdings.reduce((s, h) => s + h.amount, 0) !== TOTAL) ng("登録合計");
console.log(failed ? `FAILED (${failed})` : "OK: 4通貨（Eクラス）・日本円・合計評価額（1,063,280円）がすべて一致");
process.exit(failed ? 1 : 0);
