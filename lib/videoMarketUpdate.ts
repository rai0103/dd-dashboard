// S&P500の近況（年初来・ATH・上昇日数・年末までの過去実績・暴落の発生率）の集計と、ナレーション文の生成。
// 評価額（ドル）は扱わず、騰落率（%）・日数・回数だけで表現する。
// [dd-dashboard移植版] investment-shorts (lib/marketUpdate.ts) を移植。computeUpdateStatsはMDテキストではなく
// dd-dashboardがすでに持つcrashFrequency配列から直接組み立てたCrashRow[]を受け取る（parseCrashTableは未使用）。
import { StockDataPoint } from './videoTypes';
import { buildYearSeries, YearPoint } from './videoYearTrajectory';
import { integerToKana, numberStringToKana, yearsToKana } from './videoReading';

export interface CrashRow {
  level: number;        // 10, 15, 20 …（DD-○%超）
  count: number;
  reference: boolean;   // 参考値（件数が少ない）
  intervalYears: number | null;
  intervalText: string; // 例：3年に1度
  lastYear: number | null;
  elapsedYears: number | null;
  prob1y: number;       // 今後1年以内の確率（%）
}

export interface CrashEx { level: number; name: string; interval: string; lastYear: number | null; years: number[]; }

export interface UpdateStats {
  crashEx?: CrashEx[];
  asOf: string;                 // 最終日 YYYY-MM-DD
  year: number;
  md: string;                   // 例 10/19
  month: number;
  day: number;
  ytd: number;                  // 年初来（%）
  ytdPath: YearPoint[];         // 前年末=100
  dayChange: number;            // 昨日比（%）
  oneYear: number | null;       // 直近1年（%）
  last10: number[];             // 直近10営業日の日次騰落率（%）
  pastYtd: { year: number; ret: number }[];  // 過去の同時期の年初来
  ytdRank: number;              // 過去の年も含めた順位（1が最高）
  ytdMedian: number;
  ytdAvg: number;
  athDate: string;
  athDays: number;              // ATH更新からの経過日数（暦日）
  athTradingDays: number;       // 同・営業日
  dd: number;                   // ATHからの下落率（%・0以下）
  ddPath: { t: number; dd: number }[]; // 当年の下落率の推移
  ddMin: number;                // 当年の最大下落（%）
  ddMinDate: string;
  athEvents: { t: number; date: string }[]; // 当年のATH更新日
  athCount: number;
  athLastIsThisYear: boolean;
  pastAthCounts: { year: number; count: number }[];
  athAvg: number;
  up: number;
  down: number;
  upRatio: number;              // 上昇日の割合（%）
  pastUpRatios: { year: number; ratio: number }[];
  upRatioAvg: number;
  upAvg: number;
  downAvg: number;
  outlook: {
    n: number;
    paths: { year: number; pts: { t: number; v: number }[]; end: number }[];
    posCount: number;
    posProb: number;            // 年末までに上昇した年の割合（%）
    median: number;
    p25: number;
    p75: number;
    keepPlusProb: number;       // 年間プラスを維持できた割合（%）
    simN: number;               // 同程度の年初来だった年
    simPos: number;
  };
  crash: CrashRow[] | null;
}

const DAY = 86400000;
const toMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
const dstr = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** [dd-dashboard移植版では未使用] 暴落発生確率の表（MDテキスト）を読む。computeUpdateStatsはcrashRowsを直接受け取るためこの関数は呼ばれない。型チェック用に残置 */
export function parseCrashTable(text: string): CrashRow[] | null {
  const rows: CrashRow[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.normalize('NFKC').match(/^DD-(\d+)%超\s*\|\s*(\d+)件(\(参考値\))?\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*([\d.]+)%/);
    if (!m) continue;
    const cols = raw.normalize('NFKC').split('|').map(c => c.trim());
    const iv = cols[2]?.match(/([\d.]+)年に1度/);
    const last = cols[3]?.match(/(\d{4})年(?:\(([\d.]+)年経過\))?/);
    rows.push({
      level: parseInt(m[1], 10),
      count: parseInt(m[2], 10),
      reference: !!m[3],
      intervalYears: iv ? parseFloat(iv[1]) : null,
      intervalText: cols[2] ?? '',
      lastYear: last ? parseInt(last[1], 10) : null,
      elapsedYears: last && last[2] ? parseFloat(last[2]) : null,
      prob1y: parseFloat(m[6]),
    });
  }
  return rows.length > 0 ? rows : null;
}

