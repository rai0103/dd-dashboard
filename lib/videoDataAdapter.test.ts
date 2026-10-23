// 実行: npm test
// buildVideoLongform（長尺動画生成：dd-dashboardの構造化データを直接LongMd/UpdateStats等に変換するアダプタ）の
// スモークテスト。computeLongformAnalysisJSON()の戻り値の形を模した最小データを使い、例外なくシーンが
// 生成されること・テキスト(MD)を経由しないことを確認する。
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildVideoLongform, dailyPointsFromFull, crashRowsFromAnalysis } from "./videoDataAdapter.ts";
import { SP500_KANA, tickerKana, availableContentSections } from "./videoLongMd.ts";
import type { CustomSceneSpec } from "./videoCustomScene.ts";

// 10年分の日次価格（単純な上昇トレンド＋ノイズ）を作る。computeUpdateStats/buildBasisが過去年のデータを
// 必要とするため、十分な年数を用意する。
function makeFull(years: number, endYear = 2025): { date: Date; price: number }[] {
  const out: { date: Date; price: number }[] = [];
  let price = 100;
  const startYear = endYear - years + 1;
  for (let y = startYear; y <= endYear; y++) {
    for (let m = 0; m < 12; m++) {
      for (const day of [5, 15, 25]) {
        const date = new Date(Date.UTC(y, m, day));
        if (y === endYear && m > 9) break; // 当年は10月末までのデータに制限（未来日付を避ける）
        price *= 1 + (((y + m + day) % 7) - 3) * 0.004 + 0.0015; // ノイズ付き緩やかな上昇
        out.push({ date, price: Math.max(10, price) });
      }
    }
  }
  return out;
}

function makeData(FULL: { date: Date; price: number }[]) {
  const last = FULL[FULL.length - 1];
  return {
    generated_at: new Date().toISOString(),
    instrument_label: "SP500",
    data_last_date: last.date.toISOString().slice(0, 10),
    current_state: {
      dd_pct: -4.2, mode: "調整", days_since_ath: 12,
      ytd_return_pct: 8.3, one_year_return_pct: 15.1,
      election_cycle_term_year: 2, election_cycle_label: "中間選挙年",
      phase_analysis: { items: ["ボックス圏：ATH（2025/09/01）から12日・DD4.2%"], notes: ["参考値の局面を含みます"] },
    },
    bottom_score: {
      applicable: true, current_mdd_pct: -4.2, latest_dd_pct: -3.8, recovery_ratio_pct: 40.0, days_since_trough: 5,
      tier_label: "DD3-5%", tier_n: 42, tier_low_sample: false, p_hold_pct: 70, p_break_pct: 30,
      median_days_to_ath: 20, median_days_to_break: 15, break_distribution: [{ label: "-5~-10%", count: 10 }],
    },
    rolling_returns: { "1m": 1.2, "3m": 3.4, "6m": 5.6, "1y": 15.1, "3y": 30.2, "5y": 60.1, "10y": 180.5, "20y": 400.2 },
    ytd_vs_past: { current_ytd_pct: 8.3, better_than_pct_of_years: 55.0, sample_years: Array.from({ length: 9 }, (_, i) => ({ year: 2016 + i, ytd_pct_at_same_point: i })) },
    outlook_from_today: {
      year: 2025, as_of_month: 10, blended_forecast_pct: 4.5, blended_probability_pct: 68.0,
      factors: [
        { key: "recent10", label: "直近10年平均", forecast_pct: 5.0, probability_pct: 70, weight_pct: 30, sample_n: 10, ref_years: Array.from({ length: 10 }, (_, i) => ({ year: 2015 + i, return_pct: i - 2 })) },
        { key: "cycle", label: "大統領サイクル平均", forecast_pct: 4.0, probability_pct: 65, weight_pct: 25, sample_n: 3, ref_years: [{ year: 2014, return_pct: 3 }, { year: 2018, return_pct: -2 }, { year: 2022, return_pct: 5 }], detail: { president_info: "任期2年目", sample_years: [2014, 2018, 2022] } },
        { key: "seasonality", label: "大統領サイクル別季節性（月次）", forecast_pct: 3.5, probability_pct: 60, weight_pct: 20, sample_n: 3, ref_years: [], detail: { months: [{ month: 10, avg_return_pct: 1.1, n: 3 }, { month: 11, avg_return_pct: 1.8, n: 3 }, { month: 12, avg_return_pct: 1.5, n: 3 }] } },
      ],
    },
    ath_count: { total_count: 50, years_covered: 10, avg_per_year: 5.0, avg_days_between: 73 },
    ath_gaps: [{ depth_bucket: "0~-3%", n: 40, avg_duration_days: 10, clean_recovery_rate_pct: 80, low_sample: false }],
    drawdown_episodes: [{ ath_date: "2025-08-01", trough_date: "2025-08-20", trough_dd_pct: -4.2, decline_duration_days: 19, recovery_date: null, recovery_duration_days: null, is_ongoing: true }],
    crash_analysis: [
      { threshold_pct: 10, occurrence_count: 20, coverage_years: 95, avg_interval_years: 3, last_occurrence_year: 2022, years_since_last: 3, next_year_probability_pct: 25, prior_year_avg_return_pct: 2.1, prior_year_positive_share_pct: 60, low_sample: false, occurrence_years: [2022], after_1y_avg_return_pct: 12, after_3y_avg_return_pct: 30, after_5y_avg_return_pct: 55 },
      { threshold_pct: 20, occurrence_count: 8, coverage_years: 95, avg_interval_years: 8, last_occurrence_year: 2020, years_since_last: 5, next_year_probability_pct: 10, prior_year_avg_return_pct: 1.0, prior_year_positive_share_pct: 50, low_sample: true, occurrence_years: [2020], after_1y_avg_return_pct: 20, after_3y_avg_return_pct: 40, after_5y_avg_return_pct: 70 },
    ],
    daily_distribution: { n: 2500, up_days_pct: 54.0, down_days_pct: 46.0, avg_daily_return_pct: 0.031, buckets: [{ label: "+2%超", share_pct: 2.0 }, { label: "0〜+1%", share_pct: 30.0 }, { label: "-2%超の下落", share_pct: 1.8 }] },
    disclaimer: "本データは判断補助であり投資助言ではありません。",
  };
}

