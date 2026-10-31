// 実行: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTotalMetricsSheet, formatPct, toIsoDate, calendarYearPrincipalChanges, calendarYearPriceTwr, calendarYearTwrMdd, type SheetRows, type TotalMetricsPoint } from "./totalMetrics.ts";

// 実ファイル（TOTAL指標シート）と同じ並び・ラベルの架空データ。値は検算しやすい小さな数。
// 【最新時点サマリー】（B）・【暦年別リターン】の今年の行（C）は、どちらも値そのものは使われなくなった
// （A.時系列の最新列から導出する設計のため）が、構造の検出・突合せ確認のテストのために残している。
// 既定ではB・Cの値をA.時系列の最新列（2026-09-30）に意図的に一致させておき、「更新忘れ」特有の
// エラーが baseline では出ないことを確認できるようにしている。
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
  rows[16] = ["年率リターン（修正ディーツ・参考）", 0, 0.09, 0.218];
  rows[23] = ["（参考）単純損益率＝損益÷元本", 0, 0.33, 0.875];
  rows[25] = ["【最新時点サマリー】"];
  rows[26] = ["最新日", 46295]; // A.時系列の最新列（2026-09-30）と一致＝baselineでは更新忘れなし
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
  rows[44] = [2026, 300, -521159.4771, 8536791.4771, 0.0903633723281101, "2026年は最新日までのYTD", 75]; // 年末総資産＝A.時系列の最新列（300）と一致＝baselineでは更新忘れなし
  rows[47] = ["【Sheet1 53〜59行との対応】…"];
  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
  return rows;
}

test("最新時点サマリーの値はA.時系列の最新列から取得する（B欄の値は使わない。★などの末尾ラベルは無視）", () => {
  const { metrics, errors } = parseTotalMetricsSheet(sampleRows());
  assert.deepEqual(errors, []);
  assert.deepEqual(metrics.summary, {
    latestDate: "2026-09-30", periodYears: 7.94, totalAssets: 300, principal: 160, totalPnl: 140,
    cumulativeTwr: 1, annualTwr: 0.2154, annualXirr: 0.2619, annualModifiedDietz: 0.218, simpleReturn: 0.875,
  });
});

test("時系列は日付が空になる直前の列まで", () => {
  const { metrics } = parseTotalMetricsSheet(sampleRows());
  assert.equal(metrics.series.length, 3);
  assert.deepEqual(metrics.series.map((p) => p.date), ["2018-12-31", "2019-12-31", "2026-09-30"]);
  assert.deepEqual(metrics.series[2], {
    date: "2026-09-30", totalAssets: 300, principal: 160, twrIndex: 2, cumulativeTwr: 1, annualTwr: 0.2154, annualXirr: 0.2619, totalPnl: 140,
    periodYears: 7.94, annualModifiedDietz: 0.218, simpleReturn: 0.875,
  });
});

test("暦年別リターン：見出し「年」の直下からA列が年の行まで、G列は無視（今年の行が時系列の最新列と一致していれば上書きしない）", () => {
  const { metrics } = parseTotalMetricsSheet(sampleRows());
  assert.deepEqual(metrics.calendarYears.map((y) => [y.year, y.twr, y.pnl, y.note]), [
    [2018, 0, 0, "2018年は2018/10/22〜12/31"],
    [2022, -0.281245056116826, -6959274.2524, null],
    [2026, 0.0903633723281101, 8536791.4771, "2026年は最新日までのYTD"],
  ]);
});

// 実際に発生した不具合の再現：Sheet1からA.時系列（1〜24行）には10月末の新しい列が正しくコピーされたが、
// 【最新時点サマリー】（26〜38行目）と【暦年別リターン】の今年の行（44行目）は前月（9月末）の値のまま
// 更新を忘れている状態。表示される数値は時系列の最新列から計算し直され、何が古いままかをerrorsで知らせる。
test("列が増えても、サマリー欄・暦年別リターンの今年の行の更新を忘れた場合は時系列の最新列から自動的に補う", () => {
  const rows = sampleRows();
  // A.時系列に10月末（2026-10-31、シリアル46326）の列を追加（ユーザーが毎月行う作業）。
  rows[0] = [...rows[0].slice(0, 4), 46326]; // 末尾のnull（空列）の手前に挿入する
  rows[1] = [...rows[1], 8.03];
  rows[2] = [...rows[2], 290]; // 総資産：9月末300→10月末290（下落）
  rows[3] = [...rows[3], 200]; // 累計純入金：160→200（新規入金）
  rows[8] = [...rows[8], 1.9];
  rows[9] = [...rows[9], 0.9];
  rows[10] = [...rows[10], 0.19];
  rows[13] = [...rows[13], 90];
  rows[14] = [...rows[14], 1.0];
  rows[15] = [...rows[15], 0.21];
  rows[16] = [...rows[16], 0.17];
  rows[23] = [...rows[23], 0.45];
  // 【最新時点サマリー】（26〜38行目）・【暦年別リターン】の2026年の行（44行目）は、9月末のまま更新し忘れている。

  const { metrics, errors } = parseTotalMetricsSheet(rows);

  assert.equal(metrics.series.length, 4);
  assert.equal(metrics.series[3].date, "2026-10-31");

  // サマリーは時系列の最新列（10月末）の値になる（B欄の9月末の値は使われない）。
  assert.deepEqual(metrics.summary, {
    latestDate: "2026-10-31", periodYears: 8.03, totalAssets: 290, principal: 200, totalPnl: 90,
    cumulativeTwr: 0.9, annualTwr: 0.19, annualXirr: 0.21, annualModifiedDietz: 0.17, simpleReturn: 0.45,
  });

  // 【最新時点サマリー】欄の「最新日」が古いままであることをお知らせする（ブロッキングではない）。
  assert.ok(errors.some((e) => e.includes("【最新時点サマリー】") && e.includes("2026-09-30") && e.includes("2026-10-31")), errors.join("\n"));

  // 【暦年別リターン】の2026年の行も、時系列の最新列から計算し直される（シートの古い値は使わない）。
  const y2026 = metrics.calendarYears.find((y) => y.year === 2026);
  assert.ok(y2026);
  assert.equal(y2026!.yearEndAssets, 290);
  assert.equal(y2026!.note, "2026年は最新日までのYTD"); // 備考はシートの既存の値を引き継ぐ
  // 2025年末の時点がサンプルに無いため、その手前で最後に分かっている時点（2019-12-31。実データでは
  // 前年末の列が必ずあるため通常は起きない）を起点に計算される：総資産200・元本150・TWR指数1.1。
  assert.equal(y2026!.netDeposit, 50); // 200(10月末の元本) - 150
  assert.equal(y2026!.pnl, 40); // 290(10月末の総資産) - 200 - 50
  assert.ok(Math.abs((y2026!.twr as number) - (1.9 / 1.1 - 1)) < 1e-12); // TWR指数 1.9 / 1.1 - 1
  // 過去の確定年の行（2018・2022年）は変更されない。
  assert.deepEqual(metrics.calendarYears.map((y) => y.year), [2018, 2022, 2026]);

  assert.ok(errors.some((e) => e.includes("【暦年別リターン】") && e.includes("2026年")), errors.join("\n"));
});

