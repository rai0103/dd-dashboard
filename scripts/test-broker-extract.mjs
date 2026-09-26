// 証券会社スクショ取り込みの結合テスト：moomoo「口座」画面のサンプル（worker/test/moomoo_sample.html）を
// スマホ解像度で画像化し、デプロイ済みWorkerの /api/extract-holdings（Claude Vision）で読み取って、
// 10銘柄のコード・数量・評価額が期待どおりか検証する。
// 実行: NEXT_PUBLIC_SYNC_TOKEN=... node scripts/test-broker-extract.mjs [画像ファイル（省略時はサンプルを画像化）]
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

const EXPECTED = {
  IONQ: [12, 545.76], META: [3, 2256.9], NVDA: [25, 5614.5], PLTR: [15, 2739.75], RKLB: [40, 2324.8],
  SOFI: [60, 1736.4], SOXL: [20, 1425.0], SPCH: [10, 324.0], SPCX: [6, 892.2], TSLA: [5, 2191.0],
};

async function renderSample() {
  const { chromium } = await import(pathToFileURL(join(ROOT, "node_modules", "playwright-core", "index.mjs")).href);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
  await page.goto(pathToFileURL(join(ROOT, "worker", "test", "moomoo_sample.html")).href);
  const buf = await page.screenshot({ fullPage: true, type: "png" });
  await browser.close();
  return buf;
}

const imgPath = process.argv[2];
const png = imgPath ? readFileSync(imgPath) : await renderSample();
if (!imgPath) writeFileSync(join(ROOT, "worker", "test", "moomoo_sample.png"), png);
const mediaType = imgPath && /\.jpe?g$/i.test(imgPath) ? "image/jpeg" : "image/png";

const t0 = Date.now();
const res = await fetch(`${WORKER}/api/extract-holdings`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Sync-Token": TOKEN },
  body: JSON.stringify({ broker: "moomoo", images: [{ mediaType, data: png.toString("base64") }] }),
});
const j = await res.json();
if (!res.ok) { console.error("HTTP", res.status, j); process.exit(1); }
console.log(`model=${j.model} stop=${j.stopReason} ${((Date.now() - t0) / 1000).toFixed(1)}s tokens in=${j.usage?.input_tokens} out=${j.usage?.output_tokens} (≈${(((j.usage?.input_tokens ?? 0) * 5 + (j.usage?.output_tokens ?? 0) * 25) / 1e6).toFixed(4)})`);
console.table(j.extraction.holdings.map((h) => ({ code: h.code, name: h.name, qty: h.quantity, value: h.market_value, price: h.current_price, cost: h.avg_cost, ccy: h.currency })));
console.log("account_total:", j.extraction.account_total, j.extraction.account_total_currency, "| notes:", j.extraction.notes);

if (imgPath) process.exit(0);
let failed = 0;
const got = new Map(j.extraction.holdings.map((h) => [String(h.code).toUpperCase(), h]));
for (const [code, [qty, value]] of Object.entries(EXPECTED)) {
  const h = got.get(code);
  const ok = h && h.quantity === qty && Math.abs((h.market_value ?? 0) - value) < 0.01 && h.currency === "USD";
  if (!ok) { failed++; console.error("NG", code, h); }
}
if (got.size !== 10) { failed++; console.error("NG: 銘柄数", got.size); }
const cashUsd = (j.extraction.cash ?? []).find((c) => c.currency === "USD")?.amount;
if (Math.abs((cashUsd ?? 0) - 312.45) > 0.001) { failed++; console.error("NG: 現金", j.extraction.cash); }
if (j.extraction.account_total !== 3200619 || j.extraction.account_total_currency !== "JPY") { failed++; console.error("NG: 純資産", j.extraction.account_total, j.extraction.account_total_currency); }

// 純資産（JPY）との照合：アプリと同じロジック（lib/brokerImport.ts）で、市場レート・逆算レートそれぞれの差を確認する
const lib = await import(pathToFileURL(join(ROOT, "lib", "brokerImport.ts")).href);
const moomoo = lib.brokerByKey("moomoo");
const rows = lib.extractionToPreviewRows(j.extraction, moomoo);
const fx = await (await fetch(`${WORKER}/api/fx`)).json();
const atMarket = lib.reconcileWithAccountTotal(rows, fx.rate, j.extraction);
console.log(`市場レート ${fx.rate} で換算: 合計 ¥${Math.round(atMarket.computedJpy).toLocaleString()} / 純資産 ¥${atMarket.accountTotalJpy.toLocaleString()} / 差 ¥${Math.round(atMarket.diffJpy).toLocaleString()}（${atMarket.diffPct.toFixed(3)}%）`);
console.log(`純資産から逆算したレート: ${atMarket.impliedRate.toFixed(4)}（採用可: ${lib.isPlausibleBrokerRate(atMarket.impliedRate, fx.rate)}）`);
const { holdings } = lib.previewRowsToHoldings(rows, moomoo, atMarket.impliedRate, () => "x");
const saved = holdings.reduce((a, h) => a + h.amount, 0);
console.log(`逆算レートで保存する円換算額の合計: ¥${saved.toLocaleString()}（純資産との差 ¥${saved - atMarket.accountTotalJpy}）`);
if (Math.abs(saved - atMarket.accountTotalJpy) > 11) { failed++; console.error("NG: 逆算レートでも純資産と一致しない"); }
console.log(failed ? `FAILED (${failed})` : "OK: 10銘柄・現金・純資産との照合がすべて一致");
process.exit(failed ? 1 : 0);