// [Stage D-6] d.trackRecord（DD-3%到達局面からの最終到達確率等）の最小合成データ。
// 実際のcomputeTrackRecordStats()と同じ形（FINAL_REACH_LEVELS + "-50%以上"の計15行）を手で用意する。
function makeTrackRecord() {
  const levels = [-5, -8, -10, -12, -15, -18, -20, -25, -30, -35, -40, -45, -50];
  const rows = [{ label: "-3%", p: 100, hits: 40 }, ...levels.map((t, i) => ({ label: `${t}%`, p: Math.max(2, 60 - i * 4), hits: Math.max(1, 20 - i) }))];
  rows.push({ label: "-50%以上", p: 3, hits: 1 });
  return { totalYears: 95, n: 40, ddFreqPerYear: 2, finalReach: rows };
}

test("buildVideoLongform：MDテキストを経由せず、LongMd/UpdateStats/シーンを直接組み立てる", () => {
  const FULL = makeFull(11);
  const data = makeData(FULL);
  const d = { FULL, currentDD: -4.2, mode: "調整", daysSinceATH: 12, athDate: new Date(data.current_state.phase_analysis ? FULL[FULL.length - 1].date : FULL[FULL.length - 1].date) };
  const result = buildVideoLongform(data, d);

  assert.ok(result.stats, "UpdateStatsが生成される");
  assert.ok(result.longMd.status, "status（現在の状況）が入る");
  assert.equal(result.longMd.status!.mode, "調整");
  assert.equal(result.longMd.forecast!.total, 4.5);
  assert.equal(result.longMd.forecast!.rows.length, 3);
  assert.ok(result.longMd.crash.length === 2, "crash_analysisの2件がLongMd.crashに変換される");
  assert.ok(result.scenes.length > 0, "シーンが1つ以上生成される");

  const open = result.scenes.find((s) => s.id === "open");
  assert.ok(open, "openシーンが存在する");
  assert.ok(open!.reading.includes(SP500_KANA), "既定ではS&P500として読む");

  // 任意ティッカー（instrumentNameKana指定）でも同じパイプラインが動くことを確認
  const resultTicker = buildVideoLongform(data, d, tickerKana("MSFT"));
  const openT = resultTicker.scenes.find((s) => s.id === "open");
  assert.ok(openT!.reading.includes(tickerKana("MSFT")));
  assert.ok(!openT!.reading.includes(SP500_KANA), "ティッカー指定時はS&P500の決め打ちを使わない");
});

test("crashRowsFromAnalysis / dailyPointsFromFull：単純なフィールド変換", () => {
  const rows = crashRowsFromAnalysis([{ threshold_pct: 10, occurrence_count: 5, low_sample: false, avg_interval_years: 2, last_occurrence_year: 2020, years_since_last: 5, next_year_probability_pct: 30 }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].level, 10);
  assert.equal(rows[0].intervalText, "2年に1度");

  const pts = dailyPointsFromFull([{ date: new Date(Date.UTC(2024, 0, 1)), price: 123.45 }]);
  assert.equal(pts[0].date, "2024-01-01");
  assert.equal(pts[0].close, 123.45);
});