export function computeUpdateStats(daily: StockDataPoint[], crashRows: CrashRow[] | null): UpdateStats | null {
  const n = daily.length;
  if (n < 300) return null;
  const dates = daily.map(d => d.date);
  const cl = daily.map(d => d.close);
  const asOf = dates[n - 1];
  const year = parseInt(asOf.slice(0, 4), 10);
  const month = parseInt(asOf.slice(5, 7), 10);
  const day = parseInt(asOf.slice(8, 10), 10);
  const firstYear = parseInt(dates[0].slice(0, 4), 10);

  // 指定日以前で最後のデータの位置
  const idxAtOrBefore = (target: string): number => {
    let lo = 0, hi = n - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (dates[mid] <= target) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  };

  const iPrevEnd = idxAtOrBefore(dstr(year - 1, 12, 31));
  if (iPrevEnd < 0) return null;
  const ytd = (cl[n - 1] / cl[iPrevEnd] - 1) * 100;
  const ytdSeries = buildYearSeries(daily, year, '', asOf);
  if (!ytdSeries) return null;

  const dayChange = (cl[n - 1] / cl[n - 2] - 1) * 100;
  const i1y = idxAtOrBefore(dstr(year - 1, month, day));
  const oneYear = i1y >= 0 && dates[i1y] >= dstr(year - 1, month, 1) ? (cl[n - 1] / cl[i1y] - 1) * 100 : null;
  const last10: number[] = [];
  for (let i = n - 10; i < n; i++) last10.push((cl[i] / cl[i - 1] - 1) * 100);

  // 過去の同時期（同じ月日まで）の年初来
  const pastYtd: { year: number; ret: number }[] = [];
  for (let y = firstYear + 1; y < year; y++) {
    const a = idxAtOrBefore(dstr(y - 1, 12, 31));
    const b = idxAtOrBefore(dstr(y, month, day));
    if (a < 0 || b < 0 || dates[a] < dstr(y - 1, 12, 20) || dates[b] < dstr(y, month, 1)) continue;
    pastYtd.push({ year: y, ret: (cl[b] / cl[a] - 1) * 100 });
  }
  const sortedRet = pastYtd.map(p => p.ret).sort((a, b) => a - b);
  const median = (arr: number[]) => (arr.length ? (arr.length % 2 ? arr[(arr.length - 1) / 2] : (arr[arr.length / 2 - 1] + arr[arr.length / 2]) / 2) : 0);
  const ytdRank = 1 + pastYtd.filter(p => p.ret > ytd).length;

  // ATH・下落率
  let runMax = -Infinity;
  let athIdx = 0;
  const isAth: boolean[] = new Array(n).fill(false);
  const ddArr: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (cl[i] > runMax) { runMax = cl[i]; athIdx = i; isAth[i] = i > 0; }
    ddArr[i] = (cl[i] / runMax - 1) * 100;
  }
  const dd = ddArr[n - 1];
  const athDate = dates[athIdx];
  const athDays = Math.round((toMs(asOf) - toMs(athDate)) / DAY);
  const athTradingDays = n - 1 - athIdx;

  const t0 = toMs(dstr(year, 1, 1));
  const tFrac = (d: string) => {
    const m = parseInt(d.slice(5, 7), 10), dd2 = parseInt(d.slice(8, 10), 10);
    const dim = new Date(year, m, 0).getDate();
    return ((m - 1) + (dd2 - 1) / dim) / 12;
  };
  void t0;
  const ddPath: { t: number; dd: number }[] = [{ t: 0, dd: ddArr[iPrevEnd] }];
  const athEvents: { t: number; date: string }[] = [];
  let ddMin = 0, ddMinDate = '';
  for (let i = iPrevEnd + 1; i < n; i++) {
    ddPath.push({ t: tFrac(dates[i]), dd: ddArr[i] });
    if (isAth[i]) athEvents.push({ t: tFrac(dates[i]), date: dates[i] });
    if (ddArr[i] < ddMin) { ddMin = ddArr[i]; ddMinDate = dates[i]; }
  }

  // 過去の同時期のATH更新回数・上昇日の割合
  const pastAthCounts: { year: number; count: number }[] = [];
  const pastUpRatios: { year: number; ratio: number; up: number; down: number }[] = [];
  for (let y = firstYear + 1; y < year; y++) {
    const a = idxAtOrBefore(dstr(y - 1, 12, 31));
    const b = idxAtOrBefore(dstr(y, month, day));
    if (a < 0 || b < 0 || dates[a] < dstr(y - 1, 12, 20) || dates[b] < dstr(y, month, 1)) continue;
    let c = 0, u = 0, d = 0;
    for (let i = a + 1; i <= b; i++) {
      if (isAth[i]) c++;
      if (cl[i] > cl[i - 1]) u++; else if (cl[i] < cl[i - 1]) d++;
    }
    pastAthCounts.push({ year: y, count: c });
    pastUpRatios.push({ year: y, ratio: (u / Math.max(1, u + d)) * 100, up: u, down: d });
  }
  let up = 0, down = 0;
  for (let i = iPrevEnd + 1; i < n; i++) { if (cl[i] > cl[i - 1]) up++; else if (cl[i] < cl[i - 1]) down++; }
  const upRatio = (up / Math.max(1, up + down)) * 100;
  const avg = (arr: number[]) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0);

  // 年末までの過去実績（この日から年末まで）
  const paths: UpdateStats['outlook']['paths'] = [];
  const rems: number[] = [];
  let keepPlus = 0, simN = 0, simPos = 0;
  for (const p of pastYtd) {
    const y = p.year;
    const a = idxAtOrBefore(dstr(y, month, day));
    const e = idxAtOrBefore(dstr(y, 12, 31));
    if (a < 0 || e <= a) continue;
    const span = toMs(dates[e]) - toMs(dates[a]);
    const pts: { t: number; v: number }[] = [];
    const step = Math.max(1, Math.floor((e - a) / 40));
    for (let i = a; i <= e; i += step) pts.push({ t: span > 0 ? (toMs(dates[i]) - toMs(dates[a])) / span : 0, v: (cl[i] / cl[a]) * 100 });
    if (pts[pts.length - 1].t < 1) pts.push({ t: 1, v: (cl[e] / cl[a]) * 100 });
    const end = (cl[e] / cl[a] - 1) * 100;
    paths.push({ year: y, pts, end });
    rems.push(end);
    // 現在の年初来を前提に、年末にプラスのまま終えるか
    if ((1 + ytd / 100) * (1 + end / 100) - 1 > 0) keepPlus++;
    if (Math.abs(p.ret - ytd) <= 6) { simN++; if (end > 0) simPos++; }
  }
  const sortedRem = [...rems].sort((a, b) => a - b);
  const q = (arr: number[], r: number) => (arr.length ? arr[Math.min(arr.length - 1, Math.max(0, Math.round((arr.length - 1) * r)))] : 0);
  const posCount = rems.filter(r => r > 0).length;

  return {
    asOf, year, md: `${month}/${day}`, month, day,
    ytd, ytdPath: ytdSeries.points, dayChange, oneYear, last10,
    pastYtd, ytdRank, ytdMedian: median(sortedRet), ytdAvg: avg(pastYtd.map(p => p.ret)),
    athDate, athDays, athTradingDays, dd, ddPath, ddMin, ddMinDate,
    athEvents, athCount: athEvents.length,
    athLastIsThisYear: athEvents.length > 0 && athEvents[athEvents.length - 1].date === athDate,
    pastAthCounts, athAvg: avg(pastAthCounts.map(p => p.count)),
    up, down, upRatio, pastUpRatios: pastUpRatios.map(p => ({ year: p.year, ratio: p.ratio })),
    upRatioAvg: avg(pastUpRatios.map(p => p.ratio)),
    upAvg: avg(pastUpRatios.map(p => p.up)), downAvg: avg(pastUpRatios.map(p => p.down)),
    outlook: {
      n: paths.length, paths, posCount,
      posProb: paths.length ? (posCount / paths.length) * 100 : 0,
      median: median(sortedRem), p25: q(sortedRem, 0.25), p75: q(sortedRem, 0.75),
      keepPlusProb: paths.length ? (keepPlus / paths.length) * 100 : 0,
      simN, simPos,
    },
    crash: crashRows,
  };
}

