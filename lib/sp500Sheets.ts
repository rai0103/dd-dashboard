// [Stage E-16] S&P500解説動画（モックアップ25枚）の各シートに使う数値を、日次終値から機械的に計算する。
// AIには数値を作文させない（accelSensor.ts・rollingReturn.ts等と同じ方針）。入力はダッシュボードが書き出す
// price-series:VOO（S&P500本系列＝1957年〜の指数をVOO換算でつないだ日次終値）を想定し、比率（%）だけを使う。
// 依存はaccelSensor.ts（prepareSeries・extractEpisodes）のみで、node --testで直接テストできる。
import { prepareSeries, extractEpisodes } from './accelSensor.ts';
import type { PricePoint } from './accelSensor.ts';

type InPoint = { date: string | Date; close?: number | null; price?: number | null };
export interface XY { x: number; y: number }

const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;
const pctOf = (from: number, to: number) => r1((to / from - 1) * 100);
const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
const median = (a: number[]) => quantile([...a].sort((x, y) => x - y), 0.5);
const yearOf = (iso: string) => Number(iso.slice(0, 4));
const yearFrac = (iso: string) => yearOf(iso) + (Number(iso.slice(5, 7)) - 1) / 12 + (Number(iso.slice(8, 10)) - 1) / 365;
/** 米大統領の任期何年目か（1〜4。1年目＝就任年） */
export const termYearOf = (year: number) => { const r = ((year % 4) + 4) % 4; return r === 0 ? 4 : r; };

/** 年ごとの最初・最後の営業日のインデックス */
function yearRanges(s: PricePoint[]): Map<number, { first: number; last: number }> {
  const m = new Map<number, { first: number; last: number }>();
  s.forEach((p, i) => {
    const y = yearOf(p.date);
    const cur = m.get(y);
    if (!cur) m.set(y, { first: i, last: i }); else cur.last = i;
  });
  return m;
}
/** 最高値（終値ベース）からの下落率（%、0以下）と、最後に最高値を付けた日のインデックス */
function drawdowns(s: PricePoint[]): { dd: number[]; athIdx: number[] } {
  const dd: number[] = [], athIdx: number[] = [];
  let peak = -Infinity, pi = 0;
  s.forEach((p, i) => { if (p.close >= peak) { peak = p.close; pi = i; } dd.push((p.close / peak - 1) * 100); athIdx.push(pi); });
  return { dd, athIdx };
}

// ---------------------------------------------------------------- S1 タイトル背景
export interface TitleSheet { startDate: string; endDate: string; years: number; multiple: number; cagr: number; background: XY[] }
export function titleSheet(s: PricePoint[]): TitleSheet | null {
  if (s.length < 2) return null;
  const bg: XY[] = [];
  let lastYm = '';
  s.forEach((p, i) => {
    const ym = p.date.slice(0, 7);
    if (ym !== lastYm || i === s.length - 1) { bg.push({ x: r2(yearFrac(p.date)), y: r2(Math.log10(p.close)) }); lastYm = ym; }
  });
  const years = (Date.parse(s[s.length - 1].date) - Date.parse(s[0].date)) / (365.2425 * 864e5);
  const multiple = s[s.length - 1].close / s[0].close;
  return { startDate: s[0].date, endDate: s[s.length - 1].date, years: r1(years), multiple: Math.round(multiple), cagr: r1((Math.pow(multiple, 1 / years) - 1) * 100), background: bg };
}

// ---------------------------------------------------------------- S4-5 年初来→直近ズーム
export interface ZoomSheet {
  year: number;
  ytd: { date: string; pct: number }[];
  zoomFrom: number; // ytd配列の中でズームを始める位置
  zoom: { date: string; close: number; dayPct: number }[];
  ytdPct: number; dd: number; daysSinceATH: number; lastDayPct: number; asOf: string;
}
export function zoomSheet(s: PricePoint[], zoomDays = 7): ZoomSheet | null {
  if (s.length < zoomDays + 2) return null;
  const last = s.length - 1;
  const year = yearOf(s[last].date);
  const yr = yearRanges(s).get(year)!;
  const baseIdx = yr.first > 0 ? yr.first - 1 : yr.first;
  const base = s[baseIdx].close;
  const ytd = s.slice(yr.first, last + 1).map((p) => ({ date: p.date, pct: pctOf(base, p.close) }));
  const { dd, athIdx } = drawdowns(s);
  const zoom = s.slice(last - zoomDays + 1, last + 1).map((p, k) => {
    const i = last - zoomDays + 1 + k;
    return { date: p.date, close: r2(p.close), dayPct: pctOf(s[i - 1].close, p.close) };
  });
  return {
    year, ytd, zoomFrom: Math.max(0, ytd.length - zoomDays), zoom,
    ytdPct: ytd[ytd.length - 1].pct, dd: r1(dd[last]), daysSinceATH: last - athIdx[last],
    lastDayPct: pctOf(s[last - 1].close, s[last].close), asOf: s[last].date,
  };
}

