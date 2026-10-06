// 加速度センサー（lib/accelSensor.ts）を、ダッシュボードの「データ出力」CSV（Date,SP500,VOO,QQQ[,GOLD]）で確認する。
// 実行: node scripts/verify-accel-sensor.mjs "C:/…/sp500_voo_qqq_trackrecord_20261005.csv" [列名=QQQ]
import { readFileSync } from "node:fs";
import { computeAccelSensor } from "../lib/accelSensor.ts";

const [file, column = "QQQ"] = process.argv.slice(2);
if (!file) { console.error("使い方: node scripts/verify-accel-sensor.mjs <CSV> [列名]"); process.exit(2); }
const lines = readFileSync(file, "utf8").replace(/^\uFEFF/, "").trim().split(/\r?\n/);
const header = lines[0].split(",").map((s) => s.trim());
const col = header.indexOf(column);
if (col === -1) { console.error(`列「${column}」がありません：${header.join(",")}`); process.exit(1); }
const points = lines.slice(1).map((l) => { const c = l.split(","); return { date: c[0].trim().replace(/\//g, "-"), close: c[col] === undefined || c[col].trim() === "" ? null : Number(c[col]) }; });
const { series, extracted, stats, state } = computeAccelSensor(points);
const pct = (v) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
const ci = (r) => (r.ci ? `[${pct(r.ci[0])}–${pct(r.ci[1])}]` : "");
console.log(`${column}: ${series.length}行（${stats.periodStart}〜${stats.periodEnd}）`);
console.log(`DD−3%以上のエピソード（終了済み）: ${stats.episodeCount}件、うちDD−5%到達: ${stats.judgedCount}件、進行中: ${extracted.current ? extracted.current.startDate + "開始" : "なし"}`);
for (const g of [stats.overall, ...stats.buckets]) {
  console.log(`  ${g.label.padEnd(10)} n=${String(g.n).padStart(3)}${g.lowSample ? "（標本少）" : ""}  ` + g.rates.map((r) => `${Math.round(r.threshold * 100)}%以上 ${pct(r.p)} ${ci(r)}`).join("  "));
}
console.log(`acc 中央値 ${stats.accMedian}営業日・最大 ${stats.accMax}営業日・acc=0（同日到達）${extracted.episodes.filter((e) => e.acc === 0).length}件`);
for (const prefix of ["2020-02", "2025-02"]) {
  for (const e of extracted.episodes.filter((x) => x.peakDate.startsWith(prefix) || x.startDate.startsWith(prefix))) {
    console.log(`  例 高値${e.peakDate} 開始${e.startDate} maxDD ${pct(e.maxDD)} acc ${e.acc ?? "—"} 終了${e.endDate}（${e.endReason === "newHigh" ? "高値更新" : "半値戻し"}）`);
  }
}
console.log(`現在: ${state.status} DD ${pct(state.currentDD)}（基準高値 ${state.peak} ${state.peakDate}）`);