// ---------- 表示用の文字列・読み ----------

export const fmtPct = (v: number, digits = 1) => `${v >= 0 ? '+' : '-'}${Math.abs(v).toFixed(digits)}%`;
export const fmtPlain = (v: number, digits = 1) => `${Math.abs(v).toFixed(digits)}%`;

export const pctKana = (v: number, signed = true) => {
  const a = Math.abs(v).toFixed(1);
  const sign = !signed || Number(a) === 0 ? '' : v >= 0 ? 'ぷらす' : 'まいなす';
  return `${sign}${numberStringToKana(a)}ぱーせんと`;
};
const MONTH_K = ['', 'いちがつ', 'にがつ', 'さんがつ', 'しがつ', 'ごがつ', 'ろくがつ', 'しちがつ', 'はちがつ', 'くがつ', 'じゅうがつ', 'じゅういちがつ', 'じゅうにがつ'];
const DAY_K: Record<number, string> = {
  1: 'ついたち', 2: 'ふつか', 3: 'みっか', 4: 'よっか', 5: 'いつか', 6: 'むいか', 7: 'なのか', 8: 'ようか', 9: 'ここのか', 10: 'とおか',
  14: 'じゅうよっか', 20: 'はつか', 24: 'にじゅうよっか',
};
export const dayKana = (d: number) => {
  if (DAY_K[d]) return DAY_K[d];
  if (d > 10 && d % 10 === 9) return `${integerToKana(d - 9)}くにち`;   // 19日 → じゅうくにち
  if (d > 10 && d % 10 === 7) return `${integerToKana(d - 7)}しちにち`; // 17日 → じゅうしちにち
  return `${integerToKana(d)}にち`;
};
export const monthDayKana = (m: number, d: number) => `${MONTH_K[m]}${dayKana(d)}`;
const ONES_KAI = ['', 'いっかい', 'にかい', 'さんかい', 'よんかい', 'ごかい', 'ろっかい', 'ななかい', 'はっかい', 'きゅうかい'];
export const countKai = (n: number): string => {
  if (n <= 0) return 'ぜろかい';
  if (n >= 100) return `${integerToKana(n)}かい`;
  const o = n % 10;
  if (o === 0) return `${integerToKana(n).replace(/じゅう$/, 'じゅっ')}かい`;
  return `${n - o > 0 ? integerToKana(n - o) : ''}${ONES_KAI[o]}`;
};
export const nichiKana = (n: number) => (n <= 31 ? dayKana(n) : `${integerToKana(n)}にち`);
export const hitoKana = (n: number) => `${integerToKana(n)}ねん`;
export const intervalKana = (r: CrashRow) => {
  if (r.intervalYears === null) return '';
  const v = r.intervalYears;
  return Number.isInteger(v) ? `${yearsToKana(v)}に、いちど` : `${numberStringToKana(v.toFixed(1))}ねんに、いちど`;
};
export const levelKana = (level: number) => `${integerToKana(level)}ぱーせんと`.replace('じゅうぱー', 'じゅっぱー').replace('にじゅうぱー', 'にじゅっぱー').replace('さんじゅうぱー', 'さんじゅっぱー').replace('よんじゅうぱー', 'よんじゅっぱー');