// ---------------------------------------------------------------- S6 騰落日数（バタフライ）
export interface UpDownRow { label: string; up: number; down: number; upAvg: number; downAvg: number; n?: number }
export interface UpDownSheet { k: number; asOf: string; rows: UpDownRow[]; termYear: number; nextUpAfterUp: number; nextUpAfterDown: number; lastDayUp: boolean }
function upDownIn(s: PricePoint[], from: number, to: number): { up: number; down: number; upAvg: number; downAvg: number } {
  const ups: number[] = [], downs: number[] = [];
  for (let i = Math.max(1, from); i <= to; i++) {
    const r = (s[i].close / s[i - 1].close - 1) * 100;
    if (r > 0) ups.push(r); else if (r < 0) downs.push(r);
  }
  return { up: ups.length, down: downs.length, upAvg: r2(mean(ups) || 0), downAvg: r2(mean(downs) || 0) };
}
export function upDownSheet(s: PricePoint[]): UpDownSheet | null {
  if (s.length < 300) return null;
  const last = s.length - 1, year = yearOf(s[last].date);
  const ranges = yearRanges(s);
  const cur = ranges.get(year)!;
  const k = last - cur.first; // 年初から何営業日目か（0始まり）
  const rowFor = (label: string, years: number[]): UpDownRow | null => {
    const xs = years.map((y) => ranges.get(y)!).filter((r) => r && r.first > 0 && r.first + k <= r.last).map((r) => upDownIn(s, r.first, r.first + k));
    if (!xs.length) return null;
    return { label, up: r1(mean(xs.map((x) => x.up))), down: r1(mean(xs.map((x) => x.down))), upAvg: r2(mean(xs.map((x) => x.upAvg))), downAvg: r2(mean(xs.map((x) => x.downAvg))), n: xs.length };
  };
  const complete = [...ranges.keys()].filter((y) => y < year && ranges.get(y)!.first > 0);
  const tY = termYearOf(year);
  const rows: UpDownRow[] = [];
  const now = upDownIn(s, cur.first, last);
  rows.push({ label: `${year}年（今年）`, ...now });
  const r10 = rowFor('過去10年の平均', complete.slice(-10));
  if (r10) rows.push(r10);
  const rT = rowFor(`大統領任期${tY}年目の平均`, complete.filter((y) => termYearOf(y) === tY));
  if (rT) rows.push(rT);
  // 翌営業日に上昇した割合（全期間）：前日が上昇／下落だった場合
  let uu = 0, un = 0, du = 0, dn = 0;
  for (let i = 2; i <= last; i++) {
    const prev = s[i - 1].close / s[i - 2].close - 1, nx = s[i].close / s[i - 1].close - 1;
    if (prev > 0) { un++; if (nx > 0) uu++; } else if (prev < 0) { dn++; if (nx > 0) du++; }
  }
  return { k, asOf: s[last].date, rows, termYear: tY, nextUpAfterUp: r1((uu / un) * 100), nextUpAfterDown: r1((du / dn) * 100), lastDayUp: s[last].close > s[last - 1].close };
}

// ---------------------------------------------------------------- S8 過去のDD局面の重ね描き
export interface DdOverlayPath { label: string; startDate: string; path: XY[]; minDD: number; minT: number }
export interface DdOverlaySheet { mode: 'current' | 'recent'; current: XY[] | null; elapsed: number; window: number; paths: DdOverlayPath[]; medianPath: XY[]; deepest: DdOverlayPath | null; total: number }
export function ddOverlaySheet(s: PricePoint[], pick = 7): DdOverlaySheet | null {
  const { episodes, current } = extractEpisodes(s);
  if (!episodes.length) return null;
  const { dd } = drawdowns(s);
  const last = s.length - 1;
  const elapsed = current ? last - current.startIdx : 0;
  const window = Math.min(250, Math.max(60, elapsed + 60));
  const pathOf = (start: number, len: number): XY[] => {
    const out: XY[] = [];
    for (let t = 0; t <= len && start + t <= last; t++) out.push({ x: t, y: r1(dd[start + t]) });
    return out;
  };
  let chosen = episodes.filter((e) => e.startIdx + window <= last || e.endDate);
  if (current && elapsed >= 2) {
    const cur = dd.slice(current.startIdx, last + 1);
    const score = (start: number) => { let sum = 0, n = 0; for (let t = 0; t < cur.length && start + t <= last; t++) { sum += (dd[start + t] - cur[t]) ** 2; n++; } return n ? Math.sqrt(sum / n) : Infinity; };
    chosen = [...chosen].sort((a, b) => score(a.startIdx) - score(b.startIdx)).slice(0, pick);
  } else {
    chosen = chosen.slice(-pick);
  }
  chosen.sort((a, b) => a.startIdx - b.startIdx);
  const paths: DdOverlayPath[] = chosen.map((e) => {
    const path = pathOf(e.startIdx, window);
    let minDD = 0, minT = 0;
    path.forEach((p) => { if (p.y < minDD) { minDD = p.y; minT = p.x; } });
    return { label: `${e.startDate.slice(0, 4)}年${Number(e.startDate.slice(5, 7))}月〜`, startDate: e.startDate, path, minDD, minT };
  });
  const medianPath: XY[] = [];
  for (let t = 0; t <= window; t++) {
    const v = paths.map((p) => p.path[t]?.y).filter((x): x is number => x != null);
    if (v.length >= Math.min(3, paths.length)) medianPath.push({ x: t, y: r1(median(v)) });
  }
  const deepest = paths.reduce<DdOverlayPath | null>((b, p) => (!b || p.minDD < b.minDD ? p : b), null);
  return { mode: current ? 'current' : 'recent', current: current ? pathOf(current.startIdx, elapsed) : null, elapsed, window, paths, medianPath, deepest, total: episodes.length };
}

