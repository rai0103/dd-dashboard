// 実行: npm test
// buildVideoLongform（長尺動画生成：dd-dashboardの構造化データを直接LongMd/UpdateStats等に変換するアダプタ）の
// スモークテスト。computeLongformAnalysisJSON()の戻り値の形を模した最小データを使い、例外なくシーンが
// 生成されること・テキスト(MD)を経由しないことを確認する。
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildVideoLongform, dailyPointsFromFull, crashRowsFromAnalysis } from "./videoDataAdapter.ts";
import { SP500_KANA, tickerKana } from "./videoLongMd.ts";

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