const CRASH_NAMES: Record<number, string> = { 10: '調整', 20: '弱気相場', 30: '大暴落', 50: 'リーマンショック級' };
/** 調整〜暴落の例示（確率は使わない）：サマリーmd由来があればそれ、なければ表の10/20/30% */
export function crashList(s: UpdateStats): CrashEx[] {
  if (s.crashEx && s.crashEx.length) return s.crashEx;
  return (s.crash ?? []).filter(r => [10, 20, 30].includes(r.level)).map(r => ({ level: r.level, name: CRASH_NAMES[r.level], interval: r.intervalText, lastYear: r.lastYear, years: [] }));
}
const ivKanaTxt = (t: string): string => { const m = t.match(/([\d.]+)年に1度/); if (!m) return 'ごくまれに'; const v = m[1]; const base = v.includes('.') ? `${numberStringToKana(v)}ねんに、いちど` : `${yearsToKana(+v)}に、いちど`; return /^約/.test(t) ? `やく、${base}` : base; };

export interface UpdateScene {
  id: 'open' | 'ytd' | 'ytdvs' | 'ath' | 'athcount' | 'updown' | 'outlook' | 'crash' | 'end';
  reading: string;   // 読み上げ（ひらがな）
  minSec: number;    // 最短の長さ（秒）。音声が長ければ延びる
}