// ---------------------------------------------------------------- S13 暴落ラベル付きDDチャート
export interface CrashLabel { label: string; peakDate: string; troughDate: string; troughDD: number; recoveryDate: string | null; x: number; y: number }
export interface DdHistorySheet {
  points: XY[]; crashes: CrashLabel[]; reach: { level: number; share: number; years: number }[]; yearsCounted: number;
  longest: { peakDate: string; recoveryDate: string | null; years: number } | null; maxDD: number;
  /** 最高値を付けた日から「その後二度とその水準を下回らなくなった日」までが10年以上かかった期間（例：2000年ITバブル〜2013年） */
  permanent: { peakDate: string; recoveryDate: string | null; years: number; label: string }[];
}
const CRASH_NAMES: { from: number; to: number; name: string }[] = [
  { from: 1957, to: 1957, name: '1957年 景気後退' },
  { from: 1962, to: 1962, name: '1962年 ケネディ・ショック' },
  { from: 1966, to: 1966, name: '1966年 信用収縮' },
  { from: 1969, to: 1970, name: '1969-70年 景気後退' },
  { from: 1973, to: 1974, name: '1973-74年 オイルショック' },
  { from: 1980, to: 1982, name: '1980-82年 高金利不況' },
  { from: 1987, to: 1987, name: '1987年 ブラックマンデー' },
  { from: 1990, to: 1990, name: '1990年 湾岸危機' },
  { from: 1998, to: 1998, name: '1998年 アジア・ロシア危機' },
  { from: 2001, to: 2002, name: '2000-02年 ITバブル崩壊' },
  { from: 2008, to: 2009, name: '2008-09年 リーマンショック' },
  { from: 2011, to: 2011, name: '2011年 米国債格下げ' },
  { from: 2018, to: 2018, name: '2018年 利上げ・貿易摩擦' },
  { from: 2020, to: 2020, name: '2020年 コロナショック' },
  { from: 2022, to: 2022, name: '2022年 急速な利上げ' },
  { from: 2025, to: 2025, name: '2025年 関税ショック' },
];
export function crashName(troughYear: number): string {
  return CRASH_NAMES.find((c) => troughYear >= c.from && troughYear <= c.to)?.name ?? `${troughYear}年の下落`;
}
export function ddHistorySheet(s: PricePoint[], labelDepth = -19, maxLabels = 10): DdHistorySheet | null {
  if (s.length < 300) return null;
  const { dd } = drawdowns(s);
  const last = s.length - 1;
  const points: XY[] = [];
  for (let i = 0; i <= last; i += 5) points.push({ x: r2(yearFrac(s[i].date)), y: r1(dd[i]) });
  if (points[points.length - 1].x !== r2(yearFrac(s[last].date))) points.push({ x: r2(yearFrac(s[last].date)), y: r1(dd[last]) });
  // 水面下の期間（最高値→最高値の回復）ごとの最深点
  const periods: { peak: number; trough: number; rec: number | null }[] = [];
  let start = -1, trough = -1;
  for (let i = 0; i <= last; i++) {
    if (dd[i] < 0) { if (start < 0) { start = i - 1 < 0 ? 0 : i - 1; trough = i; } if (dd[i] < dd[trough]) trough = i; }
    else if (start >= 0) { periods.push({ peak: start, trough, rec: i }); start = -1; }
  }
  if (start >= 0) periods.push({ peak: start, trough, rec: null });
  const crashes = periods.filter((p) => dd[p.trough] <= labelDepth)
    .sort((a, b) => dd[a.trough] - dd[b.trough]).slice(0, maxLabels)
    .map((p) => ({ label: crashName(yearOf(s[p.trough].date)), peakDate: s[p.peak].date, troughDate: s[p.trough].date, troughDD: r1(dd[p.trough]), recoveryDate: p.rec != null ? s[p.rec].date : null, x: r2(yearFrac(s[p.trough].date)), y: r1(dd[p.trough]) }))
    .sort((a, b) => a.x - b.x);
  // 暦年ベース：その年のうちに各水準まで下がった年の割合（完全な年のみ）
  const ranges = yearRanges(s);
  const curYear = yearOf(s[last].date);
  const yearMins = [...ranges.entries()].filter(([y]) => y < curYear).map(([, r]) => Math.min(...dd.slice(r.first, r.last + 1)));
  const reach = [-5, -10, -20, -30].map((level) => ({ level, share: r1((yearMins.filter((m) => m <= level).length / yearMins.length) * 100), years: yearMins.filter((m) => m <= level).length }));
  const longestP = periods.reduce<typeof periods[number] | null>((b, p) => { const len = (p.rec ?? last) - p.peak; return !b || len > (b.rec ?? last) - b.peak ? p : b; }, null);
  const longest = longestP ? { peakDate: s[longestP.peak].date, recoveryDate: longestP.rec != null ? s[longestP.rec].date : null, years: r1((Date.parse(s[longestP.rec ?? last].date) - Date.parse(s[longestP.peak].date)) / (365.2425 * 864e5)) } : null;
  // 「本格回復」：ピークの水準を一度上回っても、その後また下回るなら回復とみなさない（2000年→2007年→2008年→2013年）
  const sufMin: number[] = new Array(s.length);
  for (let i = last, m = Infinity; i >= 0; i--) { m = Math.min(m, s[i].close); sufMin[i] = m; }
  const permanent: DdHistorySheet['permanent'] = [];
  let coveredTo = -1;
  for (const pr of periods.filter((q) => dd[q.trough] <= -20)) {
    if (pr.peak <= coveredTo) continue; // すでに数えた長い期間の中に含まれるピークは飛ばす
    const pc = s[pr.peak].close;
    let rec: number | null = null;
    for (let j = pr.peak + 1; j <= last; j++) if (s[j].close >= pc && sufMin[j] >= pc) { rec = j; break; }
    const years = (Date.parse(s[rec ?? last].date) - Date.parse(s[pr.peak].date)) / (365.2425 * 864e5);
    if (years < 10) continue;
    coveredTo = rec ?? last;
    const y0 = yearOf(s[pr.peak].date), y1 = yearOf(s[rec ?? last].date);
    const names = periods.filter((q) => q.trough >= pr.peak && q.trough <= (rec ?? last) && dd[q.trough] <= -20).map((q) => crashName(yearOf(s[q.trough].date)).replace(/^[\d-]+年\s*/, ''));
    permanent.push({ peakDate: s[pr.peak].date, recoveryDate: rec != null ? s[rec].date : null, years: r1(years), label: `${(() => { const u = [...new Set(names)]; return u.length > 1 ? `${u[0]}〜${u[u.length - 1]}` : u[0] ?? `${y0}年の下落`; })()}：${y0}〜${y1}年` });
  }
  return { points, crashes, reach, yearsCounted: yearMins.length, longest, maxDD: r1(Math.min(...dd)), permanent };
}