test("buildVideoLongform：sections引数で構成（場面の種類・順番）を指定できる。既定は近況（status）のみ", () => {
  const FULL = makeFull(15); // 大統領サイクル根拠（cycleSampleYears: 2014/2018/2022）が全てカバーされるよう十分な年数を用意
  const data = makeData(FULL);
  const d = { FULL, currentDD: -4.2, mode: "調整", daysSinceATH: 12, athDate: FULL[FULL.length - 1].date, trackRecord: makeTrackRecord(), currentTLabel: "-3%" };

  // 既定（sections省略）：Stage D-6で先頭に「前日比」が追加された近況5点（前日比→騰落率→ATHからの下落率→年末までの過去実績→下落の頻度）
  const def = buildVideoLongform(data, d);
  assert.deepEqual(def.scenes.map((s) => s.id), ["open", "dayChange", "ytdChange", "athDrop", "yearEndTrack", "crashFreq", "end"], "既定はopen→近況5点→endの順");

  // 明示的に指定した順番・組み合わせでシーンが並ぶ（大統領サイクル根拠→底値判定→近況、の順）
  const custom = buildVideoLongform(data, d, SP500_KANA, ["basisCycle", "bottom", "status"]);
  assert.deepEqual(custom.scenes.map((s) => s.id), ["open", "basisCycle", "bottom", "status", "end"]);

  // 対象データの無い構成を指定してもエラーにならず、単にスキップされる（crashmdはdata.crash_analysisがあるため実際には生成される想定）
  const withCrash = buildVideoLongform(data, d, SP500_KANA, ["status", "crashmd", "daily"]);
  assert.deepEqual(withCrash.scenes.map((s) => s.id), ["open", "status", "crashmd", "daily", "end"]);
});

test("availableContentSections：このテストデータで選択可能な構成候補がすべて揃う", () => {
  const FULL = makeFull(15);
  const data = makeData(FULL);
  const d = { FULL, currentDD: -4.2, mode: "調整", daysSinceATH: 12, athDate: FULL[FULL.length - 1].date, trackRecord: makeTrackRecord(), currentTLabel: "-3%" };
  const result = buildVideoLongform(data, d);
  const avail = availableContentSections(result.longMd, result.basis, result.stats);
  for (const id of ["dayChange", "ytdChange", "athDrop", "yearEndTrack", "crashFreq", "status", "bottom", "rolling", "forecast", "basis10", "basisCycle", "ddpace", "crashmd", "daily"]) {
    assert.ok(avail.includes(id), `${id}が選択候補に含まれる`);
  }
});

test("buildVideoLongform：scalarCatalog（Stage D-5）に主要な数値が揃う", () => {
  const FULL = makeFull(11);
  const data = makeData(FULL);
  const d = { FULL, currentDD: -4.2, mode: "調整", daysSinceATH: 12, athDate: FULL[FULL.length - 1].date };
  const result = buildVideoLongform(data, d);
  const sc = result.scalarCatalog;

  for (const key of ["ytd", "ytdAvg", "ytdMedian", "dayChange", "dd", "ddMin", "athCount", "upRatio", "upRatioAvg"]) {
    assert.ok(sc[key] && typeof sc[key].value === "number", `${key}がscalarCatalogに数値として入る`);
  }
  // rolling_returns（rolling_returnsのラベル付き各期間）が反映される
  assert.ok(sc["rolling_1ヶ月"], "ローリングリターン（1ヶ月）がキーとして入る");
  assert.equal(sc["rolling_1ヶ月"].value, 1.2);
  // crash_analysis（threshold_pct 10/20）の来年発生確率
  assert.equal(sc["crashProb_10"].value, 25);
  assert.equal(sc["crashProb_20"].value, 10);
  // bottom_score（applicable:trueのp_hold_pct/p_break_pct）
  assert.equal(sc["bottomPHold"].value, 70);
  assert.equal(sc["bottomPBreak"].value, 30);
  // daily_distribution（up/down）
  assert.equal(sc["dailyUpPct"].value, 54.0);
  assert.equal(sc["dailyDownPct"].value, 46.0);
  // ath_gaps（単一バケット n=40, clean=80 → 加重平均もそのまま80）
  assert.equal(sc["ddpaceCleanRecovery"].value, 80);
});

