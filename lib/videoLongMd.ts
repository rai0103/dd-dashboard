// [dd-dashboard移植版] investment-shorts (lib/longMd.ts) を移植。
// テキスト(.md)をパースする parseLongMd / sections / num は移植しない（dd-dashboardは自前のデータから直接LongMdを組み立てるため不要）。
// buildMdScenes と、読み上げ（ひらがな）生成に必要な型・ヘルパーのみを移植する。
// 追加変更点：オープニング／エンディングの読み上げに決め打ちだった「えすあんどぴーごひゃく」を、
// instrumentNameKana引数（省略時は従来どおりS&P500）で任意銘柄に対応できるようにした（investment-shorts側は無改変）。
import { integerToKana, numberStringToKana, yearsToKana } from './videoReading';
import { monthDayKana, pctKana, nichiKana, UpdateStats, buildUpdateScenes } from './videoMarketUpdate';
import { LongBasis } from './videoLongBasis';
import { CustomSceneSpec } from './videoCustomScene';
import { DD_CATEGORY_KANA } from './ddCategory';

export interface LongMd {
  y: number; m: number; d: number;
  status: { dd: number; mode: string; ytd: number; oneYear: number | null; cycle: string; athDate: string; athDays: number | null;
    caseN: number | null; caseFrom: number | null; caseTo: number | null; caseAth: number | null; caseDd: number | null; caseDdLevel: number | null; notes: string[] } | null;
  bottom: { lines: string[]; excluded: boolean; mdd: number | null; level: number | null; pHold: number | null; pBreak: number | null; tierLabel: string | null } | null;
  rolling: { label: string; v: number }[];
  ytdNote: { ytd: number; years: number; pct: number } | null;
  forecast: { total: number; prob: number; cycleYears: number[]; monthly: { m: number; v: number }[]; rows: { name: string; mean: number | null; prob: number | null; weight: number | null; n: number | null; refYears?: number[] }[]; yearPaths?: Record<number, { t: number; v: number }[]> } | null;
  ddpace: { athCount: number; perYear: number; every: number; buckets: { range: string; n: number; ref: boolean; days: number; clean: number }[]; phases: number | null } | null;
  crash: { level: number; count: string; ref: boolean; interval: string; last: string; prob: number; prevAvg: string; prevPlus: string; a1: string; a3: string; a5: string }[];
  daily: { up: number; down: number; avg: number; buckets: { label: string; v: number }[] } | null;
  /** [Stage D-6] 冒頭「前日比」スライド用。前日比・現在のDD・その節目の発生頻度・直近7営業日の推移 */
  dayChange: {
    pct: number; ddPct: number; isNewAth: boolean;
    category: { label: string; freqPerYear: number | null; freqLabel: string | null };
    recent7: { date: string; price: number }[];
  } | null;
  /** [Stage D-6] 「下落の頻度」スライド用。trackRecord.finalReach（DD-3%到達局面からの最終到達確率、15行）そのもの */
  finalReach: {
    totalYears: number; n: number; currentLabel: string | null;
    rows: { label: string; p: number | null; hits: number }[];
  } | null;
}

// ---------- 読み（ひらがな） ----------
const kz = (t: string): string => t
  .replace(/([+-]?)(\d+(?:\.\d+)?)%/g, (_, s, n) => `${s === '+' ? 'ぷらす' : s === '-' ? 'まいなす' : ''}${numberStringToKana(n)}ぱーせんと`)
  .replace(/(\d+(?:\.\d+)?)年/g, (_, n) => (n.includes('.') ? `${numberStringToKana(n)}ねん` : yearsToKana(+n)));

const NAME_MAP: [RegExp, string][] = [
  [/直近(\d+)年平均/, ''], [/前年類似年の翌年平均/, 'ぜんねんるいじねんの、よくねんへいきん'], [/大統領サイクル別季節性（月次）/, 'だいとうりょう、さいくるべつの、きせつせい'],
  [/大統領サイクル平均/, 'だいとうりょう、さいくるの、へいきん'], [/当年月末時点類似年/, 'とうねん、げつまつじてんの、るいじねん'], [/類似年の残り期間実績平均/, 'るいじねんの、のこりきかんの、じっせきへいきん'],
  [/当年DD局面類似年/, 'とうねん、どろーだうん、きょくめんの、るいじねん'],
];
function nameKana(n: string): string {
  const r = n.match(/直近(\d+)年平均/);
  if (r) return `ちょっきん、${yearsToKana(+r[1])}の、へいきん`;
  for (const [re, k] of NAME_MAP) if (re.test(n)) return k;
  return kz(n);
}