// ---------------------------------------------------------------- S14 現在地点からの3パターン
export interface ZoneOutcome { label: string; share: number }
export interface AthZoneSheet {
  state: 'athZone' | 'drawdown'; dd: number; daysSinceATH: number; horizon: number;
  /** 最高値圏（−3%以内）にいた日の、horizon営業日以内の結果（新高値更新／ATH圏内継続／DD局面入り） */
  base: { n: number; outcomes: ZoneOutcome[] };
  /** 現在と似た状態（DDが±1ポイント以内）だった日の結果。下落局面中のときの分岐（回復／横ばい／さらに下落） */
  current: { n: number; outcomes: ZoneOutcome[] };
  /** 最高値を更新した日から、t営業日以内にDD局面（−3%超の下落）に入った割合 */
  ddEntryAfterAth: { days: number; share: number }[];
  /** 直近の最高値更新の1ヶ月前〜今日の実際の値動き（x：最高値更新日からの営業日、y：その最高値からの%） */
  path: XY[];
  /** 今日から先：似た状態だった日のその後を当てはめた範囲（同じ単位。上限＝90%点・下限＝10%点・平均） */
  forward: { x: number; lo: number; mean: number; hi: number }[];
  athDate: string;
  /** 互換用（以前の場面ビルダーが使っていた形） */
  outcomes: ZoneOutcome[]; n: number;
}
function zoneOutcomes(s: PricePoint[], dd: number[], athIdx: number[], samples: number[], horizon: number, kind: 'athZone' | 'drawdown', ddRef: number): number[] {
  const counts = [0, 0, 0];
  for (const i of samples) {
    const peak = s[athIdx[i]].close;
    let res = 1;
    for (let j = i + 1; j <= i + horizon; j++) {
      if (kind === 'athZone') {
        if (s[j].close > peak) { res = 0; break; }
        if (dd[j] <= -3) { res = 2; break; }
      } else {
        if (dd[j] > -3) { res = 0; break; }
        if (dd[j] <= ddRef - 2) { res = 2; break; }
      }
    }
    counts[res]++;
  }
  return counts;
}
export function athZoneSheet(s: PricePoint[], horizon = 20, forward = 60, preDays = 21): AthZoneSheet | null {
  const last = s.length - 1;
  if (last < 600) return null;
  const { dd, athIdx } = drawdowns(s);
  const ddNow = dd[last];
  const state: AthZoneSheet['state'] = ddNow > -3 ? 'athZone' : 'drawdown';
  // 最高値圏（−3%以内）にいた日全体の結果（基準となる3パターン）
  const baseSamples: number[] = [];
  for (let i = 0; i + horizon <= last; i++) if (dd[i] > -3) baseSamples.push(i);
  const bc = zoneOutcomes(s, dd, athIdx, baseSamples, horizon, 'athZone', 0);
  const baseLabels = ['新高値を更新', 'ATH圏内（−3%以内）で推移', 'DD局面（−3%超の下落）入り'];
  const base = { n: baseSamples.length, outcomes: baseLabels.map((label, k) => ({ label, share: r1((bc[k] / Math.max(1, baseSamples.length)) * 100) })) };
  // 現在と似た状態だった日の結果
  const curSamples: number[] = [];
  for (let i = 0; i + forward <= last; i++) {
    if (Math.abs(dd[i] - ddNow) > 1) continue;
    if (state === 'athZone' ? dd[i] <= -3 : dd[i] > -3) continue;
    curSamples.push(i);
  }
  if (curSamples.length < 20) return null;
  const cc = zoneOutcomes(s, dd, athIdx, curSamples, horizon, state, ddNow);
  const curLabels = state === 'athZone' ? baseLabels : ['−3%以内まで回復', '同じ水準で推移', 'さらに2ポイント以上下落'];
  const current = { n: curSamples.length, outcomes: curLabels.map((label, k) => ({ label, share: r1((cc[k] / curSamples.length) * 100) })) };
  // 最高値更新の日から、t営業日以内にDD局面に入った割合
  const athDays: number[] = [];
  for (let i = 1; i <= last; i++) if (athIdx[i] === i && i + 60 <= last) athDays.push(i);
  const ddEntryAfterAth = [5, 10, 20, 60].map((t) => {
    let hit = 0;
    for (const i of athDays) { for (let j = i + 1; j <= i + t; j++) if (dd[j] <= -3) { hit++; break; } }
    return { days: t, share: r1((hit / Math.max(1, athDays.length)) * 100) };
  });
  const ai = athIdx[last], athClose = s[ai].close;
  const path: XY[] = [];
  for (let i = Math.max(0, ai - preDays); i <= last; i++) path.push({ x: i - ai, y: pctOf(athClose, s[i].close) });
  const thin = curSamples.filter((_, k) => k % 3 === 0);
  const fwd: AthZoneSheet['forward'] = [];
  const x0 = last - ai;
  for (let t = 0; t <= forward; t += 2) {
    const v = thin.map((i) => ((1 + ddNow / 100) * (s[i + t].close / s[i].close) - 1) * 100).sort((a, b) => a - b);
    fwd.push({ x: x0 + t, lo: r1(quantile(v, 0.1)), mean: r1(mean(v)), hi: r1(quantile(v, 0.9)) });
  }
  return {
    state, dd: r1(ddNow), daysSinceATH: last - ai, horizon, base, current, ddEntryAfterAth, path, forward: fwd, athDate: s[ai].date,
    outcomes: current.outcomes, n: current.n,
  };
}

