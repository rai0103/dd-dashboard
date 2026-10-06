// 投資収支xlsxの「TOTAL指標」シートの読み込みを、実ファイルで検証する（ファイルは個人データのためリポジトリには置かない）。
// 実行: node scripts/verify-total-metrics.mjs "C:/Users/…/20260930_投資収支表_TOTAL修正版.xlsx"
// 期待値は 20260930_投資収支表_TOTAL修正版.xlsx 時点のもの。アップロード画面と同じ parseInvestmentExcel() を通す。
import { readFileSync } from "node:fs";
import { parseInvestmentExcel } from "../lib/investmentPerformance.ts";
import { formatPct } from "../lib/totalMetrics.ts";

const file = process.argv[2];
if (!file) { console.error("使い方: node scripts/verify-total-metrics.mjs <xlsxのパス>"); process.exit(2); }
const buf = readFileSync(file);
const data = await parseInvestmentExcel(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), file);
const tm = data.totalMetrics;
if (!tm) { console.error("TOTAL指標シートが読み込めませんでした（旧形式）。"); process.exit(1); }
const s = tm.summary;
const yen = (v) => (v == null ? "—" : Math.round(v).toLocaleString("ja-JP"));
const years = Object.fromEntries(tm.calendarYears.map((y) => [y.year, formatPct(y.twr, 1, true)]));

const checks = [
  ["最新日", s.latestDate, "2026-09-30"],
  ["運用期間（年）", s.periodYears?.toFixed(2), "7.94"],
  ["総資産", yen(s.totalAssets), "102,318,610"],
  ["元本", yen(s.principal), "31,484,997"],
  ["累計損益", yen(s.totalPnl), "70,833,613"],
  ["累積リターン（TWR）", `${formatPct(s.cumulativeTwr, 1, true)}（${s.cumulativeTwr?.toFixed(4)}）`, "+370.6%（3.7062）"],
  ["年率リターン（TWR）", formatPct(s.annualTwr, 2), "21.54%"],
  ["年率リターン（XIRR）", formatPct(s.annualXirr, 2), "26.19%"],
  ["年率（修正ディーツ）", formatPct(s.annualModifiedDietz, 2), "21.84%"],
  ["暦年2018", years[2018], "0.0%"],
  ["暦年2019", years[2019], "+10.3%"],
  ["暦年2020", years[2020], "+12.7%"],
  ["暦年2021", years[2021], "+26.5%"],
  ["暦年2022", years[2022], "-28.1%"],
  ["暦年2023", years[2023], "+87.9%"],
  ["暦年2024", years[2024], "+59.8%"],
  ["暦年2025", years[2025], "+27.3%"],
  ["暦年2026（YTD）", `${years[2026]}${tm.calendarYears.find((y) => y.year === 2026)?.note?.includes("YTD") ? "(YTD)" : ""}`, "+9.0%(YTD)"],
  ["時系列の列数", String(tm.series.length), "75"],
];
let ng = 0;
for (const [label, actual, expected] of checks) {
  const ok = actual === expected;
  if (!ok) ng++;
  console.log(`${ok ? "OK " : "NG "} ${label}: ${actual}${ok ? "" : `（期待値 ${expected}）`}`);
}
const tmErrors = data.errors.filter((e) => e.startsWith("TOTAL指標"));
console.log(`TOTAL指標の読み込みエラー: ${tmErrors.length ? tmErrors.join(" / ") : "なし"}`);
console.log(`時系列の範囲: ${tm.series[0]?.date} 〜 ${tm.series.at(-1)?.date}`);
console.log(ng ? `\n${ng}件が期待値と不一致` : "\nすべて期待値と一致");
process.exit(ng || tmErrors.length ? 1 : 0);