test("ラベルが無い場合は、どのラベルが無いかをエラーで返す（握りつぶさない）", () => {
  const rows = sampleRows();
  rows[15] = ["（XIRRの行を削除）"]; // A.時系列のXIRR行（サマリーのannualXirrの実際の取得元）
  rows[13] = ["（累計損益の行を削除）"];
  const { metrics, errors } = parseTotalMetricsSheet(rows);
  assert.equal(metrics.summary.annualXirr, null);
  assert.equal(metrics.summary.totalPnl, null);
  assert.ok(errors.some((e) => e.includes("時系列") && e.includes("年率リターン（XIRR")), errors.join("\n"));
  assert.ok(errors.some((e) => e.includes("時系列") && e.includes("累計損益")), errors.join("\n"));
});

test("参考指標（修正ディーツ・単純損益率）は任意：A.時系列に行が無くてもエラーにしない", () => {
  const rows = sampleRows();
  rows[16] = []; rows[23] = [];
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
  rows[10] = ["年率リターン（TWR・時間加重）", 0, 0.08, "#N/A"]; // A.時系列（サマリーの実際の取得元）
  rows[9] = ["累積リターン（TWR）", 0, 0.1, ""];
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

test("暦年の元本投入：年末時点の累計純入金の前年差（開始年は0起点・時点の無い年はnull・出金超過はマイナス）", () => {
  const pt = (date: string, principal: number | null) => ({ date, principal }) as TotalMetricsPoint;
  const series = [pt("2018-12-31", 675581), pt("2019-12-31", 5475778), pt("2021-03-01", 6000000), pt("2021-12-28", 7000000), pt("2022-06-30", null), pt("2022-09-30", 6500000)];
  const m = calendarYearPrincipalChanges(series, [2018, 2019, 2020, 2021, 2022]);
  assert.deepEqual([...m.entries()], [[2018, 675581], [2019, 4800197], [2020, null], [2021, 1524222], [2022, -500000]]);
});

test("暦年のVOO TWR：前年末終値→年末終値。endIsoで最新年を打ち切り、前年末が無い年はnull", () => {
  const p = (y: number, m: number, d: number, price: number) => ({ date: new Date(y, m - 1, d), price });
  const prices = [p(2019, 12, 31, 100), p(2020, 6, 30, 90), p(2020, 12, 31, 120), p(2021, 9, 30, 150), p(2021, 12, 31, 132)];
  const m = calendarYearPriceTwr(prices, [2019, 2020, 2021], "2021-09-30");
  assert.equal(m.get(2019), null);
  assert.ok(Math.abs((m.get(2020) as number) - 0.2) < 1e-12);
  assert.ok(Math.abs((m.get(2021) as number) - 0.25) < 1e-12);
  assert.ok(Math.abs((calendarYearPriceTwr(prices, [2021]).get(2021) as number) - 0.1) < 1e-12);
});

test("暦年のMDD：年初来高値基準（年またぎでリセット）、年の最初の時点は0、データの無い年はnull", () => {
  const pt = (date: string, twrIndex: number | null) => ({ date, twrIndex }) as TotalMetricsPoint;
  const series = [
    pt("2022-01-03", 1.0), pt("2022-06-30", 0.7), pt("2022-09-30", 0.85), pt("2022-12-30", 0.9),
    pt("2023-01-04", 0.95), pt("2023-12-29", 1.9),
  ];
  const m = calendarYearTwrMdd(series, [2021, 2022, 2023]);
  assert.equal(m.get(2021), null);
  assert.ok(Math.abs((m.get(2022) as number) - -0.3) < 1e-12); // 1.0→0.7＝-30%（年初来高値1.0基準）
  assert.equal(m.get(2023), 0); // 年をまたいで高値はリセットされ、2023年は右肩上がりなので下落なし
});