// ---------------------------------------------------------------- S3 DDの定義（実例）
export interface DdDefinitionSheet {
  peakDate: string; troughDate: string; recoveryDate: string; mdd: number; ddDays: number; recoverDays: number;
  path: XY[]; troughX: number; recX: number; dd3PerYear: number; dd5Share: number; label: string;
}
export function ddDefinitionSheet(s: PricePoint[], minDepth = -10): DdDefinitionSheet | null {
  const last = s.length - 1;
  if (last < 600) return null;
  const { dd } = drawdowns(s);
  // 直近の「最高値→底（−10%以上）→最高値の回復」まで終わった局面を実例に使う
  let ex: { peak: number; trough: number; rec: number } | null = null;
  let start = -1, trough = -1;
  for (let i = 0; i <= last; i++) {
    if (dd[i] < 0) { if (start < 0) { start = Math.max(0, i - 1); trough = i; } if (dd[i] < dd[trough]) trough = i; }
    else if (start >= 0) { if (dd[trough] <= minDepth) ex = { peak: start, trough, rec: i }; start = -1; }
  }
  if (!ex) return null;
  const pre = 15, post = 15;
  const path: XY[] = [];
  for (let i = Math.max(0, ex.peak - pre); i <= Math.min(last, ex.rec + post); i++) path.push({ x: i - ex.peak, y: r1(dd[i]) });
  const { episodes } = extractEpisodes(s);
  const years = (Date.parse(s[last].date) - Date.parse(s[0].date)) / (365.2425 * 864e5);
  const done = episodes.filter((e) => e.endDate);
  return {
    peakDate: s[ex.peak].date, troughDate: s[ex.trough].date, recoveryDate: s[ex.rec].date, mdd: r1(dd[ex.trough]),
    ddDays: ex.rec - ex.peak, recoverDays: ex.rec - ex.trough, path, troughX: ex.trough - ex.peak, recX: ex.rec - ex.peak,
    dd3PerYear: r1(episodes.length / years), dd5Share: r1((done.filter((e) => e.judgeIdx != null).length / Math.max(1, done.length)) * 100),
    label: crashName(yearOf(s[ex.trough].date)),
  };
}

// ---------------------------------------------------------------- S9 DD速度センサーの分岐
export interface BranchSheet {
  state: 'normal' | 'over3' | 'reached5';
  /** 今回の実際の値動き（x：DD−3%到達日からの営業日、y：最高値からの%）。平常時は直近20営業日（x≦0） */
  lead: XY[];
  total: number; judged: number; recovered: number;
  /** 今回の速さ（acc）と同じ区分の局面（reached5のときのみ） */
  bucket: { label: string; n: number; rates: { threshold: number; share: number }[]; medianDD: number } | null;
  /** −5%を超えた局面全体のその後の深さ（over3のとき） */
  judgedRates: { threshold: number; share: number }[];
  acc: number | null; elapsed: number; ddNow: number;
  /** 平常時：最高値圏（−3%以内）からの20営業日以内の結果 */
  zone: ZoneOutcome[] | null;
}
export function branchSheet(s: PricePoint[]): BranchSheet | null {
  const last = s.length - 1;
  if (last < 600) return null;
  const { episodes, current } = extractEpisodes(s);
  const done = episodes.filter((e) => e.endDate);
  if (!done.length) return null;
  const { dd } = drawdowns(s);
  const judgedEps = done.filter((e) => e.judgeIdx != null);
  const rateOf = (list: typeof done, t: number) => r1((list.filter((e) => e.maxDD >= t).length / Math.max(1, list.length)) * 100);
  const TH = [0.08, 0.10, 0.15, 0.20];
  const state: BranchSheet['state'] = current ? (current.judgeIdx != null ? 'reached5' : 'over3') : 'normal';
  const lead: XY[] = [];
  if (current) for (let i = current.startIdx; i <= last; i++) lead.push({ x: i - current.startIdx, y: r1(dd[i]) });
  else for (let i = Math.max(0, last - 20); i <= last; i++) lead.push({ x: i - last, y: r1(dd[i]) });
  let bucket: BranchSheet['bucket'] = null;
  if (current && current.acc != null) {
    const fast = current.acc <= 3;
    const same = judgedEps.filter((e) => e.acc != null && (fast ? e.acc <= 3 : e.acc >= 4));
    bucket = { label: fast ? '0〜3日（高速）' : '4日以上（低速）', n: same.length, rates: TH.map((t) => ({ threshold: Math.round(t * 100), share: rateOf(same, t) })), medianDD: r1(-median(same.map((e) => e.maxDD * 100))) };
  }
  const zone = state === 'normal' ? athZoneSheet(s)?.base.outcomes ?? null : null;
  return {
    state, lead, total: done.length, judged: judgedEps.length, recovered: done.length - judgedEps.length, bucket,
    judgedRates: TH.map((t) => ({ threshold: Math.round(t * 100), share: rateOf(judgedEps, t) })),
    acc: current?.acc ?? null, elapsed: current ? last - current.startIdx : 0, ddNow: r1(dd[last]), zone,
  };
}