export function buildUpdateScenes(s: UpdateStats): UpdateScene[] {
  const sc: UpdateScene[] = [];
  const md = monthDayKana(s.month, s.day);
  sc.push({ id: 'open', minSec: 3.5, reading: `えすあんどぴーごひゃくの、きんきょうを、かいせつします。べいこくじかんの、${md}、じてんの、でーたです。` });

  sc.push({
    id: 'ytd', minSec: 7,
    reading: `ことしの、ねんしょうらいは、${pctKana(s.ytd)}。さくじつひは、${pctKana(s.dayChange)}。${s.oneYear !== null ? `ちょっきんの、いちねんでは、${pctKana(s.oneYear)}です。` : ''}`,
  });

  const N = s.pastYtd.length;
  const side = s.ytdRank <= N / 2 ? 'たかいほうから' : 'ひくいほうから';
  const rank = s.ytdRank <= N / 2 ? s.ytdRank : N + 2 - s.ytdRank;
  sc.push({
    id: 'ytdvs', minSec: 7,
    reading: `かこ、${hitoKana(N)}の、おなじじきと、くらべると、${side}、${integerToKana(rank)}ばんめの、せいせきです。かこの、ちゅうおうちは、${pctKana(s.ytdMedian)}です。`,
  });

  sc.push({
    id: 'ath', minSec: 7,
    reading: s.dd >= -0.005
      ? `きょうは、さいたかねを、こうしんしました。ことしの、さいだいの、げらくりつは、${pctKana(s.ddMin, false)}でした。`
      : `さいたかねの、こうしんから、${nichiKana(s.athDays)}、けいかしました。いまは、さいたかねから、${pctKana(s.dd)}の、いちです。ことしの、さいだいの、げらくりつは、${pctKana(s.ddMin, false)}でした。`,
  });

  sc.push({
    id: 'athcount', minSec: 6.5,
    reading: s.athCount > 0
      ? `ことしは、さいたかねを、${countKai(s.athCount)}、こうしんしました。${s.athLastIsThisYear ? `さいごの、こうしんは、${monthDayKana(parseInt(s.athDate.slice(5, 7), 10), parseInt(s.athDate.slice(8, 10), 10))}の、${countKai(s.athCount)}めです。` : ''}かこの、おなじじきの、へいきんは、やく、${countKai(Math.max(1, Math.round(s.athAvg)))}です。`
      : 'ことしは、まだ、さいたかねを、こうしんしていません。',
  });

  sc.push({
    id: 'updown', minSec: 6.5,
    reading: `ことしの、じょうしょうびは、${nichiKana(s.up)}、げらくびは、${nichiKana(s.down)}。じょうしょうびの、わりあいは、${pctKana(s.upRatio, false)}。かこの、へいきんは、${pctKana(s.upRatioAvg, false)}です。`,
  });

  const o = s.outlook;
  sc.push({
    id: 'outlook', minSec: 9,
    reading: `かこ、${hitoKana(o.n)}の、じっせきでは、${md}から、ねんまつまでに、じょうしょうした、ねんは、${integerToKana(o.posCount)}ねん。かくりつは、${pctKana(o.posProb, false)}。ちゅうおうちは、${pctKana(o.median)}です。ことしの、ぷらすを、ねんまつまで、いじできた、かくりつは、${pctKana(o.keepPlusProb, false)}です。`,
  });

  const cl = crashList(s);
  if (cl.length) {
    let r = 'ちょうせいから、ぼうらくの、じっさいの、ひんどです。';
    cl.forEach(e => {
      const last = e.lastYear ? `ぜんかいは、${yearsToKana(e.lastYear)}に、はっせいしました` : '';
      const iv = ivKanaTxt(e.interval);
      if (e.level === 50) r += `りーまんしょっくれべるの、まいなす、ごじゅっぱーせんといじょうの、だいぼうらくは、${iv}の、ひんどですが、${last}。`;
      else r += `まいなす、${levelKana(e.level)}は、${iv}。${last}。`;
    });
    sc.push({ id: 'crash', minSec: 12, reading: r });
  }

  sc.push({
    id: 'end', minSec: 6,
    reading: `いじょうが、えすあんどぴーごひゃくの、きんきょうです。あなたは、${yearsToKana(s.year).replace(/ねん$/, '')}ねんまつの、えすあんどぴーごひゃくは、どうなると、おもいますか？`,
  });
  return sc;
}