const MONTH_UNIT: Record<string, string> = { '1ヶ月': 'いっかげつ', '3ヶ月': 'さんかげつ', '6ヶ月': 'ろっかげつ' };
const periodKana = (l: string) => MONTH_UNIT[l] ?? (l.endsWith('年') ? yearsToKana(parseInt(l, 10)) : kz(l));
export const pk = (v: number, signed = true) => {
  const r = Math.round(Math.abs(v) * 10) / 10;
  if (Number.isInteger(r)) return `${signed && r !== 0 ? (v >= 0 ? 'ぷらす' : 'まいなす') : ''}${integerToKana(r)}ぱーせんと`;
  return pctKana(v, signed);
};
/** [Stage D-6] 「年に1.7回」「3.0年に1度」等の頻度を読み上げる（ddCategory.freqLabelFromPと同じ数値を、かなで読む版） */
function freqKana(perYear: number | null): string {
  if (perYear === null || !Number.isFinite(perYear) || perYear <= 0) return 'ひんどが、ふめいで';
  if (perYear >= 1) return `ねんに、やく、${numberStringToKana(perYear.toFixed(1))}かい`;
  const years = 1 / perYear;
  return `${numberStringToKana(years.toFixed(1))}ねんに、やく、いちど`;
}
export const lvKana = (n: number) => `${integerToKana(n)}ぱーせんと`.replace(/じゅうぱー/, 'じゅっぱー');
const rangeKana = (r: string): string => {
  const m = r.match(/^-(\d+)〜-(\d+)%$/);
  if (m) return `まいなす、${integerToKana(+m[1])}から、まいなす、${lvKana(+m[2])}`;
  const o = r.match(/^-(\d+)%超$/);
  if (o) return `まいなす、${lvKana(+o[1])}、ちょう`;
  return kz(r);
};
const BUCKET_K: Record<string, string> = {
  '+2%超': 'ぷらす、にぱーせんと、ちょう', '+1〜2%': 'ぷらす、いちから、にぱーせんと', '0〜+1%': 'ぜろから、ぷらす、いちぱーせんと',
  '-1〜0%': 'まいなす、いちぱーせんとから、ぜろ', '-2〜-1%': 'まいなす、にから、まいなす、いちぱーせんと', '-2%超の下落': 'まいなす、にぱーせんと、ちょうの、げらく',
};
const MODE_K: [RegExp, string][] = [[/最高値/g, 'さいたかね'], [/更新/g, 'こうしん'], [/モード/g, 'もーど'], [/調整/g, 'ちょうせい'], [/下落/g, 'げらく'], [/回復/g, 'かいふく'], [/ボックス圏?/g, 'ぼっくすけん'], [/ATH/g, 'さいたかね']];
const modeKana = (t: string) => MODE_K.reduce((s, [re, k]) => s.replace(re, k), t);
const NY = ['', 'いちねんめ', 'にねんめ', 'さんねんめ', 'よねんめ'];
export const cycleKana = (t: string): string => {
  let s = t.replace(/（[^）]*大統領[^）]*）/g, '');
  s = s.replace(/中間選挙年/g, 'ちゅうかんせんきょねん').replace(/大統領選挙年/g, 'だいとうりょうせんきょねん').replace(/任期(\d)年目/g, (_, n) => `にんき${NY[+n] ?? ''}`);
  return s.replace(/[（）()]/g, '、');
};
const lastKana = (t: string): string => {
  const m = t.match(/(\d{4})年（([\d.]+)年経過）/);
  return m ? `ぜんかいは、${yearsToKana(+m[1])}、${numberStringToKana(m[2])}ねん、けいかしています` : kz(t);
};
export const intervalK = (t: string): string => {
  const m = t.match(/^([\d.]+)年に1度/);
  if (!m) return kz(t);
  return m[1].includes('.') ? `${numberStringToKana(m[1])}ねんに、いちど` : `${yearsToKana(+m[1])}に、いちど`;
};