// ---------------------------------------------------------------- S10 1日で1%超下がったら
export interface DropDaySheet {
  threshold: number; count: number; perYear: number; nextUp: number; nextDown: number;
  horizons: { label: string; days: number; afterDrop: number; allDays: number }[];
}
export function dropDaySheet(s: PricePoint[], threshold = -1): DropDaySheet | null {
  const last = s.length - 1;
  if (last < 600) return null;
  const H = [{ label: '翌営業日', days: 1 }, { label: '1週間後', days: 5 }, { label: '1ヶ月後', days: 21 }, { label: '3ヶ月後', days: 63 }];
  const drops: number[] = [];
  for (let i = 1; i <= last; i++) if ((s[i].close / s[i - 1].close - 1) * 100 <= threshold) drops.push(i);
  if (drops.length < 30) return null;
  const nx = drops.filter((i) => i + 1 <= last);
  const up = nx.filter((i) => s[i + 1].close > s[i].close).length, down = nx.filter((i) => s[i + 1].close < s[i].close).length;
  const avgAfter = (idx: number[], d: number) => { const v = idx.filter((i) => i + d <= last).map((i) => (s[i + d].close / s[i].close - 1) * 100); return r2(mean(v)); };
  const all = Array.from({ length: last }, (_, k) => k + 1);
  const years = (Date.parse(s[last].date) - Date.parse(s[0].date)) / (365.2425 * 864e5);
  return {
    threshold, count: drops.length, perYear: r1(drops.length / years), nextUp: r1((up / nx.length) * 100), nextDown: r1((down / nx.length) * 100),
    horizons: H.map((h) => ({ ...h, afterDrop: avgAfter(drops, h.days), allDays: avgAfter(all, h.days) })),
  };
}

// ---------------------------------------------------------------- S12 最高値更新のペース（16区分）
export interface AthPaceSheet {
  count: number; perYear: number; thisYear: number; year: number; elapsed: number;
  bins: { label: string; min: number; max: number | null; count: number }[]; currentBin: number;
}
const PACE_BINS: [number, number | null][] = [[1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 7], [8, 10], [11, 15], [16, 20], [21, 30], [31, 40], [41, 60], [61, 80], [81, 100], [101, 120], [121, null]];
export function athPaceSheet(s: PricePoint[]): AthPaceSheet | null {
  const last = s.length - 1;
  if (last < 600) return null;
  const ath: number[] = [];
  let peak = s[0].close;
  for (let i = 1; i <= last; i++) if (s[i].close > peak) { peak = s[i].close; ath.push(i); }
  if (ath.length < 10) return null;
  const gaps = ath.slice(1).map((v, k) => v - ath[k]);
  const year = yearOf(s[last].date);
  const elapsed = last - ath[ath.length - 1];
  const bins = PACE_BINS.map(([min, max]) => ({ label: max == null ? `${min}日〜` : min === max ? `${min}日` : `${min}〜${max}日`, min, max, count: gaps.filter((g) => g >= min && (max == null || g <= max)).length }));
  const currentBin = elapsed <= 0 ? 0 : bins.findIndex((b) => elapsed >= b.min && (b.max == null || elapsed <= b.max));
  const years = (Date.parse(s[last].date) - Date.parse(s[0].date)) / (365.2425 * 864e5);
  return { count: ath.length, perYear: r1(ath.length / years), thisYear: ath.filter((i) => yearOf(s[i].date) === year).length, year, elapsed, bins, currentBin };
}

// ---------------------------------------------------------------- S16 年初来パス比較
export interface YtdPathsSheet {
  year: number; k: number; current: XY[]; past: { year: number; path: XY[] }[]; avg: XY[];
  ytdNow: number; avgAtK: number; rankPct: number; nYears: number;
  outlook: { x: number; lo: number; mid: number; hi: number; mean: number }[];
}
export function ytdPathsSheet(s: PricePoint[], step = 5): YtdPathsSheet | null {
  const last = s.length - 1, year = yearOf(s[last].date);
  const ranges = yearRanges(s);
  const pathOf = (y: number, upto?: number): number[] => {
    const r = ranges.get(y)!;
    const base = s[r.first - 1].close;
    const end = upto != null ? Math.min(r.last, r.first + upto) : r.last;
    const out: number[] = [];
    for (let i = r.first; i <= end; i++) out.push((s[i].close / base - 1) * 100);
    return out;
  };
  const cur = ranges.get(year)!;
  if (cur.first === 0) return null;
  const k = last - cur.first;
  const complete = [...ranges.keys()].filter((y) => y < year && ranges.get(y)!.first > 0 && ranges.get(y)!.last - ranges.get(y)!.first >= 240);
  if (complete.length < 5) return null;
  const full = complete.map((y) => ({ year: y, p: pathOf(y) }));
  const thinPath = (p: number[]): XY[] => p.map((v, t) => ({ x: t, y: r1(v) })).filter((pt, t) => t % step === 0 || t === p.length - 1);
  const curPath = pathOf(year);
  const maxLen = Math.max(...full.map((f) => f.p.length));
  const avg: XY[] = [];
  for (let t = 0; t < maxLen; t++) {
    const v = full.map((f) => f.p[t]).filter((x) => x != null);
    if (v.length < full.length / 2) break; // 営業日の多い一部の年だけになった末尾は平均にしない
    if (t % step === 0) avg.push({ x: t, y: r1(mean(v)) });
  }
  const atK = full.map((f) => f.p[Math.min(k, f.p.length - 1)]);
  const ytdNow = curPath[curPath.length - 1];
  const rankPct = r1((atK.filter((v) => v > ytdNow).length / atK.length) * 100);
  // 今年の残りの期間に、過去各年の「同じ日から年末まで」の値動きをそのまま当てはめた場合のレンジ
  const outlook: YtdPathsSheet['outlook'] = [];
  for (let t = k; t < maxLen; t += step) {
    const v = full.filter((f) => f.p.length > t).map((f) => ((1 + ytdNow / 100) * (1 + f.p[t] / 100) / (1 + f.p[Math.min(k, f.p.length - 1)] / 100) - 1) * 100).sort((a, b) => a - b);
    if (v.length) outlook.push({ x: t, lo: r1(quantile(v, 0.1)), mid: r1(quantile(v, 0.5)), hi: r1(quantile(v, 0.9)), mean: r1(mean(v)) });
  }
  return { year, k, current: thinPath(curPath), past: full.map((f) => ({ year: f.year, path: thinPath(f.p) })), avg, ytdNow: r1(ytdNow), avgAtK: r1(mean(atK)), rankPct, nYears: full.length, outlook };
}

