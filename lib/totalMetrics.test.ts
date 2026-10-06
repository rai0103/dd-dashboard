// 実行: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTotalMetricsSheet, formatPct, toIsoDate, type SheetRows } from "./totalMetrics.ts";

// 実ファイル（TOTAL指標シート）と同じ並び・ラベルの架空データ。値は検算しやすい小さな数。
function sampleRows(): SheetRows {
  const rows: SheetRows = [];
  rows[0] = ["日付", 43465, 43830, 46295, null];
  rows[1] = ["経過年数（日数÷365.25）", 0.19, 1.19, 7.94];
  rows[2] = ["総資産（V）", 100, 200, 300];
  rows[3] = ["累計純入金＝元本（K）", 100, 150, 160];
  rows[5] = ["前回の総資産", 0, 100, 200]; // 「総資産」で始まらないので時系列の総資産と取り違えない
  rows[8] = ["TWR指数（開始=1.0）", 1, 1.1, 2];
  rows[9] = ["累積リターン（TWR）", 0, 0.1, 1];
  rows[10] = ["年率リターン（TWR・時間加重）", 0, 0.08, 0.2154];
  rows[13] = ["累計損益（V−K）", 0, 50, 140];
  rows[14] = ["累積リターン（修正ディーツ）", 0, 0.11, 1.1];
  rows[15] = ["年率リターン（XIRR・金額加重）", -1e-16, 0.1, 0.2619];
  rows[23] = ["（参考）単純損益率＝損益÷元本", 0, 0.33, 0.875];
  rows[25] = ["【最新時点サマリー】"];
  rows[26] = ["最新日", 46295];
  rows[27] = ["運用期間（年）", 7.93976728268309];
  rows[28] = ["総資産", 102318610];
  rows[29] = ["累計純入金（元本）", 31484996.8141];
  rows[30] = ["累計損益（総資産−元本）", 70833613.1859];
  rows[31] = ["累積リターン（TWR）", 3.70624681067655];
  rows[32] = ["年率リターン（TWR・時間加重）★運用成績そのもの", 0.215408358138497];
  rows[33] = ["年率リターン（XIRR・金額加重）★お金の実際の増え方", 0.261889162734948];
  rows[34] = ["年率リターン（修正ディーツ・参考）", 0.21840338658104];
  rows[35] = ["（参考）単純損益率＝損益÷元本", 2.2497576736034];
  rows[36] = ["（修正前の旧式・2026/9/30時点・固定値）57行 利回（年）", 0.2333016364];
  rows[40] = ["【暦年別リターン（TWR）】"];
  rows[41] = ["年", "年末総資産", "年間純入金", "年間損益", "年間リターン（TWR）", "備考", "（計算用）末尾列No."];
  rows[42] = [2018, 675581, 675581, 0, 0, "2018年は2018/10/22〜12/31", 1];
  rows[43] = [2022, 19239046, 4026336.2524, -6959274.2524, -0.281245056116826, null, 35];
  rows[44] = [2026, 102318610, -521159.4771, 8536791.4771, 0.0903633723281101, "2026年は最新日までのYTD", 75];
  rows[47] = ["【Sheet1 53〜59行との対応】…"];
  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
  return rows;
}

test("最新時点サマリーをラベルの前方一致で読む（★などの末尾は無視、旧式の行は読まない）", () => {
  const { metrics, errors } = parseTotalMetricsSheet(sampleRows());
  assert.deepEqual(errors, []);
  assert.deepEqual(metrics.summary, {
    latestDate: "2026-09-30", periodYears: 7.93976728268309, totalAssets: 102318610, principal: 31484996.8141, totalPnl: 70833613.1859,
    cumulativeTwr: 3.70624681067655, annualTwr: 0.215408358138497, annualXirr: 0.261889162734948, annualModifiedDietz: 0.21840338658104, simpleReturn: 2.2497576736034,
  });
});

test("時系列は日付が空になる直前の列まで、各ラベルはサマリーではなく時系列セクションから読む", () => {
  const { metrics } = parseTotalMetricsSheet(sampleRows());
  assert.equal(metrics.series.length, 3);
  assert.deepEqual(metrics.series.map((p) => p.date), ["2018-12-31", "2019-12-31", "2026-09-30"]);
  assert.deepEqual(metrics.series[2], { date: "2026-09-30", totalAssets: 300, principal: 160, twrIndex: 2, cumulativeTwr: 1, annualTwr: 0.2154, annualXirr: 0.2619, totalPnl: 140 });
});

test("暦年別リターン：見出し「年」の直下からA列が年の行まで、G列は無視", () => {
  const { metrics } = parseTotalMetricsSheet(sampleRows());
  assert.deepEqual(metrics.calendarYears.map((y) => [y.year, y.twr, y.pnl, y.note]), [
    [2018, 0, 0, "2018年は2018/10/22〜12/31"],
    [2022, -0.281245056116826, -6959274.2524, null],
    [2026, 0.0903633723281101, 8536791.4771, "2026年は最新日までのYTD"],
  ]);
});

test("ラベルが無い場合は、どのラベルが無いかをエラーで返す（握りつぶさない）", () => {
  const rows = sampleRows();
  rows[33] = ["（XIRRの行を削除）"];
  rows[13] = ["（累計損益の行を削除）"];
  const { metrics, errors } = parseTotalMetricsSheet(rows);
  assert.equal(metrics.summary.annualXirr, null);
  assert.ok(errors.some((e) => e.includes("最新時点サマリー") && e.includes("年率リターン（XIRR")), errors.join("\n"));
  assert.ok(errors.some((e) => e.includes("時系列") && e.includes("累計損益")), errors.join("\n"));
});

test("参考指標（修正ディーツ・単純損益率）は任意：無くてもエラーにしない", () => {
  const rows = sampleRows();
  rows[34] = []; rows[35] = [];
  const { metrics, errors } = parseTotalMetricsSheet(rows);
  assert.deepEqual(errors, []);
  assert.equal(metrics.summary.annualModifiedDietz, null);
  assert.equal(metrics.summary.simpleReturn, null);
});

test("見出し・日付行が無いシートはセクションごとにエラー", () => {
  const { errors } = parseTotalMetricsSheet([["関係ないシート"], [1, 2, 3]]);
  assert.equal(errors.length, 3);
});

test("空・エラー値・NaNはnull、%整形はNaN/空を「—」にする", () => {
  const rows = sampleRows();
  rows[32] = ["年率リターン（TWR・時間加重）★", "#N/A"];
  rows[31] = ["累積リターン（TWR）", ""];
  const { metrics } = parseTotalMetricsSheet(rows);
  assert.equal(metrics.summary.annualTwr, null);
  assert.equal(metrics.summary.cumulativeTwr, null);
  assert.equal(formatPct(null), "—");
  assert.equal(formatPct(NaN), "—");
  assert.equal(formatPct(0.215408358138497, 2), "21.54%");
  assert.equal(formatPct(3.70624681067655, 1, true), "+370.6%");
  assert.equal(formatPct(-0.281245056116826, 1, true), "-28.1%");
});

test("日付：Excelシリアル値・Date・文字列", () => {
  assert.equal(toIsoDate(46295), "2026-09-30");
  assert.equal(toIsoDate("2026/9/30"), "2026-09-30");
  assert.equal(toIsoDate(new Date(2026, 8, 30)), "2026-09-30");
  assert.equal(toIsoDate(null), null);
});
