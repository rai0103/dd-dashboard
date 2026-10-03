// iDeCo（SMBC・DCナビ）スクショ取り込みの結合テスト：サンプル（worker/test/ideco_sample.html）の「資産サマリー」「商品別内訳」の
// 2画面をスマホ解像度で画像化し、デプロイ済みWorkerの /api/extract-holdings に1回でまとめて送って、
// サマリー（資産評価額・評価損益・運用利回り・リスク・基準日）と6商品（カテゴリー・評価額・取得価額・簿価損益・損益率）が
// 期待どおり読み取れ、アプリと同じロジックで登録・照合できるか検証する。
// 実行: node scripts/test-ideco-extract.mjs [画像ファイル...]（画像を渡すと実画面を読み取って結果を表示するだけ）
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

// 商品名 → [カテゴリー（画面）, 資産評価額, 取得価額, 簿価損益, 損益率]
const EXPECTED = {
  "三井住友・DC日本株式インデックスファンドS": ["国内株式", 412350, 300000, 112350, 37.45],
  "三井住友・DC外国株式インデックスファンドS": ["外国株式", 685920, 450000, 235920, 52.43],
  "eMAXIS Slim 米国株式(S&P500)": ["外国株式", 528400, 400000, 128400, 32.1],
  "三井住友・DC外国債券インデックスファンド": ["外国債券", 156780, 150000, 6780, 4.52],
  "三井住友・DC年金バランス30（債券重点型）": ["バランス", 98410, 100000, -1590, -1.59],
  "三井住友銀行確定拠出年金定期預金（5年）": ["元本確保型", 300000, 300000, 0, 0],
};

const imgArgs = process.argv.slice(2);
let images;
if (imgArgs.length) {
  images = imgArgs.map((f) => ({ mediaType: /\.jpe?g$/i.test(f) ? "image/jpeg" : "image/png", data: readFileSync(f).toString("base64") }));
} else {
  const { chromium } = await import(pathToFileURL(join(ROOT, "node_modules", "playwright-core", "index.mjs")).href);
  const browser = await chromium.launch({ executablePath: process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe" });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
  await page.goto(pathToFileURL(join(ROOT, "worker", "test", "ideco_sample.html")).href);
  images = [];
  for (const id of ["summary", "products"]) {
    const buf = await page.locator(`#${id}`).screenshot({ type: "png" });
    writeFileSync(join(ROOT, "worker", "test", `ideco_sample_${id}.png`), buf);
    images.push({ mediaType: "image/png", data: buf.toString("base64") });
  }
  await browser.close();
}

const t0 = Date.now();
const res = await fetch(`${WORKER}/api/extract-holdings`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Sync-Token": TOKEN },
  body: JSON.stringify({ broker: "ideco", images }),
});
const j = await res.json();
if (!res.ok) { console.error("HTTP", res.status, j); process.exit(1); }
const ex = j.extraction;
console.log(`model=${j.model} stop=${j.stopReason} ${((Date.now() - t0) / 1000).toFixed(1)}s tokens in=${j.usage?.input_tokens} out=${j.usage?.output_tokens}`);
console.log("資産評価額:", ex.account_total, ex.account_total_currency, "| サマリー:", JSON.stringify(ex.summary), "| 基準日:", ex.as_of, "| notes:", ex.notes);

const lib = await import(pathToFileURL(join(ROOT, "lib", "brokerImport.ts")).href);
const ideco = lib.brokerByKey("ideco");
const rows = lib.extractionToPreviewRows(ex, ideco);
console.table(rows.map((r) => ({ カテゴリー: r.section, 商品名: r.name, 評価額: r.marketValue, 取得価額: r.costBasis, 簿価損益: r.unrealizedPl, 損益率: r.unrealizedPlPct, 分類: r.category, クラス: r.rank })));
const rec = lib.reconcileWithAccountTotal(rows, null, lib.reconciliationTarget(ex));
const pc = lib.profitChecks(rows, ex.summary);
console.log(`資産評価額 ¥${rec?.accountTotalJpy?.toLocaleString()} / 商品の合計 ¥${rec?.computedJpy?.toLocaleString()} / 差 ¥${rec?.diffJpy}`);
console.log(`評価損益 ¥${pc.screenPl?.toLocaleString()} / 簿価損益の合計 ¥${pc.rowsPl?.toLocaleString()} / 差 ¥${pc.diff} / 行の不整合: ${pc.mismatchedRows.join("、") || "なし"}`);
const { holdings, errors } = lib.previewRowsToHoldings(rows, ideco, null, () => "x");
const summary = lib.buildBrokerSummary(ideco, ex, holdings, new Date());
console.log("保存する口座サマリー:", JSON.stringify(summary));
if (imgArgs.length) process.exit(0);

let failed = 0;
const ng = (...a) => { failed++; console.error("NG", ...a); };
for (const [name, [section, value, cost, pl, pct]] of Object.entries(EXPECTED)) {
  const r = rows.find((x) => x.name === name);
  if (!r) { ng("見つからない:", name); continue; }
  if (r.section !== section) ng(name, "カテゴリー", r.section);
  if (r.marketValue !== value || r.costBasis !== cost || r.unrealizedPl !== pl || Math.abs((r.unrealizedPlPct ?? NaN) - pct) > 0.001) ng(name, "数値", r.marketValue, r.costBasis, r.unrealizedPl, r.unrealizedPlPct);
}
if (rows.length !== 6) ng("行数", rows.length);
if (ex.account_total !== 2181860) ng("資産評価額", ex.account_total);
if (ex.summary?.unrealized_pl !== 481860 || ex.summary?.return_rate_pct !== 6.82 || !/11\.25/.test(ex.summary?.risk ?? "")) ng("サマリー", ex.summary);
if (ex.as_of !== "2026-10-02") ng("基準日", ex.as_of);
if (!rec || rec.diffJpy !== 0) ng("資産評価額との差", rec?.diffJpy);
if (pc.diff !== 0 || pc.mismatchedRows.length) ng("損益の照合", pc);
if (errors.length) ng("登録エラー", errors);
if (holdings.reduce((s, h) => s + h.amount, 0) !== 2181860) ng("登録合計");
console.log(failed ? `FAILED (${failed})` : "OK: サマリー・6商品・資産評価額（2,181,860円）・評価損益（481,860円）がすべて一致");
process.exit(failed ? 1 : 0);