// ---------------------------------------------------------------- S17-23 将来シナリオ
export interface ScenarioYear { year: number; path: XY[]; score: number }
export interface ScenarioSheet {
  key: string; title: string; conditionText: string; n: number; relaxed: boolean;
  years: ScenarioYear[]; median: XY[];
  marks: { label: string; x: number; y: number | null }[];
  range3y: { lo: number; hi: number } | null;
}
export interface ScenarioState { k: number; ytd: number; upRatio: number; daysSinceATH: number; termYear: number; vol20: number }
export interface ScenariosSheet { year: number; asOf: string; state: ScenarioState; scenarios: ScenarioSheet[]; lead: XY[] }
export function scenariosSheet(s: PricePoint[], forward = 756, step = 5): ScenariosSheet | null {
  const last = s.length - 1, year = yearOf(s[last].date);
  const ranges = yearRanges(s);
  const cur = ranges.get(year)!;
  if (!cur || cur.first === 0) return null;
  const k = last - cur.first;
  const { athIdx } = drawdowns(s);
  const stateAt = (anchor: number, first: number): ScenarioState => {
    const base = s[first - 1].close;
    let up = 0, n = 0;
    for (let i = first; i <= anchor; i++) { n++; if (s[i].close > s[i - 1].close) up++; }
    const rets: number[] = [];
    for (let i = Math.max(1, anchor - 19); i <= anchor; i++) rets.push((s[i].close / s[i - 1].close - 1) * 100);
    const m = mean(rets);
    const vol = Math.sqrt(mean(rets.map((r) => (r - m) ** 2)));
    return { k, ytd: (s[anchor].close / base - 1) * 100, upRatio: (up / n) * 100, daysSinceATH: anchor - athIdx[anchor], termYear: termYearOf(yearOf(s[anchor].date)), vol20: vol };
  };
  const now = stateAt(last, cur.first);
  const cands = [...ranges.entries()].filter(([y, r]) => y < year && r.first > 0 && r.first + k <= r.last).map(([y, r]) => {
    const anchor = r.first + k;
    return { year: y, anchor, st: stateAt(anchor, r.first) };
  });
  const athTol = Math.max(5, now.daysSinceATH * 0.5);
  const conds: Record<string, (c: typeof cands[number]) => boolean> = {
    ytd: (c) => Math.abs(c.st.ytd - now.ytd) <= 7,
    up: (c) => Math.abs(c.st.upRatio - now.upRatio) <= 4,
    ath: (c) => Math.abs(c.st.daysSinceATH - now.daysSinceATH) <= athTol,
    term: (c) => c.st.termYear === now.termYear,
    vol: (c) => Math.abs(c.st.vol20 / now.vol20 - 1) <= 0.16,
  };
  const dist = (c: typeof cands[number]) => Math.abs(c.st.ytd - now.ytd) / 7 + Math.abs(c.st.upRatio - now.upRatio) / 4 + Math.abs(c.st.daysSinceATH - now.daysSinceATH) / athTol + (c.st.termYear === now.termYear ? 0 : 1) + Math.abs(c.st.vol20 / now.vol20 - 1) / 0.16;
  const pathFrom = (anchor: number): XY[] => {
    const out: XY[] = [];
    for (let t = 0; t <= forward && anchor + t <= last; t++) if (t % step === 0 || t === forward || anchor + t === last) out.push({ x: t, y: pctOf(s[anchor].close, s[anchor + t].close) });
    return out;
  };
  const daysToYearEnd = Math.max(1, 251 - k);
  const fmt = (v: number, d = 1) => `${v >= 0 ? '+' : ''}${v.toFixed(d)}`;
  const build = (key: string, title: string, conditionText: string, keys: string[]): ScenarioSheet => {
    let picked = cands.filter((c) => keys.every((kk) => conds[kk](c)));
    let relaxed = false;
    if (picked.length < 3) {
      relaxed = true;
      picked = [...cands].sort((a, b) => keys.filter((kk) => !conds[kk](a)).length - keys.filter((kk) => !conds[kk](b)).length || dist(a) - dist(b)).slice(0, 3);
    }
    const years = picked.map((c) => ({ year: c.year, path: pathFrom(c.anchor), score: r2(dist(c)) }));
    const xs = new Set<number>();
    years.forEach((y) => y.path.forEach((p) => xs.add(p.x)));
    const med: XY[] = [...xs].sort((a, b) => a - b).map((x) => {
      const v = years.map((y) => y.path.find((p) => p.x === x)?.y).filter((v): v is number => v != null);
      return v.length >= Math.max(1, Math.ceil(years.length / 2)) ? { x, y: r1(median(v)) } : null;
    }).filter((p): p is XY => !!p);
    const at = (x: number) => { let best: XY | null = null; for (const p of med) if (p.x <= x) best = p; return best && x - best.x <= step ? best.y : null; };
    const marks = [
      { label: '年末', x: daysToYearEnd }, { label: '6ヶ月後', x: 126 }, { label: '1年後', x: 252 }, { label: '3年後', x: 756 },
    ].map((m) => ({ ...m, y: at(m.x) }));
    const end3 = years.map((y) => y.path.find((p) => p.x === forward)?.y).filter((v): v is number => v != null);
    return { key, title, conditionText, n: picked.length, relaxed, years, median: med, marks, range3y: end3.length ? { lo: Math.min(...end3), hi: Math.max(...end3) } : null };
  };
  const scenarios: ScenarioSheet[] = [
    build('ytd', '年初来騰落率が似た年', `年初来${fmt(now.ytd)}%（±7ポイント以内）`, ['ytd']),
    build('up', '上昇日の割合が似た年', `年初来の上昇日の割合${now.upRatio.toFixed(0)}%（±4ポイント以内）`, ['up']),
    build('ytdUp', '2つの条件が重なった年', '年初来騰落率と上昇日の割合の両方が近い', ['ytd', 'up']),
    build('ath', '最高値からの日数が似た年', `最高値の更新から${now.daysSinceATH}営業日（±${Math.round(athTol)}営業日以内）`, ['ath']),
    build('term', '大統領任期の同じ年', `大統領任期${now.termYear}年目`, ['term']),
    build('vol', '値動きの荒さが似た年', `直近20営業日の1日の変動率${now.vol20.toFixed(2)}%（±16%以内）`, ['vol']),
    build('all', '5つの条件が重なった年', '年初来騰落率・上昇日の割合・最高値からの日数・大統領任期・値動きの荒さ', ['ytd', 'up', 'ath', 'term', 'vol']),
  ];
  // 今年の年初からの実際の値動き（今日＝0%に揃える。将来シナリオ⑦で「実績線→予測」をひと続きに描く）
  const lead: XY[] = [];
  for (let i = cur.first - 1; i <= last; i++) if ((i - last) % step === 0 || i === last || i === cur.first - 1) lead.push({ x: i - last, y: pctOf(s[last].close, s[i].close) });
  return { year, asOf: s[last].date, state: { ...now, ytd: r1(now.ytd), upRatio: r1(now.upRatio), vol20: r2(now.vol20) }, scenarios, lead };
}

