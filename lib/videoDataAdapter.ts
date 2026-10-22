// 長尺動画作成：dd-dashboardが既に持つ構造化データ（computeLongformAnalysisJSON()の戻り値、および
// その元になった`d`オブジェクト）から、テキスト（MD）を一切経由せずに、動画生成パイプライン
// （videoLongMd.LongMd / videoMarketUpdate.CrashRow・UpdateStats / videoLongBasis.LongBasis）が
// 必要とする構造化オブジェクトを直接組み立てるアダプタ。
//
// 「MDテキストの出力・再パースを一切介さない」という移植方針（Phase 2プラン参照）の中核部分。
// 渡される `data` は components/DDDashboard.jsx の computeLongformAnalysisJSON(ctx) の戻り値、
// `d` は同ファイルの computeAll() 相当が返す価格系列オブジェクト（FULL/currentDD/mode/athDate等）。
// dd-dashboard本体はJS（.jsx）で型を持たないため、ここでは data/d を緩く受け取る。

import { LongMd, buildMdScenes, SP500_KANA, tickerKana, ComposedSectionId } from './videoLongMd';
import { buildSeriesCatalog, resolveCustomScene, CustomSceneSpec, ResolvedCustomScene, SeriesCatalog } from './videoCustomScene';
import { CrashRow, UpdateStats, computeUpdateStats } from './videoMarketUpdate';
import { StockDataPoint } from './videoTypes';
import { LongBasis, buildBasis } from './videoLongBasis';
import { LongScene, buildLongScenes } from './videoLongAnalysis';

export { SP500_KANA, tickerKana };