// 任意の英数字ティッカーを1文字ずつ読み上げるためのかな変換（S&P500以外の銘柄用フォールバック）。
const LETTER_KANA: Record<string, string> = {
  A: 'えー', B: 'びー', C: 'しー', D: 'でぃー', E: 'いー', F: 'えふ', G: 'じー', H: 'えいち', I: 'あい', J: 'じぇい', K: 'けい', L: 'える',
  M: 'えむ', N: 'えぬ', O: 'おー', P: 'ぴー', Q: 'きゅー', R: 'あーる', S: 'えす', T: 'てぃー', U: 'ゆー', V: 'ぶい', W: 'だぶりゅー', X: 'えっくす', Y: 'わい', Z: 'ぜっと',
};
export function tickerKana(symbol: string): string {
  return symbol.toUpperCase().split('').map((c) => LETTER_KANA[c] ?? (/[0-9]/.test(c) ? integerToKana(+c) : '')).filter(Boolean).join('・');
}
export const SP500_KANA = 'えすあんどぴーごひゃく';

export type ContentSectionId = 'dayChange' | 'ytdChange' | 'athDrop' | 'yearEndTrack' | 'crashFreq' | 'status' | 'bottom' | 'rolling' | 'forecast' | 'basis10' | 'basisCycle' | 'ddpace' | 'crashmd' | 'daily';
/** 既存の構成候補（ContentSectionId）に、AIがチャットで生成したカスタム場面（`custom:${uuid}`）を混在させた型（Stage D-4） */
export type ComposedSectionId = ContentSectionId | `custom:${string}`;
/** 既定の構成：ショート動画（近況解説）と同じ切り口＋冒頭の前日比（Stage D-6で追加）。ショートから長尺への導線として、同じ切り口で始める */
export const DEFAULT_CONTENT_SECTIONS: ContentSectionId[] = ['dayChange', 'ytdChange', 'athDrop', 'yearEndTrack', 'crashFreq'];
export const CONTENT_SECTION_LABELS: Record<ContentSectionId, string> = {
  dayChange: '前日比',
  ytdChange: '騰落率',
  athDrop: 'ATHからの下落率',
  yearEndTrack: '年末までの過去実績',
  crashFreq: '下落の頻度',
  status: '近況（詳細一括版）',
  bottom: '底値判定',
  rolling: 'ローリングリターン',
  forecast: '年末見通し',
  basis10: '直近10年根拠',
  basisCycle: '大統領サイクル根拠',
  ddpace: 'DD局面・ATH更新ペース',
  crashmd: '暴落の発生確率',
  daily: '日次リターンの分布',
};

export interface MdScene { id: string; reading: string; minSec: number; caption: string }