// ---------------------------------------------------------------- S24 まとめの事実
export interface FactsSheet {
  years: number; startYear: number; multiple: number; cagr: number;
  negativeYearShare: number; completeYears: number;
  dd3PerYear: number; dd5Share: number;
  longestYears: number; longestFrom: string; longestTo: string | null;
  crash50: number; maxDD: number;
  athThisYear: number; year: number;
}
export function factsSheet(s: PricePoint[]): FactsSheet | null {
  const t = titleSheet(s), h = ddHistorySheet(s);
  if (!t || !h) return null;
  const last = s.length - 1, year = yearOf(s[last].date);
  const ranges = yearRanges(s);
  const complete = [...ranges.entries()].filter(([y, r]) => y < year && r.first > 0);
  const neg = complete.filter(([, r]) => s[r.last].close < s[r.first - 1].close).length;
  const { episodes } = extractEpisodes(s);
  const done = episodes.filter((e) => e.endDate);
  const { dd } = drawdowns(s);
  // −50%を超えた下落局面の数（水面下の期間ごと）
  let crash50 = 0, inP = false, deep = false;
  for (let i = 0; i <= last; i++) {
    if (dd[i] < 0) { inP = true; if (dd[i] <= -50) deep = true; }
    else if (inP) { if (deep) crash50++; inP = false; deep = false; }
  }
  if (inP && deep) crash50++;
  let ath = 0, peak = -Infinity;
  s.forEach((p) => { if (p.close > peak) { peak = p.close; if (yearOf(p.date) === year) ath++; } });
  return {
    years: Math.round(t.years), startYear: yearOf(t.startDate), multiple: t.multiple, cagr: t.cagr,
    negativeYearShare: r1((neg / complete.length) * 100), completeYears: complete.length,
    dd3PerYear: r1(episodes.length / t.years), dd5Share: r1((done.filter((e) => e.judgeIdx != null).length / Math.max(1, done.length)) * 100),
    longestYears: h.longest?.years ?? 0, longestFrom: h.longest?.peakDate ?? '', longestTo: h.longest?.recoveryDate ?? null,
    crash50, maxDD: h.maxDD, athThisYear: ath, year,
  };
}

// ---------------------------------------------------------------- まとめて計算
export interface Sp500Sheets {
  asOf: string; title: TitleSheet | null; zoom: ZoomSheet | null; upDown: UpDownSheet | null;
  ddOverlay: DdOverlaySheet | null; ddHistory: DdHistorySheet | null; athZone: AthZoneSheet | null;
  ytdPaths: YtdPathsSheet | null; scenarios: ScenariosSheet | null; facts: FactsSheet | null;
  ddDefinition: DdDefinitionSheet | null; branch: BranchSheet | null; dropDay: DropDaySheet | null; athPace: AthPaceSheet | null;
}
export function computeSp500Sheets(points: InPoint[]): Sp500Sheets | null {
  const s = prepareSeries(points);
  if (s.length < 600) return null;
  const safe = <T,>(f: () => T): T | null => { try { return f(); } catch { return null; } };
  return {
    asOf: s[s.length - 1].date,
    title: safe(() => titleSheet(s)), zoom: safe(() => zoomSheet(s)), upDown: safe(() => upDownSheet(s)),
    ddOverlay: safe(() => ddOverlaySheet(s)), ddHistory: safe(() => ddHistorySheet(s)), athZone: safe(() => athZoneSheet(s)),
    ytdPaths: safe(() => ytdPathsSheet(s)), scenarios: safe(() => scenariosSheet(s)), facts: safe(() => factsSheet(s)),
    ddDefinition: safe(() => ddDefinitionSheet(s)), branch: safe(() => branchSheet(s)), dropDay: safe(() => dropDaySheet(s)), athPace: safe(() => athPaceSheet(s)),
  };
}