test("buildVideoLongform：カスタム場面（chartType別）がscalarCatalogから解決される（Stage D-5）", () => {
  const FULL = makeFull(11);
  const data = makeData(FULL);
  const d = { FULL, currentDD: -4.2, mode: "調整", daysSinceATH: 12, athDate: FULL[FULL.length - 1].date };

  const barSpec: CustomSceneSpec = {
    id: "custom:bar1",
    title: "暴落発生確率の比較",
    subtitle: "水準ごと",
    chartType: "bar",
    series: [],
    yUnit: "index",
    bars: [
      { key: "crashProb_10", label: "-10%超" },
      { key: "crashProb_20", label: "-20%超" },
      { key: "unknownKey", label: "存在しないキー" },
    ],
    donut: null,
    reading: "ぼうらくはっせいかくりつのひかく",
    caption: "暴落発生確率の比較",
    minSec: 18,
    sourcePrompt: "暴落発生確率を棒グラフで比較して",
  };
  const donutSpec: CustomSceneSpec = {
    id: "custom:donut1",
    title: "上昇日と下落日の割合",
    subtitle: "",
    chartType: "donut",
    series: [],
    yUnit: "index",
    bars: [],
    donut: { items: [{ key: "dailyUpPct", label: "上昇日" }, { key: "dailyDownPct", label: "下落日" }] },
    reading: "じょうしょうびとかりゅくびのわりあい",
    caption: "上昇日と下落日の割合",
    minSec: 18,
    sourcePrompt: "上昇日と下落日の割合を円グラフで",
  };

  const result = buildVideoLongform(data, d, SP500_KANA, ["status"], [barSpec, donutSpec]);
  const bar = result.customScenes.find((c) => c.id === "custom:bar1")!;
  assert.equal(bar.chartType, "bar");
  assert.equal(bar.bars.length, 2, "存在しないキーは除外される");
  assert.deepEqual(bar.bars.map((b) => b.value), [25, 10]);

  const donut = result.customScenes.find((c) => c.id === "custom:donut1")!;
  assert.equal(donut.chartType, "donut");
  assert.ok(donut.donut, "donutが解決される");
  assert.equal(donut.donut!.segments.length, 2);
  assert.deepEqual(donut.donut!.segments.map((sgm) => sgm.value), [54.0, 46.0]);
});

test("buildVideoLongform：dayChange/finalReach（Stage D-6）がtrackRecordから正しく構築される", () => {
  const FULL = makeFull(11);
  const data = makeData(FULL);
  const trackRecord = makeTrackRecord();
  const d = { FULL, currentDD: -4.2, mode: "調整", daysSinceATH: 12, athDate: FULL[FULL.length - 1].date, trackRecord, currentTLabel: "-3%" };
  const result = buildVideoLongform(data, d);

  // finalReach：trackRecordの値がそのまま（totalYears/n/currentLabel/各行）伝わる
  const fr = result.longMd.finalReach;
  assert.ok(fr, "finalReachが構築される");
  assert.equal(fr!.totalYears, trackRecord.totalYears);
  assert.equal(fr!.n, trackRecord.n);
  assert.equal(fr!.currentLabel, "-3%");
  assert.equal(fr!.rows.length, trackRecord.finalReach.length);
  assert.deepEqual(fr!.rows[0], { label: "-3%", p: 100, hits: 40 });
  assert.ok(fr!.rows.some((r) => r.label === "-50%以上"), "-50%以上の行が含まれる");

  // dayChange：pct/ddPctはstats（価格系列から計算）由来、categoryはclassifyDdCategory(stats.dd)と一致、recent7は直近7点
  const dc = result.longMd.dayChange;
  assert.ok(dc, "dayChangeが構築される");
  assert.equal(dc!.pct, result.stats!.dayChange);
  assert.equal(dc!.ddPct, result.stats!.dd);
  assert.equal(dc!.isNewAth, result.stats!.dd >= -0.005);
  assert.ok(["調整", "下落", "暴落", "大暴落", "歴史的暴落"].includes(dc!.category.label));
  assert.equal(dc!.recent7.length, 7, "直近7営業日が入る");
  assert.deepEqual(
    dc!.recent7.map((pt) => pt.price),
    FULL.slice(-7).map((pt) => pt.price),
  );
  // 調整カテゴリー（-3%行、p=100、ddFreqPerYear=2）なら、年に2.0回程度の頻度になる
  if (dc!.category.label === "調整") {
    assert.equal(dc!.category.freqPerYear, 2);
    assert.equal(dc!.category.freqLabel, "年に2.0回");
  }

  // trackRecordが無い（d.trackRecordが未定義）場合は、dayChange/finalReachともにnullになる（例外にならない）
  const dNoTrack = { FULL, currentDD: -4.2, mode: "調整", daysSinceATH: 12, athDate: FULL[FULL.length - 1].date };
  const resultNoTrack = buildVideoLongform(data, dNoTrack);
  assert.equal(resultNoTrack.longMd.dayChange, null);
  assert.equal(resultNoTrack.longMd.finalReach, null);
  // crashFreq（finalReach依存）・dayChangeは構成から自然に外れ、open/endのみになる
  assert.deepEqual(resultNoTrack.scenes.map((s) => s.id), ["open", "ytdChange", "athDrop", "yearEndTrack", "end"]);
});