export function buildUpdateTitle(s: UpdateStats): string {
  return `S&P500の近況（${s.asOf.replace(/-/g, '/')}時点）年初来${fmtPct(s.ytd)}・過去実績で見る年末の確率`.slice(0, 100);
}

export function buildUpdateDescription(s: UpdateStats, disclaimers: string[]): string {
  const L: string[] = [];
  L.push(buildUpdateTitle(s));
  L.push('');
  L.push(`米国時間 ${s.asOf.replace(/-/g, '/')} 時点の、S&P500の近況を解説します。（VOOのデータをもとに、騰落率のみで表現しています）`);
  L.push('');
  L.push('■ 近況');
  L.push(`・年初来：${fmtPct(s.ytd)}（昨日比 ${fmtPct(s.dayChange)}${s.oneYear !== null ? `／直近1年 ${fmtPct(s.oneYear)}` : ''}）`);
  L.push(`・過去${s.pastYtd.length}年の同時期との比較：${s.ytdRank}位（中央値 ${fmtPct(s.ytdMedian)}）`);
  L.push(`・最高値（ATH）更新：${s.athDate.replace(/-/g, '/')}（${s.athDays}日経過）／ATHから ${fmtPct(s.dd)}／今年の最大下落 ${fmtPct(s.ddMin)}`);
  L.push(`・今年のATH更新：${s.athCount}回（過去の同時期の平均 ${s.athAvg.toFixed(1)}回）`);
  L.push(`・上昇日 ${s.up}日／下落日 ${s.down}日（上昇日の割合 ${fmtPlain(s.upRatio)}、過去平均 ${fmtPlain(s.upRatioAvg)}）`);
  L.push('');
  L.push('■ 年末までの過去実績（予想ではありません）');
  L.push(`・過去${s.outlook.n}年のうち、この時期から年末までに上昇した年：${s.outlook.posCount}年（${fmtPlain(s.outlook.posProb)}）、中央値 ${fmtPct(s.outlook.median)}`);
  L.push(`・今年のプラスを年末まで維持できた割合：${fmtPlain(s.outlook.keepPlusProb)}`);
  const cl2 = crashList(s);
  if (cl2.length) {
    L.push('');
    L.push('■ 調整〜暴落の頻度（過去の実績）');
    for (const r of cl2) L.push(`・-${r.level}%（${r.name}）：${r.interval}、前回${r.lastYear ?? '—'}年`);
  }
  L.push('');
  L.push(`あなたは${s.year}年末のS&P500はどうなると思いますか？ コメントで教えてください。`);
  L.push('');
  L.push('■ ご留意事項');
  disclaimers.forEach(d => L.push(`・${d}`));
  L.push('');
  L.push('#投資 #資産運用 #SP500 #米国株 #NISA #暴落');
  return L.join('\n');
}
