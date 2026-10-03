// 大和コネクト証券スクショ取り込みの結合テスト：サンプル（worker/test/daiwa_sample.html）の「株式」「投資信託」「資産を見る」の
// 3画面をスマホ解像度で別々に画像化し、デプロイ済みWorkerの /api/extract-holdings に1回でまとめて送って、
// 7銘柄が正式名称に補完され、分類の初期値が入り、合計が「資産を見る」の 1,178,329円 と一致するか検証する。
// 実行: node scripts/test-daiwa-extract.mjs
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

// 正式名称 → [評価額, 数量, カテゴリー, クラス]
const EXPECTED = {
  "純金上場信託（現物国内保管型）": [178380, 9, "ゴールド", "A"],
  "NEXT FUNDS 日経平均レバレッジ・インデックス連動型上場投信": [148260, 2, "レバレッジETF（日）", "E"],
  "eMAXIS Slim 国内株式(TOPIX)": [179056, null, "日本（N225・Topix）", "E"],
  "eMAXIS Slim 米国株式(S&P500)": [193784, null, "SP500", "C"],
  "iFree 日経225インデックス": [165641, null, "日本（N225・Topix）", "E"],
  "iFreeNEXT NASDAQ100インデックス": [50901, null, "Nasdaq", "D"],
  "iFreeレバレッジ FANG+": [262307, null, "テックETF・投信（米）", "D"],
};
const ASSET_TOTAL = 1178329;

const { chromium } = await import(pathToFileURL(join(ROOT, "node_modules", "playwright-core", "index.mjs")).href);
const browser = await chromium.launch({ executablePath: process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe" });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
await page.goto(pathToFileURL(join(ROOT, "worker", "test", "daiwa_sample.html")).href);
const images = [];
for (const id of ["stocks", "funds", "assets"]) {
  const buf = await page.locator(`#${id}`).screenshot({ type: "png" });
  writeFileSync(join(ROOT, "worker", "test", `daiwa_sample_${id}.png`), buf);
  images.push({ mediaType: "image/png", data: buf.toString("base64") });
}
await browser.close();

const t0 = Date.now();
const res = await fetch(`${WORKER}/api/extract-holdings`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Sync-Token": TOKEN },
  body: JSON.stringify({ broker: "daiwa", images }),
});
const j = await res.json();
if (!res.ok) { console.error("HTTP", res.status, j); process.exit(1); }
console.log(`model=${j.model} stop=${j.stopReason} ${((Date.now() - t0) / 1000).toFixed(1)}s tokens in=${j.usage?.input_tokens} out=${j.usage?.output_tokens}`);
console.log("account_total:", j.extraction.account_total, j.extraction.account_total_currency, "| section_totals:", JSON.stringify(j.extraction.section_totals), "| notes:", j.extraction.notes);

// アプリと同じロジック（lib/brokerImport.ts）でプレビュー行 → 登録データに変換する
const lib = await import(pathToFileURL(join(ROOT, "lib", "brokerImport.ts")).href);
const daiwa = lib.brokerByKey("daiwa");
const rows = lib.extractionToPreviewRows(j.extraction, daiwa);
console.table(rows.map((r) => ({ section: r.section, raw: r.nameRaw ?? "", name: r.name, code: r.code, qty: r.quantity, value: r.marketValue, ccy: r.valueCurrency, category: r.category, rank: r.rank })));

let failed = 0;
const ng = (...a) => { failed++; console.error("NG", ...a); };
for (const [name, [value, qty, category, rank]] of Object.entries(EXPECTED)) {
  const r = rows.find((x) => x.name === name);
  if (!r) { ng("見つからない:", name); continue; }
  if (r.marketValue !== value || r.valueCurrency !== "JPY") ng(name, "評価額", r.marketValue, r.valueCurrency);
  if (qty != null && r.quantity !== qty) ng(name, "数量", r.quantity);
  if (r.category !== category || r.rank !== rank) ng(name, "分類", r.category, r.rank);
}
if (rows.length !== 7) ng("行数", rows.length);
if (j.extraction.account_total !== ASSET_TOTAL) ng("資産を見るの合計", j.extraction.account_total);
const rec = lib.reconcileWithAccountTotal(rows, null, lib.reconciliationTarget(j.extraction));
console.log(`資産を見る ¥${rec?.accountTotalJpy?.toLocaleString()} / 銘柄の合計 ¥${rec?.computedJpy?.toLocaleString()} / 差 ¥${rec?.diffJpy}`);
for (const c of lib.sectionChecks(rows, j.extraction)) console.log(`  ${c.section}: 画面 ¥${c.screenTotal.toLocaleString()} / 銘柄 ¥${c.rowsTotal.toLocaleString()} / 差 ¥${c.diff}`);
if (!rec || rec.diffJpy !== 0) ng("資産を見るとの差", rec?.diffJpy);
const { holdings, errors } = lib.previewRowsToHoldings(rows, daiwa, null, () => "x");
if (errors.length) ng("登録エラー", errors);
const saved = holdings.reduce((s, h) => s + h.amount, 0);
console.log(`登録する保有資産 ${holdings.length}件・合計 ¥${saved.toLocaleString()}`);
if (saved !== ASSET_TOTAL) ng("登録合計", saved);
console.log(failed ? `FAILED (${failed})` : "OK: 7銘柄・正式名称・分類の初期値・資産を見るの合計（1,178,329円）がすべて一致");
process.exit(failed ? 1 : 0);
