// [Stage E-16] S&P500動画（モックアップ25枚）の固定場面ビルダー。lib/sp500Sheets.tsが日次終値から計算した数値を
// そのまま場面（図解の仕様データ＋ナレーション＋ひらがなの読み上げ文）にする。AIには数値を作文させない
// （athPaceScene.ts等と同じ方針）。データが足りないシートはnullを返し、その場面は動画に入れない。
import { newSceneId, minSecFor } from './scriptModel';
import { emptyVisual } from './types';
import type { ExplainerScene, FanSpec, FanSeries, FanRole, VisualSpec } from './types';
import type { Sp500Sheets, ScenarioSheet, ZoomSheet, UpDownSheet, DdOverlaySheet, DdHistorySheet, AthZoneSheet, YtdPathsSheet, FactsSheet, TitleSheet } from '../sp500Sheets';
import { summarizeRollingReturnsForVideo } from '../rollingReturn';
import { integerToKana, numberStringToKana } from '../videoReading';

const sg = (v: number, d = 1) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(d)}`;
const pctT = (v: number | null | undefined, d = 1) => (v == null ? '―' : `${sg(v, d)}%`);
/** 「まいなす、じゅうさん、てん、に、ぱーせんと」 */
const pctR = (v: number | null | undefined, d = 1) => {
  if (v == null) return 'さんこうちなし';
  const a = Math.abs(v).toFixed(d).replace(/\.0+$/, '');
  return `${v < 0 ? 'まいなす、' : v > 0 ? 'ぷらす、' : ''}${numberStringToKana(a)}ぱーせんと`;
};
const numR = (v: number, d = 1) => numberStringToKana(Math.abs(v).toFixed(d).replace(/\.0+$/, ''));
const intR = (v: number) => integerToKana(Math.round(v));
const md = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
const ymJ = (iso: string) => `${iso.slice(0, 4)}年${Number(iso.slice(5, 7))}月`;
const ymR = (iso: string) => `${intR(Number(iso.slice(0, 4)))}ねん、${intR(Number(iso.slice(5, 7)))}がつ`;
const yearFrac = (iso: string) => Number(iso.slice(0, 4)) + (Number(iso.slice(5, 7)) - 1) / 12;

function scene(title: string, caption: string, narration: string, reading: string, visual: VisualSpec, minSec = 9): ExplainerScene {
  return { id: newSceneId(), title, caption, narration, reading, visual, chapter: 0, minSec, imageId: null };
}
const SRC = (label: string, sheets: Sp500Sheets) => `${label}の実績データ（日次終値、〜${sheets.asOf}）`;

// ---------------------------------------------------------------- S1 タイトルの背景
/** AIが作ったタイトル場面に、全期間の推移を背景として添える（文字はAIのタイトルのまま） */
export function decorateTitleScene(sc: ExplainerScene, t: TitleSheet | null): ExplainerScene {
  if (!t || sc.visual.kind !== 'title') return sc;
  const sub = sc.visual.subheading || `${t.startDate.slice(0, 4)}〜${t.endDate.slice(0, 4)}年・約${Math.round(t.years)}年の実データで分析`;
  return { ...sc, visual: { ...sc.visual, background: t.background, subheading: sub } };
}

// ---------------------------------------------------------------- S4-5 年初来→直近ズーム
export function zoomScene(z: ZoomSheet | null, label: string, sheets: Sp500Sheets): ExplainerScene | null {
  if (!z) return null;
  const ups = z.zoom.filter((d) => d.dayPct > 0).length, downs = z.zoom.filter((d) => d.dayPct < 0).length;
  const narration = `まず、${z.year}年の値動きです。年初来の騰落率は${pctT(z.ytdPct)}、最高値からの下落率は${pctT(z.dd)}、最高値の更新から${z.daysSinceATH}営業日が経っています。直近${z.zoom.length}営業日に絞ると、上昇が${ups}日、下落が${downs}日で、直近の前日比は${pctT(z.lastDayPct)}でした。`;
  const reading = `まず、${intR(z.year)}ねんの、ねうごきです。ねんしらいの、とうらくりつは、${pctR(z.ytdPct)}、さいたかねからの、げらくりつは、${pctR(z.dd)}、さいたかねの、こうしんから、${intR(z.daysSinceATH)}えいぎょうびが、たっています。ちょっきん、${intR(z.zoom.length)}えいぎょうびに、しぼると、じょうしょうが、${intR(ups)}にち、げらくが、${intR(downs)}にちで、ちょっきんの、ぜんじつひは、${pctR(z.lastDayPct)}でした。`;
  return scene('現在の状況（年初来→直近）', `${z.year}年の値動き：年初来${pctT(z.ytdPct)}・直近${z.zoom.length}営業日`, narration, reading, {
    ...emptyVisual('zoomLine'), heading: `${z.year}年の値動き`, subheading: `年初来の推移 → 直近${z.zoom.length}営業日にズーム（${md(z.asOf)}時点）`, source: SRC(label, sheets),
    zoomLine: {
      points: z.ytd.map((p) => ({ label: md(p.date), y: p.pct })), zoomFrom: z.zoomFrom,
      zoomDays: z.zoom.map((d) => ({ label: md(d.date), dayPct: d.dayPct })), yUnit: '%', zoomTitle: `直近${z.zoom.length}営業日`,
      chips: [
        { label: '年初来', value: pctT(z.ytdPct), role: 'focus' },
        { label: '最高値からの下落率', value: pctT(z.dd), role: z.dd <= -3 ? 'warn' : undefined },
        { label: '最高値の更新から', value: `${z.daysSinceATH}営業日` },
        { label: '直近の前日比', value: pctT(z.lastDayPct), role: z.lastDayPct < 0 ? 'warn' : 'focus' },
      ],
    },
  }, 12);
}

// ---------------------------------------------------------------- S6 騰落日数バタフライ
export function upDownScene(u: UpDownSheet | null, label: string, sheets: Sp500Sheets): ExplainerScene | null {
  if (!u || u.rows.length < 2) return null;
  const [cur, ...others] = u.rows;
  const nextP = u.lastDayUp ? u.nextUpAfterUp : u.nextUpAfterDown;
  const narration = `年初から${u.k + 1}営業日の、上昇した日と下落した日の数です。今年は上昇${cur.up}日・下落${cur.down}日でした。${others.map((r) => `${r.label}は上昇${r.up}日・下落${r.down}日`).join('、')}です。また過去の全期間では、前日が${u.lastDayUp ? '上昇' : '下落'}した日の翌営業日に上昇した割合は${nextP}%で、ほぼ五分五分です。`;
  const reading = `ねんしから、${intR(u.k + 1)}えいぎょうびの、じょうしょうした、ひと、げらくした、ひの、かずです。ことしは、じょうしょう、${intR(cur.up)}にち、げらく、${intR(cur.down)}にちでした。${others.map((r) => `${r.label.startsWith('過去10年') ? 'かこ、じゅうねんの、へいきん' : `だいとうりょう、にんき、${intR(u.termYear)}ねんめの、へいきん`}は、じょうしょう、${numR(r.up)}にち、げらく、${numR(r.down)}にち`).join('、')}です。また、かこの、ぜんきかんでは、ぜんじつが、${u.lastDayUp ? 'じょうしょう' : 'げらく'}した、ひの、よくえいぎょうびに、じょうしょうした、わりあいは、${numR(nextP)}ぱーせんとで、ほぼ、ごぶごぶです。`;
  return scene('年初来の騰落日数', `年初来の上昇日・下落日（今年 vs 過去10年平均 vs 大統領任期${u.termYear}年目）`, narration, reading, {
    ...emptyVisual('butterfly'), heading: '年初来の「上昇日」と「下落日」', subheading: `年初から${u.k + 1}営業日（${md(u.asOf)}時点）・平均は1日あたりの騰落率`, source: SRC(label, sheets),
    butterfly: {
      leftLabel: '◀ 下落した日', rightLabel: '上昇した日 ▶',
      rows: u.rows.map((r, i) => ({ label: r.n ? `${r.label}（${r.n}年）` : r.label, left: r.down, right: r.up, leftSub: `平均${pctT(r.downAvg, 2)}`, rightSub: `平均${pctT(r.upAvg, 2)}`, emphasis: i === 0 })),
      note: `前日が${u.lastDayUp ? '上昇' : '下落'}した日の翌営業日に上昇した割合（全期間）：${nextP}%`,
    },
  }, 12);
}

// ---------------------------------------------------------------- S8 過去のDD局面の重ね描き
export function ddOverlayScene(o: DdOverlaySheet | null, label: string, sheets: Sp500Sheets): ExplainerScene | null {
  if (!o || !o.paths.length) return null;
  const series: FanSeries[] = o.paths.map((p) => ({ key: p.startDate, label: p.label, role: o.deepest && p.startDate === o.deepest.startDate ? 'warn' : 'bg', points: p.path }));
  if (o.medianPath.length > 1) series.push({ key: 'median', label: `${o.paths.length}局面の中央値`, role: 'median', points: o.medianPath, endLabel: `中央値 ${pctT(o.medianPath[o.medianPath.length - 1].y)}` });
  if (o.current && o.current.length > 1) series.push({ key: 'current', label: '今回', role: 'focus', points: o.current, endLabel: `今回 ${pctT(o.current[o.current.length - 1].y)}` });
  const d = o.deepest;
  const fan: FanSpec = {
    series, xUnit: '営業日', yUnit: '%',
    hLines: [{ y: -3, label: '−3%（起点）' }, { y: -5, label: '−5%' }, { y: -10, label: '−10%' }],
    markers: d ? [{ x: d.minT, y: d.minDD, label: `${d.label.replace('〜', '')} 最大${pctT(d.minDD)}`, role: 'warn' }] : [],
    bgLegend: `過去の局面（${o.paths.length}件）`,
    nowX: o.current ? o.elapsed : undefined, nowLabel: '現在',
  };
  const medEnd = o.medianPath[o.medianPath.length - 1]?.y ?? null;
  const intro = o.mode === 'current'
    ? `今回の下落（DD−3%到達から${o.elapsed}営業日）と、値動きが近かった過去${o.paths.length}局面を重ねました。`
    : `現在はDD−3%を超える下落局面ではないため、直近の${o.paths.length}局面を、DD−3%に到達した日を起点に重ねました。`;
  const introR = o.mode === 'current'
    ? `こんかいの、げらく、でぃーでぃー、まいなす、さんぱーせんと、とうたつから、${intR(o.elapsed)}えいぎょうびと、ねうごきが、ちかかった、かこ、${intR(o.paths.length)}きょくめんを、かさねました。`
    : `げんざいは、でぃーでぃー、まいなす、さんぱーせんとを、こえる、げらくきょくめんでは、ないため、ちょっきんの、${intR(o.paths.length)}きょくめんを、でぃーでぃー、まいなす、さんぱーせんとに、とうたつした、ひを、きてんに、かさねました。`;
  const narration = `${intro}${o.window}営業日後の中央値は${pctT(medEnd)}、最も深かったのは${d ? `${d.label.replace('〜', '')}からの局面で${pctT(d.minDD)}` : '―'}です。過去全体では、DD−3%到達は${o.total}回ありました。`;
  const reading = `${introR}${intR(o.window)}えいぎょうびごの、ちゅうおうちは、${pctR(medEnd)}、もっとも、ふかかったのは、${d ? `${ymR(d.startDate)}からの、きょくめんで、${pctR(d.minDD)}` : 'さんこうちなし'}です。かこ、ぜんたいでは、でぃーでぃー、まいなす、さんぱーせんと、とうたつは、${intR(o.total)}かい、ありました。`;
  return scene('過去のDD局面との重ね描き', `DD−3%到達後の推移：${o.mode === 'current' ? '今回と似た' : '直近の'}${o.paths.length}局面`, narration, reading, {
    ...emptyVisual('fan'), heading: o.mode === 'current' ? '今回の下落と、似た過去の局面' : 'DD−3%に到達した後、どこまで下がった？',
    subheading: `横軸：DD−3%到達からの営業日・縦軸：最高値からの下落率`, source: SRC(label, sheets), fan,
  }, 12);
}

// ---------------------------------------------------------------- S13 暴落ラベル付きDDチャート
export function ddHistoryScene(h: DdHistorySheet | null, label: string, sheets: Sp500Sheets): ExplainerScene | null {
  if (!h) return null;
  const r10 = h.reach.find((r) => r.level === -10), r20 = h.reach.find((r) => r.level === -20), r30 = h.reach.find((r) => r.level === -30);
  const lg = h.longest;
  const narration = `最高値からの下落率を全期間で見ると、${h.crashes.length}回の大きな下落がありました。最大は${pctT(h.maxDD)}です。暦年で見ると、その年のうちにマイナス10%に達した年は${r10?.share}%、マイナス20%は${r20?.share}%、マイナス30%は${r30?.share}%ありました。${lg ? `最高値の回復に最も長くかかったのは、${ymJ(lg.peakDate)}からの約${lg.years}年です。` : ''}`;
  const reading = `さいたかねからの、げらくりつを、ぜんきかんで、みると、${intR(h.crashes.length)}かいの、おおきな、げらくが、ありました。さいだいは、${pctR(h.maxDD)}です。れきねんで、みると、そのとしの、うちに、まいなす、じゅっぱーせんとに、たっした、としは、${numR(r10?.share ?? 0)}ぱーせんと、まいなす、にじゅっぱーせんとは、${numR(r20?.share ?? 0)}ぱーせんと、まいなす、さんじゅっぱーせんとは、${numR(r30?.share ?? 0)}ぱーせんと、ありました。${lg ? `さいたかねの、かいふくに、もっとも、ながく、かかったのは、${ymR(lg.peakDate)}からの、やく、${numR(lg.years)}ねんです。` : ''}`;
  return scene('暴落の歴史（DDチャート）', `最高値からの下落率の推移（全期間・主な暴落）`, narration, reading, {
    ...emptyVisual('ddHistory'), heading: '暴落は、何度も起きてきた', subheading: `最高値からの下落率（DD）の推移・横線は暦年で到達した年の割合`, source: SRC(label, sheets),
    ddHistory: {
      points: h.points,
      labels: [...h.crashes].sort((a, b) => a.y - b.y).map((c) => ({ x: c.x, y: c.y, label: `${c.label} ${pctT(c.troughDD, 0)}` })), // 深い順（置き場所が足りないときは浅いものから省く）
      hLines: h.reach.filter((r) => r.level <= -10).map((r) => ({ y: r.level, label: `到達した年 ${r.share}%` })),
      highlight: lg ? { from: yearFrac(lg.peakDate), to: yearFrac(lg.recoveryDate ?? sheets.asOf), label: `回復まで約${lg.years}年` } : undefined,
    },
  }, 14);
}

// ---------------------------------------------------------------- S14 現在地点からの3パターン
const OUTCOME_R = {
  athZone: ['さいたかねを、こうしん', 'さいたかねけん、まいなす、さんぱーせんといないで、すいい', 'まいなす、さんぱーせんとを、こえる、げらくきょくめんいり'],
  drawdown: ['まいなす、さんぱーせんといないまで、かいふく', 'おなじ、すいじゅんで、すいい', 'さらに、にぽいんと、いじょう、げらく'],
};
export function athZoneScene(a: AthZoneSheet | null, label: string, sheets: Sp500Sheets): ExplainerScene | null {
  if (!a) return null;
  const last = a.band[a.band.length - 1];
  const fan: FanSpec = {
    series: [
      { key: 'lead', label: '直近の値動き（今日＝0%）', role: 'focus', points: a.lead },
      { key: 'mid', label: '似た状態だった日のその後（中央値）', role: 'median', points: a.band.map((p) => ({ x: p.x, y: p.mid })), endLabel: `中央値 ${pctT(last ? last.mid : null)}` },
    ],
    band: { label: '10〜90%の範囲', points: a.band.map((p) => ({ x: p.x, lo: p.lo, hi: p.hi })) },
    xUnit: '営業日', yUnit: '%', nowX: 0, nowLabel: '今日',
    chips: a.outcomes.map((o, i) => ({ label: o.label, value: `${o.share}%`, role: i === 0 ? 'focus' : i === 2 ? 'warn' : 'median' })),
  };
  const stateT = a.state === 'athZone' ? `最高値から${pctT(a.dd)}の「最高値圏」` : `最高値から${pctT(a.dd)}の下落局面`;
  const stateR = a.state === 'athZone' ? `さいたかねから、${pctR(a.dd)}の、さいたかねけん` : `さいたかねから、${pctR(a.dd)}の、げらくきょくめん`;
  const narration = `現在は${stateT}にいます。過去に同じような状態だった${a.n}日について、その後${a.horizon}営業日の結果を数えると、${a.outcomes.map((o) => `${o.label}が${o.share}%`).join('、')}でした。${last ? `${last.x}営業日後の中央値は${pctT(last.mid)}、10〜90%の範囲は${pctT(last.lo)}から${pctT(last.hi)}です。` : ''}`;
  const reading = `げんざいは、${stateR}に、います。かこに、おなじような、じょうたいだった、${intR(a.n)}にちについて、そのご、${intR(a.horizon)}えいぎょうびの、けっかを、かぞえると、${a.outcomes.map((o, i) => `${OUTCOME_R[a.state][i]}が、${numR(o.share)}ぱーせんと`).join('、')}でした。${last ? `${intR(last.x)}えいぎょうびごの、ちゅうおうちは、${pctR(last.mid)}、じゅうから、きゅうじゅっぱーせんとの、はんいは、${pctR(last.lo)}から、${pctR(last.hi)}です。` : ''}`;
  return scene('現在地点からの3パターン', `${a.state === 'athZone' ? '最高値圏' : '下落局面'}から、この先どうなりやすいか（${a.n}日の実績）`, narration, reading, {
    ...emptyVisual('fan'), heading: a.state === 'athZone' ? '最高値圏から、この先どうなりやすいか' : '下落局面から、この先どうなりやすいか',
    subheading: `最高値から${pctT(a.dd)}と似た状態だった日の、${a.horizon}営業日以内の結果（${a.n}日）`, source: SRC(label, sheets), fan,
  }, 14);
}

// ---------------------------------------------------------------- S15 長期ローリングリターン
const LONG_PERIODS = [{ label: '5年', tradingDays: 1260 }, { label: '10年', tradingDays: 2520 }, { label: '20年', tradingDays: 5040 }, { label: '30年', tradingDays: 7560 }];
export function longRollingScene(points: { date: string | Date; close?: number | null; price?: number | null }[], label: string, sheets: Sp500Sheets): ExplainerScene | null {
  const rr = summarizeRollingReturnsForVideo(points, LONG_PERIODS);
  if (!rr) return null;
  const groups = rr.groups.filter((g) => g.n >= 5);
  if (!groups.length) return null;
  const years = (g: { tradingDays: number }) => g.tradingDays / 252;
  const cagr = (v: number, y: number) => Math.round((Math.pow(1 + v / 100, 1 / y) - 1) * 1000) / 10;
  const dg = groups.map((g) => {
    const s = g.samples.map((v) => cagr(v, years(g)));
    const m = s.reduce((a, b) => a + b, 0) / s.length;
    return { label: g.label, samples: s, mean: Math.round(m * 10) / 10, win: Math.round((g.winRate ?? 0) * 1000) / 10, n: g.n };
  });
  const narration = `保有期間を5年から30年に延ばして、同じように各年の年初から計算しました。値は年率の騰落率です。${dg.map((g) => `${g.label}保有でプラスだった割合は${g.win}%（${g.n}標本）、年率の平均は${pctT(g.mean)}`).join('、')}でした。期間が長いほど、マイナスで終わる例が少なくなっています。`;
  const reading = `ほゆうきかんを、ごねんから、さんじゅうねんに、のばして、おなじように、かくねんの、ねんしから、けいさんしました。あたいは、ねんりつの、とうらくりつです。${dg.map((g) => `${intR(Number(g.label.replace('年', '')))}ねん、ほゆうで、ぷらすだった、わりあいは、${numR(g.win)}ぱーせんと、${intR(g.n)}ひょうほん、ねんりつの、へいきんは、${pctR(g.mean)}`).join('、')}でした。きかんが、ながいほど、まいなすで、おわる、れいが、すくなくなっています。`;
  return scene('長期ローリングリターン', `長期保有の勝率と年率リターン（5〜30年・各年始点）`, narration, reading, {
    ...emptyVisual('distribution'), heading: '長期で見ると、ほぼ負けない', subheading: `保有期間別の年率リターン（1点＝各年の年初から保有した場合）`, unit: '%', source: SRC(label, sheets),
    distribution: { unit: '%', groups: dg.map((g) => ({ label: `${g.label}（勝率${g.win}%）`, samples: g.samples, mean: g.mean })) },
  }, 13);
}

// ---------------------------------------------------------------- S16 年初来パス比較
const MONTH_TICKS = [{ x: 0, label: '1月' }, { x: 42, label: '3月' }, { x: 84, label: '5月' }, { x: 126, label: '7月' }, { x: 168, label: '9月' }, { x: 210, label: '11月' }, { x: 251, label: '12月末' }];
export function ytdPathsScene(y: YtdPathsSheet | null, label: string, sheets: Sp500Sheets): ExplainerScene | null {
  if (!y) return null;
  const fan: FanSpec = {
    series: [
      ...y.past.map((p) => ({ key: String(p.year), label: `${p.year}年`, role: 'bg' as const, points: p.path })),
      { key: 'avg', label: `歴代平均（${y.nYears}年）`, role: 'avg', points: y.avg, endLabel: `平均 ${pctT(y.avg[y.avg.length - 1]?.y)}` },
      { key: 'cur', label: `${y.year}年（今年）`, role: 'focus', points: y.current, endLabel: `今年 ${pctT(y.ytdNow)}` },
    ],
    band: y.outlook.length > 1 ? { label: '今年の残りに過去の値動きを当てはめた範囲（10〜90%）', points: y.outlook.map((p) => ({ x: p.x, lo: p.lo, hi: p.hi })) } : undefined,
    xTicks: MONTH_TICKS, yUnit: '%', nowX: y.k, nowLabel: '現在', bgLegend: `過去の各年（${y.nYears}本）`, clipBg: true,
    chips: [
      { label: `${y.year}年の年初来`, value: pctT(y.ytdNow), role: 'focus' },
      { label: '同じ時点の歴代平均', value: pctT(y.avgAtK), role: 'avg' },
      { label: `${y.nYears}年中の順位`, value: `上位${y.rankPct}%` },
    ],
  };
  const narration = `過去${y.nYears}年分の、年初からの値動きをすべて重ねました。今年は年初来${pctT(y.ytdNow)}で、同じ時点の歴代平均${pctT(y.avgAtK)}を${y.ytdNow >= y.avgAtK ? '上回り' : '下回り'}、${y.nYears}年の中で上位${y.rankPct}%の位置にいます。`;
  const reading = `かこ、${intR(y.nYears)}ねんぶんの、ねんしからの、ねうごきを、すべて、かさねました。ことしは、ねんしらい、${pctR(y.ytdNow)}で、おなじ、じてんの、れきだいへいきん、${pctR(y.avgAtK)}を、${y.ytdNow >= y.avgAtK ? 'うわまわり' : 'したまわり'}、${intR(y.nYears)}ねんの、なかで、じょうい、${numR(y.rankPct)}ぱーせんとの、いちに、います。`;
  return scene('年初来パス比較', `今年の年初来 vs 過去${y.nYears}年（歴代平均・順位）`, narration, reading, {
    ...emptyVisual('fan'), heading: '今年の値動きは、強い？弱い？', subheading: `年初来騰落率の推移（前年末＝0%）・過去${y.nYears}年と比較`, source: SRC(label, sheets), fan,
  }, 13);
}

// ---------------------------------------------------------------- S17-23 将来シナリオ
const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'];
const CIRCLED_R = ['いち', 'に', 'さん', 'よん', 'ご', 'ろく', 'なな', 'はち'];
export function scenarioScene(sc: ScenarioSheet, i: number, label: string, sheets: Sp500Sheets, maxYears = 20): ExplainerScene | null {
  if (!sc.years.length) return null;
  const shown = [...sc.years].sort((a, b) => a.score - b.score).slice(0, maxYears).sort((a, b) => a.year - b.year);
  const one = sc.marks.find((m) => m.label === '1年後')?.y ?? null, three = sc.marks.find((m) => m.label === '3年後')?.y ?? null, ye = sc.marks.find((m) => m.label === '年末')?.y ?? null;
  // 該当が少ない（5年以下）ときは、1本ずつ色を分けて「上振れ・中心・下振れ」が分かるようにする
  const few = sc.years.length <= 5;
  const finals = shown.map((y) => ({ year: y.year, v: y.path[y.path.length - 1]?.y ?? 0 })).sort((a, b) => b.v - a.v);
  const fewRole = (year: number): FanRole => (year === finals[0]?.year ? 'focus' : year === finals[finals.length - 1]?.year ? 'warn' : 'avg');
  const fewName = (year: number) => (year === finals[0]?.year ? '上振れ' : year === finals[finals.length - 1]?.year ? '下振れ' : '中心');
  const fan: FanSpec = {
    series: [
      ...shown.map((y) => ({ key: String(y.year), label: few ? `${fewName(y.year)}：${y.year}年` : `${y.year}年`, role: few ? fewRole(y.year) : ('bg' as FanRole), points: y.path, endLabel: few ? `${y.year}年 ${pctT(y.path[y.path.length - 1]?.y)}` : undefined })),
      { key: 'median', label: `中央値（${sc.n}年）`, role: 'median', points: sc.median, endLabel: three != null ? `中央値 ${pctT(three)}` : undefined },
    ],
    markers: sc.marks.filter((m) => m.y != null).map((m) => ({ x: m.x, y: m.y as number, label: `${m.label} ${pctT(m.y)}`, role: 'median' as const })),
    xTicks: [{ x: 0, label: '現在' }, { x: 252, label: '1年後' }, { x: 504, label: '2年後' }, { x: 756, label: '3年後' }],
    yUnit: '%', nowX: 0, nowLabel: '現在', bgLegend: `該当した年（${shown.length}本）`,
    chips: [
      { label: '該当した年', value: `${sc.n}年${sc.relaxed ? '（条件を緩和）' : ''}` },
      { label: '年末（中央値）', value: pctT(ye), role: 'median' },
      { label: '1年後（中央値）', value: pctT(one), role: 'median' },
      { label: '3年後の範囲', value: sc.range3y ? `${pctT(sc.range3y.lo, 0)}〜${pctT(sc.range3y.hi, 0)}` : '―', role: 'warn' },
    ],
  };
  const relaxedT = sc.relaxed ? `すべての条件を満たす年は3年未満だったため、条件に最も近い${sc.n}年を選びました。` : '';
  const relaxedR = sc.relaxed ? `すべての、じょうけんを、みたす、としは、さんねん、みまんだったため、じょうけんに、もっとも、ちかい、${intR(sc.n)}ねんを、えらびました。` : '';
  const narration = `将来シナリオ${CIRCLED[i]}は、${sc.title}です。条件は${sc.conditionText}で、該当した${sc.n}年について、同じ時点からその後3年間の値動きを重ねました。${relaxedT}中央値は、年末${pctT(ye)}、1年後${pctT(one)}、3年後${pctT(three)}${sc.range3y ? `で、3年後の結果は${pctT(sc.range3y.lo)}から${pctT(sc.range3y.hi)}まで分かれました` : 'でした'}。`;
  const reading = `しょうらい、しなりお、${CIRCLED_R[i]}は、${sc.key === 'all' ? 'いつつの、じょうけんが、かさなった、とし' : sc.key === 'ytdUp' ? 'ふたつの、じょうけんが、かさなった、とし' : 'じょうけんが、にている、とし'}です。がいとうした、${intR(sc.n)}ねんについて、おなじ、じてんから、そのご、さんねんかんの、ねうごきを、かさねました。${relaxedR}ちゅうおうちは、ねんまつ、${pctR(ye)}、いちねんご、${pctR(one)}、さんねんご、${pctR(three)}${sc.range3y ? `で、さんねんごの、けっかは、${pctR(sc.range3y.lo)}から、${pctR(sc.range3y.hi)}まで、わかれました` : 'でした'}。`;
  return scene(`将来シナリオ${CIRCLED[i]}`, `将来シナリオ${CIRCLED[i]}：${sc.title}（${sc.n}年）`, narration, reading, {
    ...emptyVisual('fan'), heading: `将来シナリオ${CIRCLED[i]} ${sc.title}`, subheading: `条件：${sc.conditionText}・その後3年間（現在＝0%）`, source: SRC(label, sheets), fan,
  }, 13);
}

// ---------------------------------------------------------------- S24 まとめの事実・S25 免責事項
export function factsScene(f: FactsSheet | null, label: string, sheets: Sp500Sheets): ExplainerScene | null {
  if (!f) return null;
  const items = [
    `指数は${f.years}年で約${f.multiple}倍（年率${pctT(f.cagr)}）に成長`,
    `年間の騰落率がマイナスの年は${f.negativeYearShare}%（${f.completeYears}年中）`,
    `DD−3%到達は年${f.dd3PerYear}回、そのうち${f.dd5Share}%が−5%まで進行`,
    `最高値の回復に最長約${f.longestYears}年（${ymJ(f.longestFrom)}〜${f.longestTo ? ymJ(f.longestTo) : '未回復'}）`,
    `50%を超える暴落は${f.crash50}回（最大${pctT(f.maxDD)}）`,
    `${f.year}年はすでに${f.athThisYear}回、最高値を更新`,
  ];
  const narration = `最後に、過去${f.years}年のデータで分かったことを整理します。${items.join('。')}。`;
  const reading = `さいごに、かこ、${intR(f.years)}ねんの、でーたで、わかったことを、せいりします。しすうは、${intR(f.years)}ねんで、やく、${intR(f.multiple)}ばい、ねんりつ、${pctR(f.cagr)}に、せいちょう。ねんかんの、とうらくりつが、まいなすの、としは、${numR(f.negativeYearShare)}ぱーせんと。でぃーでぃー、まいなす、さんぱーせんと、とうたつは、ねんに、${numR(f.dd3PerYear)}かい、そのうち、${numR(f.dd5Share)}ぱーせんとが、まいなす、ごぱーせんとまで、しんこう。さいたかねの、かいふくに、さいちょう、やく、${numR(f.longestYears)}ねん。ごじゅっぱーせんとを、こえる、ぼうらくは、${intR(f.crash50)}かい。${intR(f.year)}ねんは、すでに、${intR(f.athThisYear)}かい、さいたかねを、こうしん。`;
  return scene('まとめ：分かった事実', `過去${f.years}年間で分かった、6つの事実`, narration, reading, {
    ...emptyVisual('summary'), heading: `過去${f.years}年間で分かった、6つの事実`, subheading: `${label}・${f.startYear}〜${f.year}年の実績`, source: SRC(label, sheets),
    items: items.map((t) => ({ label: t, value: '', text: '', icon: 'check' as const })),
  }, 16);
}

export function disclaimerScene(): ExplainerScene {
  const items = [
    '予想値・予想幅は過去データにもとづく参考情報です',
    '将来の運用成果を保証するものではありません',
    '投資助言・勧誘を目的としたものではありません',
    '元本割れのリスクがあります',
    '過去と同じ条件・結果が再び起きるとは限りません',
    '標本数が少ない結果は特に不確実性が大きくなります',
    '投資の判断はご自身の責任でお願いします',
  ];
  return scene('免責事項', '本動画の予測についてのご注意', `本動画で示した予想値や予想の幅は、過去のデータにもとづく参考情報であり、将来の運用成果を保証するものではありません。投資助言や勧誘を目的としたものではなく、元本割れのリスクがあります。投資の判断はご自身の責任でお願いします。`,
    `ほんどうがで、しめした、よそうちや、よそうの、はばは、かこの、でーたに、もとづく、さんこうじょうほうであり、しょうらいの、うんようせいかを、ほしょうするものでは、ありません。とうしじょげんや、かんゆうを、もくてきとしたものではなく、がんぽんわれの、りすくが、あります。とうしの、はんだんは、ごじしんの、せきにんで、おねがいします。`,
    { ...emptyVisual('summary'), heading: '本動画の予測についてのご注意', subheading: '必ずお読みください', items: items.map((t) => ({ label: t, value: '', text: '', icon: 'warning' as const })) }, 12);
}

/** シートの計算結果から、モックアップの順の場面一覧（章ごと）を作るための部品をまとめて返す */
export function buildSheetScenes(sheets: Sp500Sheets | null, points: { date: string | Date; close?: number | null; price?: number | null }[] | null, label = 'S&P500') {
  if (!sheets) return null;
  return {
    zoom: zoomScene(sheets.zoom, label, sheets),
    upDown: upDownScene(sheets.upDown, label, sheets),
    ddOverlay: ddOverlayScene(sheets.ddOverlay, label, sheets),
    ddHistory: ddHistoryScene(sheets.ddHistory, label, sheets),
    athZone: athZoneScene(sheets.athZone, label, sheets),
    longRolling: points ? longRollingScene(points, label, sheets) : null,
    ytdPaths: ytdPathsScene(sheets.ytdPaths, label, sheets),
    scenarios: (sheets.scenarios?.scenarios ?? []).map((s, i) => scenarioScene(s, i, label, sheets)).filter((x): x is ExplainerScene => !!x),
    facts: factsScene(sheets.facts, label, sheets),
    disclaimer: disclaimerScene(),
  };
}