/** 「近況」「底値判定」等の場面を1つだけ作るビルダーの一覧。対象データが無いものはnullを返す（構成UIの選択可否判定にも使う） */
function contentSectionBuilders(md: LongMd, basis: LongBasis | null | undefined, stats?: UpdateStats | null, instrumentNameKana: string = SP500_KANA): Record<ContentSectionId, () => MdScene | null> {
  return {
    dayChange: () => {
      const dc = md.dayChange;
      if (!dc) return null;
      const ddPart = dc.isNewAth
        ? 'さいたかねを、こうしんしました。'
        : `げんざいの、どろーだうんは、${pk(dc.ddPct)}で、${freqKana(dc.category.freqPerYear)}、はっせいする、${DD_CATEGORY_KANA[dc.category.label] ?? kz(dc.category.label)}です。`;
      const r = `${instrumentNameKana}は、まえびひ、${pk(dc.pct)}。${ddPart}`;
      const sign = dc.pct >= 0 ? '+' : '';
      return { id: 'dayChange', minSec: 9, reading: r, caption: `近況：前日比 ${sign}${dc.pct.toFixed(2)}%` };
    },
    ytdChange: () => {
      if (!stats) return null;
      const upd = buildUpdateScenes(stats);
      const ytd = upd.find(x => x.id === 'ytd');
      const ytdvs = upd.find(x => x.id === 'ytdvs');
      const updown = upd.find(x => x.id === 'updown');
      if (!ytd) return null;
      const r = [ytd.reading, ytdvs?.reading, updown?.reading].filter(Boolean).join('');
      const minSec = ytd.minSec + (ytdvs?.minSec ?? 0) + (updown?.minSec ?? 0);
      return { id: 'ytdChange', minSec, reading: r, caption: `近況：年初来 ${stats.ytd >= 0 ? '+' : ''}${stats.ytd}%` };
    },
    athDrop: () => {
      if (!stats) return null;
      const upd = buildUpdateScenes(stats);
      const ath = upd.find(x => x.id === 'ath');
      const athcount = upd.find(x => x.id === 'athcount');
      if (!ath) return null;
      const r = [ath.reading, athcount?.reading].filter(Boolean).join('');
      const minSec = ath.minSec + (athcount?.minSec ?? 0);
      return { id: 'athDrop', minSec, reading: r, caption: stats.dd >= -0.005 ? '近況：最高値を更新中' : `近況：最高値から ${stats.dd.toFixed(1)}%` };
    },
    yearEndTrack: () => {
      if (!stats) return null;
      const upd = buildUpdateScenes(stats);
      const outlook = upd.find(x => x.id === 'outlook');
      if (!outlook) return null;
      const o = stats.outlook;
      return { id: 'yearEndTrack', minSec: outlook.minSec, reading: outlook.reading, caption: `近況：年末までに上昇した年は ${o.posCount}/${o.n}年（${o.posProb.toFixed(0)}%）` };
    },
    crashFreq: () => {
      const fr = md.finalReach;
      if (!fr) return null;
      const row = (label: string) => fr.rows.find(x => x.label === label) ?? null;
      const pOf = (row: { p: number | null } | null) => (row && row.p !== null ? pk(row.p, false) : 'ふめい');
      const r5 = row('-5%'), r10 = row('-10%'), r20 = row('-20%'), r30 = row('-30%'), r50 = row('-50%以上');
      const totalYearsInt = Math.round(fr.totalYears);
      const r = `かこ、${integerToKana(totalYearsInt)}ねんかんの、どろーだうん、さいしゅうとうたつかくりつは、まいなす、さんぱーせんとに、たっした、${integerToKana(fr.n)}かいに、たいして、まいなす、ごぱーせんとが、${pOf(r5)}、まいなす、じゅっぱーせんとが、${pOf(r10)}、まいなす、にじゅっぱーせんとが、${pOf(r20)}、まいなす、さんじゅっぱーせんとが、${pOf(r30)}、まいなす、ごじゅっぱーせんと、いじょうが、${pOf(r50)}、はっせい、しています。`;
      return { id: 'crashFreq', minSec: 18, reading: r, caption: `近況：下落の頻度（過去${fr.totalYears.toFixed(0)}年・${fr.n}局面）` };
    },
    status: () => {
      const st = md.status;
      if (!st) return null;
      let r = `まず、げんざいの、じょうきょうです。さいたかねからの、げらくりつは、${pk(st.dd)}。もーどは、${modeKana(st.mode)}です。ことしの、ねんしょうらいは、${pk(st.ytd)}`;
      if (st.oneYear !== null) r += `、ちょっきん、いちねんは、${pk(st.oneYear)}`;
      r += '。';
      if (st.cycle) r += `${cycleKana(st.cycle)}です。`;
      if (st.athDays !== null) r += `さいたかね、こうしんから、${nichiKana(st.athDays)}、けいかしています。`;
      if (st.caseN !== null && st.caseAth !== null && st.caseDd !== null) r += `さいたかねの、こうしんが、${integerToKana(st.caseFrom ?? 0)}から、${nichiKana(st.caseTo ?? 0)}、つづいた、かこの、${integerToKana(st.caseN)}けーすでは、さいしゅうてきに、さいたかねを、こうしんしたのが、${pk(st.caseAth, false)}、まいなす、${integerToKana(st.caseDdLevel ?? 3)}ぱーせんとに、とうたつしたのが、${pk(st.caseDd, false)}でした。`;
      return { id: 'status', minSec: 12, reading: r, caption: `現在の状況：DD ${st.dd}%・年初来 ${st.ytd >= 0 ? '+' : ''}${st.ytd}%` };
    },
    bottom: () => {
      const bt = md.bottom;
      if (!bt) return null;
      const r = bt.excluded
        ? `つぎに、そこねの、はんていです。げんきょくめんの、まっくすどろーだうんは、${bt.mdd !== null ? pk(bt.mdd) : ''}で、まいなす、${integerToKana(Math.abs(bt.level ?? 3))}ぱーせんとに、たっして、いないため、はんていの、たいしょうがいです。`
        : `つぎに、そこねの、はんていです。${kz(bt.lines.join('。'))}`;
      return { id: 'bottom', minSec: 8, reading: r, caption: '底値判定' };
    },
    rolling: () => {
      if (!md.rolling.length) return null;
      let r = 'つぎに、ろーりんぐ、りたーんです。ろーりんぐ、りたーんとは、きじゅんびから、さかのぼって、それぞれの、きかんの、とうらくりつを、みたものです。その、きかん、もちつづけた、ばあいの、せいせきと、かんがえられます。' + md.rolling.map(x => `${periodKana(x.label)}は、${pk(x.v)}`).join('、') + '。';
      if (md.ytdNote) r += `ことしの、ねんしょうらいは、${pk(md.ytdNote.ytd)}。おなじじてんの、かこ、${integerToKana(md.ytdNote.years)}ねんの、うち、${pk(md.ytdNote.pct, false)}の、ねんを、うわまわる、ぺーすです。`;
      return { id: 'rolling', minSec: 24, reading: r, caption: 'ローリングリターンと年初来の立ち位置' };
    },
    forecast: () => {
      const f = md.forecast;
      if (!f) return null;
      let r = `つぎに、ねんまつまでの、みとおしです。ふくすうの、しひょうを、かじゅうごうせいした、そうごうよそくは、${pk(f.total)}、じょうしょうかくりつは、${pk(f.prob, false).replace('ぱーせんと', 'ぱーせんと')}です。`;
      f.rows.filter(x => x.mean !== null).forEach(x => { r += `${nameKana(x.name)}は、${pk(x.mean!)}、じょうしょうかくりつは、${pk(x.prob!, false)}。`; });
      r += 'これは、かこの、じっせきからの、みとおしで、しょうらいを、ほしょうするものでは、ありません。';
      return { id: 'forecast', minSec: 30, reading: r, caption: `年末までの見通し：総合予測 ${f.total >= 0 ? '+' : ''}${f.total}%（上昇確率 ${f.prob}%）` };
    },
    basis10: () => {
      const f = md.forecast;
      if (!f || !basis) return null;
      const r10 = f.rows.find(x => /直近10年平均/.test(x.name));
      if (!r10 || r10.mean === null || !basis.recent.length) return null;
      const up = basis.recent.filter(x => x.ret > 0).length;
      let r = `ここからは、ねんまつみとおしの、こんきょです。まず、ちょっきん、じゅうねんの、へいきんです。さんしょうねんの、ねんかんの、とうらくりつは、`;
      r += basis.recent.map(x => `${yearsToKana(x.year)}、${pk(x.ret)}`).join('、') + '。';
      r += `${integerToKana(basis.recent.length)}ねんの、うち、${integerToKana(up)}ねんが、ぷらすで、へいきんは、${pk(r10.mean)}、じょうしょうかくりつは、${pk(r10.prob ?? 0, false)}。ごうせいでの、かじゅうは、${pk(r10.weight ?? 0, false)}です。`;
      return { id: 'basis10', minSec: 26, reading: r, caption: `根拠①：直近10年平均 ${r10.mean >= 0 ? '+' : ''}${r10.mean}%` };
    },
    basisCycle: () => {
      const f = md.forecast;
      if (!f || !basis) return null;
      const rc = f.rows.find(x => /大統領サイクル平均/.test(x.name));
      if (!rc || rc.mean === null || basis.cycle.length < 3) return null;
      let r = `つぎに、だいとうりょう、さいくるの、くらべです。${cycleKana(md.status?.cycle ?? '')}の、ことしと、おなじ、くぶんの、かこ、${integerToKana(basis.cycle.length)}ねんの、すいいを、かさねました。みどりの、せんが、ことしです。`;
      r += `おなじくぶんの、ねんかんの、へいきんは、${pk(rc.mean)}、じょうしょうかくりつは、${pk(rc.prob ?? 0, false)}でした。`;
      if (f.monthly.length) r += 'げつべつの、きせつせいでは、' + f.monthly.map(x => `${monthDayKana(x.m, 1).replace(/ついたち$/, '')}は、${pk(x.v)}`).join('、') + 'です。';
      return { id: 'basisCycle', minSec: 20, reading: r, caption: `根拠②：大統領サイクル平均 ${rc.mean >= 0 ? '+' : ''}${rc.mean}%` };
    },
    ddpace: () => {
      const dp = md.ddpace;
      if (!dp) return null;
      let r = 'つぎに、かこの、どろーだうん、きょくめんと、さいたかねの、こうしんぺーすです。';
      if (dp.athCount) r += `さいたかねは、ぜんきかんで、${integerToKana(dp.athCount)}かい、ねんへいきん、${numberStringToKana(String(dp.perYear))}かい、へいきん、${nichiKana(dp.every)}に、いちど、こうしんしています。`;
      dp.buckets.forEach(b => { r += `${rangeKana(b.range)}の、げらくは、${integerToKana(b.n)}けん、へいきん、げらくにっすうは、${numberStringToKana(String(b.days))}にち、くりーんかいふくりつは、${pk(b.clean, false)}。`; });
      if (dp.buckets.some(b => b.ref)) r += 'さんぷるすうの、すくないものは、さんこうちです。';
      return { id: 'ddpace', minSec: 28, reading: r, caption: '過去のDD局面・ATH更新ペース' };
    },
    crashmd: () => {
      if (!md.crash.length) return null;
      let r = 'つぎに、ぼうらくの、はっせいかくりつと、はっせいごの、りたーんです。';
      md.crash.filter(c => [10, 20, 30].includes(c.level)).forEach(c => {
        r += `どろーだうん、まいなす、${lvKana(c.level)}を、こえる、げらくは、${intervalK(c.interval)}。${lastKana(c.last)}。こんご、いちねんいないに、はっせいする、かくりつは、${pk(c.prob, false)}。はっせいごの、いちねんは、${kz(c.a1)}、さんねんは、${kz(c.a3)}、ごねんは、${kz(c.a5)}です。`;
      });
      r += 'ほかの、ふしめは、ひょうの、とおりです。';
      return { id: 'crashmd', minSec: 28, reading: r, caption: '暴落の発生確率と発生後のリターン' };
    },
    daily: () => {
      const dl = md.daily;
      if (!dl) return null;
      let r = `さいごに、にちじ、りたーんの、ぶんぷです。じょうしょうびは、${pk(dl.up, false)}、げらくびは、${pk(dl.down, false)}、へいきんの、にちじ、りたーんは、${pk(dl.avg)}です。`;
      [...dl.buckets].reverse().forEach(b => { r += `${BUCKET_K[b.label] ?? kz(b.label)}は、${pk(b.v, false)}。`; });
      return { id: 'daily', minSec: 20, reading: r, caption: '日次リターンの分布' };
    },
  };
}