const pct = (v: number | null | undefined, digits = 1): string => (v === null || v === undefined ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%`);

/** dd-dashboardのFULL（{date: Date, price: number, ...}[]）をStockDataPoint[]に変換 */
export function dailyPointsFromFull(FULL: { date: Date; price: number }[]): StockDataPoint[] {
  return FULL.map((p) => ({ date: p.date.toISOString().slice(0, 10), close: p.price }));
}

/** data.crash_analysis（threshold_pct等の生の数値フィールド）→ videoMarketUpdate.CrashRow[]（computeUpdateStatsに渡す形） */
export function crashRowsFromAnalysis(crashAnalysis: any[]): CrashRow[] {
  return (crashAnalysis || []).map((r) => ({
    level: r.threshold_pct,
    count: r.occurrence_count,
    reference: !!r.low_sample,
    intervalYears: r.avg_interval_years ?? null,
    intervalText: r.avg_interval_years != null ? `${r.avg_interval_years}年に1度` : '—',
    lastYear: r.last_occurrence_year ?? null,
    elapsedYears: r.years_since_last ?? null,
    prob1y: r.next_year_probability_pct ?? 0,
  }));
}

/** data.crash_analysis → LongMd.crash（buildMdScenesの暴落シーン・LongAnalysisRendererの表で使う、表示用に整形済みの形） */
function longMdCrashRows(crashAnalysis: any[]): LongMd['crash'] {
  return (crashAnalysis || []).map((r) => ({
    level: r.threshold_pct,
    count: `${r.occurrence_count}件${r.low_sample ? '（参考値）' : ''}`,
    ref: !!r.low_sample,
    interval: r.avg_interval_years != null ? `${r.avg_interval_years}年に1度` : '—',
    last: r.last_occurrence_year ? `${r.last_occurrence_year}年（${r.years_since_last}年経過）` : '発生なし',
    prob: r.next_year_probability_pct ?? 0,
    prevAvg: pct(r.prior_year_avg_return_pct),
    prevPlus: r.prior_year_positive_share_pct != null ? `${r.prior_year_positive_share_pct}%` : '—',
    a1: pct(r.after_1y_avg_return_pct), a3: pct(r.after_3y_avg_return_pct), a5: pct(r.after_5y_avg_return_pct),
  }));
}

/** data.bottom_score（computeBottomScoreInfoの戻り値）→ LongMd.bottom。■2セクションのテキスト整形をそのまま再現する */
function longMdBottom(bs: any): LongMd['bottom'] {
  if (!bs) return null;
  if (!bs.applicable) return { lines: [bs.reason ?? '算出不可'], excluded: false, mdd: null, level: null, pHold: null, pBreak: null, tierLabel: null };
  const lines: string[] = [];
  lines.push(`現在のMDD ${bs.current_mdd_pct}%・直近DD ${bs.latest_dd_pct}%・戻し${bs.recovery_ratio_pct}%・底値から${bs.days_since_trough}日`);
  lines.push(`該当する過去ケース「${bs.tier_label}」（n=${bs.tier_n}${bs.tier_low_sample ? '・参考値' : ''}）：底値を維持してATH更新に至った割合 ${bs.p_hold_pct ?? '—'}% ／ さらに底割れした割合 ${bs.p_break_pct ?? '—'}%`);
  if (bs.median_days_to_ath != null) lines.push(`底値を維持したケースのATH到達までの中央日数：${bs.median_days_to_ath}日`);
  if (bs.median_days_to_break != null) lines.push(`底割れしたケースの再下落確定までの中央日数：${bs.median_days_to_break}日`);
  const brk = (bs.break_distribution || []).filter((b: any) => b.count > 0);
  if (brk.length) lines.push(`底割れした場合の最終到達深度の内訳：${brk.map((b: any) => `${b.label} ${b.count}件`).join(' / ')}`);
  return {
    lines, excluded: false, mdd: null, level: null,
    pHold: typeof bs.p_hold_pct === 'number' ? bs.p_hold_pct : null,
    pBreak: typeof bs.p_break_pct === 'number' ? bs.p_break_pct : null,
    tierLabel: bs.tier_label ?? null,
  };
}

export interface VideoLongformResult {
  longMd: LongMd;
  stats: UpdateStats | null;
  basis: LongBasis | null;
  scenes: LongScene[];
  rolling: { label: string; v: number }[];
  customScenes: ResolvedCustomScene[]; // Stage D-4：チャットで生成したカスタム場面（系列データ解決済み）
  catalog: SeriesCatalog; // Stage D-4：カスタム場面で選べるデータ系列の一覧（AIのtoolスキーマ・UIで使う）
}

/**
 * dd-dashboardの長尺用データ（data = computeLongformAnalysisJSON(ctx)、d = ctx.d）から、
 * 動画生成に必要な構造化データ一式（LongMd・UpdateStats・LongBasis・シーン配列）を直接組み立てる。
 * instrumentNameKana省略時はS&P500として読む（既存のSP500専用パスの挙動を維持）。
 */
export function buildVideoLongform(data: any, d: any, instrumentNameKana: string = SP500_KANA, sections?: ComposedSectionId[], customScenes?: CustomSceneSpec[]): VideoLongformResult {
  const dailyPoints = dailyPointsFromFull(d.FULL);
  const crashRows = crashRowsFromAnalysis(data.crash_analysis);
  const stats = computeUpdateStats(dailyPoints, crashRows);

  const cycleFactor = (data.outlook_from_today?.factors || []).find((f: any) => f.key === 'cycle');
  const seasonFactor = (data.outlook_from_today?.factors || []).find((f: any) => f.key === 'seasonality');
  const cycleSampleYears: number[] = cycleFactor?.detail?.sample_years ?? [];
  const [y, m, dd] = data.data_last_date.split('-').map((n: string) => parseInt(n, 10));
  const basis = buildBasis(dailyPoints, y, cycleSampleYears, data.data_last_date);

  const rollingLabels: [string, string][] = [['1m', '1ヶ月'], ['3m', '3ヶ月'], ['6m', '6ヶ月'], ['1y', '1年'], ['3y', '3年'], ['5y', '5年'], ['10y', '10年'], ['20y', '20年']];
  const rr = data.rolling_returns || {};
  const rolling = rollingLabels.filter(([k]) => rr[k] != null).map(([k, label]) => ({ label, v: rr[k] as number }));

  const longMd: LongMd = {
    y, m, d: dd,
    status: {
      dd: data.current_state.dd_pct,
      mode: data.current_state.mode,
      ytd: data.current_state.ytd_return_pct,
      oneYear: data.current_state.one_year_return_pct,
      cycle: data.current_state.election_cycle_label,
      athDate: d.athDate instanceof Date ? d.athDate.toISOString().slice(0, 10) : String(d.athDate),
      athDays: data.current_state.days_since_ath,
      caseN: null, caseFrom: null, caseTo: null, caseAth: null, caseDd: null, caseDdLevel: null,
      notes: [...(data.current_state.phase_analysis?.items ?? []), ...(data.current_state.phase_analysis?.notes ?? [])],
    },
    bottom: longMdBottom(data.bottom_score),
    rolling,
    ytdNote: data.ytd_vs_past ? { ytd: data.ytd_vs_past.current_ytd_pct, years: data.ytd_vs_past.sample_years.length, pct: data.ytd_vs_past.better_than_pct_of_years ?? 0 } : null,
    forecast: data.outlook_from_today?.blended_forecast_pct != null ? {
      total: data.outlook_from_today.blended_forecast_pct,
      prob: data.outlook_from_today.blended_probability_pct ?? 0,
      cycleYears: cycleSampleYears,
      monthly: (seasonFactor?.detail?.months ?? []).map((mm: any) => ({ m: mm.month, v: mm.avg_return_pct })),
      rows: (data.outlook_from_today.factors || []).map((f: any) => ({ name: f.label, mean: f.forecast_pct, prob: f.probability_pct, weight: f.weight_pct, n: f.sample_n })),
    } : null,
    ddpace: data.ath_count ? {
      athCount: data.ath_count.total_count,
      perYear: data.ath_count.avg_per_year,
      every: data.ath_count.avg_days_between ?? 0,
      buckets: (data.ath_gaps || []).map((b: any) => ({ range: b.depth_bucket, n: b.n, ref: !!b.low_sample, days: b.avg_duration_days ?? 0, clean: b.clean_recovery_rate_pct ?? 0 })),
      phases: data.drawdown_episodes ? data.drawdown_episodes.length : null,
    } : null,
    crash: longMdCrashRows(data.crash_analysis),
    daily: data.daily_distribution ? {
      up: data.daily_distribution.up_days_pct,
      down: data.daily_distribution.down_days_pct,
      avg: data.daily_distribution.avg_daily_return_pct,
      buckets: (data.daily_distribution.buckets || []).map((b: any) => ({ label: b.label, v: b.share_pct })),
    } : null,
  };

  const catalog = buildSeriesCatalog(dailyPoints, y, data.data_last_date);
  const resolvedCustomScenes = (customScenes ?? []).map((c) => resolveCustomScene(c, catalog));

  const scenes = stats ? buildLongScenes(stats, longMd, basis, rolling, instrumentNameKana, sections, customScenes) : [];
  return { longMd, stats, basis, scenes, rolling, customScenes: resolvedCustomScenes, catalog };
}