/** 現在のmd/basisで、どの構成候補が選択可能か（対象データがあるか）を返す。構成UIの「選択候補」一覧に使う */
export function availableContentSections(md: LongMd, basis?: LongBasis | null, stats?: UpdateStats | null): ContentSectionId[] {
  const builders = contentSectionBuilders(md, basis, stats);
  return (Object.keys(builders) as ContentSectionId[]).filter(id => builders[id]() !== null);
}

/** md から長尺シーンを作る。順序：オープニング→sections（指定順）→エンディング。instrumentNameKana省略時は従来どおりS&P500として読む。sections省略時は近況のみ（DEFAULT_CONTENT_SECTIONS） */
export function buildMdScenes(md: LongMd, basis?: LongBasis | null, instrumentNameKana: string = SP500_KANA, sections: ComposedSectionId[] = DEFAULT_CONTENT_SECTIONS, stats?: UpdateStats | null, customScenes?: CustomSceneSpec[], instrumentDisplayLabel: string = 'S&P500'): MdScene[] {
  const sc: MdScene[] = [];
  const dateK = `${yearsToKana(md.y)}、${monthDayKana(md.m, md.d)}`;
  const dateJ = `${md.y}年${md.m}月${md.d}日`;
  sc.push({ id: 'open', minSec: 5, reading: `${dateK}、${instrumentNameKana}の、ぶんせきを、れぽーとします。`, caption: `${dateJ}、${instrumentDisplayLabel}の分析をレポートします。` });

  const builders = contentSectionBuilders(md, basis, stats, instrumentNameKana);
  const customById = new Map((customScenes ?? []).map((c) => [c.id, c] as const));
  for (const id of sections) {
    if (typeof id === 'string' && id.startsWith('custom:')) {
      const spec = customById.get(id);
      if (spec) sc.push({ id: spec.id, minSec: spec.minSec, reading: spec.reading, caption: spec.caption });
      continue;
    }
    const scene = builders[id as ContentSectionId]?.();
    if (scene) sc.push(scene);
  }

  sc.push({ id: 'end', minSec: 8, reading: `${dateK}の、${instrumentNameKana}の、ぶんせきれぽーとは、いじょうです。`, caption: `${dateJ}の${instrumentDisplayLabel}の分析レポートは以上です。` });
  return sc;
}
