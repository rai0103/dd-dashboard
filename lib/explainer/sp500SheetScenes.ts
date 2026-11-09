// [Stage E-16] S&P500動画（モックアップ25枚）の固定場面ビルダー。lib/sp500Sheets.tsが日次終値から計算した数値を
// そのまま場面（図解の仕様データ＋ナレーション＋ひらがなの読み上げ文）にする。AIには数値を作文させない
// （athPaceScene.ts等と同じ方針）。データが足りないシートはnullを返し、その場面は動画に入れない。
import { newSceneId, minSecFor } from './scriptModel';
import { emptyVisual } from './types';
import type { ExplainerScene, FanSpec, FanSeries, FanRole, VisualSpec, VisualItem, BranchSpec } from './types';
import type { Sp500Sheets, ScenarioSheet, ZoomSheet, UpDownSheet, DdOverlaySheet, DdHistorySheet, AthZoneSheet, YtdPathsSheet, FactsSheet, TitleSheet, DdDefinitionSheet, BranchSheet, DropDaySheet, AthPaceSheet, XY } from '../sp500Sheets';
import { crashName } from '../sp500Sheets';
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
/**
 * AIが作ったタイトル場面に、全期間の推移を背景として添える。template=true（S&P500モード）のときは、
 * 見出しを固定のテンプレ「S&P500最新分析」／「過去◯年間のチャートから今後を検証・分析」にする（年数は実データから）。
 */
export function decorateTitleScene(sc: ExplainerScene, t: TitleSheet | null, template = false): ExplainerScene {
  if (!t || sc.visual.kind !== 'title') return sc;
  if (template) {
    const years = Math.round(t.years);
    return { ...sc, visual: { ...sc.visual, heading: 'S&P500最新分析', subheading: `過去${years}年間のチャートから今後を検証・分析`, background: t.background, titleNote: '※過去のデータにもとづく参考情報であり、将来の成果を保証するものではありません' } };
  }
  const sub = sc.visual.subheading || `${t.startDate.slice(0, 4)}〜${t.endDate.slice(0, 4)}年・約${Math.round(t.years)}年の実データで分析`;
  return { ...sc, visual: { ...sc.visual, background: t.background, subheading: sub, titleNote: '※過去のデータにもとづく参考情報であり、将来の成果を保証するものではありません' } };
}

// ---------------------------------------------------------------- S3 DDの定義（実例のチャート）
export function ddDefinitionScene(d: DdDefinitionSheet | null, label: string, sheets: Sp500Sheets): ExplainerScene | null {
  if (!d) return null;
  const name = d.label.replace(/^[\d-]+年\s*/, '');
  const fan: FanSpec = {
    series: [{ key: 'ex', label: `実例：${ymJ(d.peakDate)}〜${ymJ(d.recoveryDate)}（${name}）`, role: 'focus', points: d.path }],
    markers: [
      { x: 0, y: 0, label: '最高値（ATH）', role: 'median' },
      { x: d.troughX, y: d.mdd, label: `底：最大DD（MDD）${pctT(d.mdd)}`, role: 'warn' },
      { x: d.recX, y: 0, label: '最高値を回復', role: 'focus' },
    ],
    hLines: [{ y: d.mdd, label: `MDD ${pctT(d.mdd)}` }],
    xTicks: [{ x: 0, label: ymJ(d.peakDate) }, { x: d.troughX, label: ymJ(d.troughDate) }, { x: d.recX, label: ymJ(d.recoveryDate) }],
    yUnit: '%',
    chips: [
      { label: 'DD期間（最高値→回復）', value: `${d.ddDays}営業日` },
      { label: '底から回復まで', value: `${d.recoverDays}営業日` },
      { label: 'DD−3%到達（年平均）', value: `${d.dd3PerYear}回`, role: 'median' },
      { label: 'そのうち−5%まで進んだ割合', value: `${d.dd5Share}%`, role: 'warn' },
    ],
  };
  const narration = `ドローダウン、DDとは、それまでの最高値からの下落率のことです。例えば${ymJ(d.peakDate)}の最高値から、${ymJ(d.troughDate)}の底まで${pctT(d.mdd)}下がり、この最も深い下落率を最大ドローダウン、MDDと呼びます。最高値を回復したのは${ymJ(d.recoveryDate)}で、この間がDD期間です。過去の実績では、DDがマイナス3%に達する局面が年に平均${d.dd3PerYear}回あり、そのうち${d.dd5Share}%がマイナス5%まで進みました。`;
  const reading = `どろーだうんとは、それまでの、さいたかねからの、げらくりつの、ことです。たとえば、${ymR(d.peakDate)}の、さいたかねから、${ymR(d.troughDate)}の、そこまで、${pctR(d.mdd)}、さがり、この、もっとも、ふかい、げらくりつを、さいだい、どろーだうん、まっくすどろーだうんと、よびます。さいたかねを、かいふくしたのは、${ymR(d.recoveryDate)}で、このあいだが、でぃーでぃー、きかんです。かこの、じっせきでは、でぃーでぃーが、まいなす、さんぱーせんとに、たっする、きょくめんが、ねんに、へいきん、${numR(d.dd3PerYear)}かい、あり、そのうち、${numR(d.dd5Share)}ぱーせんとが、まいなす、ごぱーせんとまで、すすみました。`;
  return scene('DD（ドローダウン）とは', `DD・MDD・DD期間（実例：${ymJ(d.peakDate)}〜${ymJ(d.recoveryDate)}）`, narration, reading, {
    ...emptyVisual('fan'), heading: 'DD（ドローダウン）とは', subheading: `実例：${ymJ(d.peakDate)}の最高値 → 底 → 回復（縦軸：最高値からの下落率）`, source: SRC(label, sheets), fan,
  }, 14);
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
      note: `大統領任期${u.termYear}年目${u.termYear === 2 ? '＝中間選挙の年' : u.termYear === 4 ? '＝大統領選挙の年' : ''}：4年周期の同じ年の平均\n前日が${u.lastDayUp ? '上昇' : '下落'}した日の翌営業日に上昇した割合（全期間）：${nextP}%`,
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
  const dName = d ? crashName(Number(d.startDate.slice(0, 4))) : '';
  const dLabel = d ? (/の下落$/.test(dName) ? d.label.replace('〜', '') : dName) : '';
  const cnt = (lo: number, hi: number) => o.paths.filter((p) => p.minDD <= lo && p.minDD > hi).length;
  const fan: FanSpec = {
    series, xUnit: '営業日', yUnit: '%',
    hLines: [{ y: -3, label: '−3%（起点）' }, { y: -5, label: '−5%' }, { y: -10, label: '−10%' }],
    markers: d ? [{ x: d.minT, y: d.minDD, label: `${dLabel} 最大${pctT(d.minDD)}`, role: 'warn' }] : [],
    chips: [
      { label: '最大DD −5%未満', value: `${cnt(0, -5)}件` },
      { label: '最大DD −5〜−10%', value: `${cnt(-5, -10)}件`, role: 'median' },
      { label: '最大DD −10〜−20%', value: `${cnt(-10, -20)}件`, role: 'warn' },
      { label: '最大DD −20%超', value: `${cnt(-20, -1000)}件`, role: 'warn' },
    ],
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
  const narration = `${intro}${o.window}営業日後の中央値は${pctT(medEnd)}、最も深かったのは${d ? `${d.label.replace('〜', '')}からの局面（${dLabel}）で${pctT(d.minDD)}` : '―'}です。過去全体では、DD−3%到達は${o.total}回ありました。`;
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
  const narration = `最高値からの下落率を全期間で見ると、${h.crashes.length}回の大きな下落がありました。最大は${pctT(h.maxDD)}です。暦年で見ると、その年のうちにマイナス10%に達した年は${r10?.share}%、マイナス20%は${r20?.share}%、マイナス30%は${r30?.share}%ありました。${lg ? `最高値の回復に最も長くかかったのは、${ymJ(lg.peakDate)}からの約${lg.years}年です。` : ''}${h.permanent.length ? `一度回復しても再び下回った期間まで含めると、${h.permanent.map((pm) => `${pm.label.split('：')[1]}の約${Math.round(pm.years)}年`).join('と、')}は、本格的な回復までに長い時間がかかりました。` : ''}`;
  const reading = `さいたかねからの、げらくりつを、ぜんきかんで、みると、${intR(h.crashes.length)}かいの、おおきな、げらくが、ありました。さいだいは、${pctR(h.maxDD)}です。れきねんで、みると、そのとしの、うちに、まいなす、じゅっぱーせんとに、たっした、としは、${numR(r10?.share ?? 0)}ぱーせんと、まいなす、にじゅっぱーせんとは、${numR(r20?.share ?? 0)}ぱーせんと、まいなす、さんじゅっぱーせんとは、${numR(r30?.share ?? 0)}ぱーせんと、ありました。${lg ? `さいたかねの、かいふくに、もっとも、ながく、かかったのは、${ymR(lg.peakDate)}からの、やく、${numR(lg.years)}ねんです。` : ''}${h.permanent.length ? `いちど、かいふくしても、ふたたび、したまわった、きかんまで、ふくめると、${h.permanent.map((pm) => `${intR(Number(pm.peakDate.slice(0, 4)))}ねんから、${intR(Number((pm.recoveryDate ?? sheets.asOf).slice(0, 4)))}ねんの、やく、${intR(pm.years)}ねん`).join('と、')}は、ほんかくてきな、かいふくまでに、ながい、じかんが、かかりました。` : ''}`;
  return scene('暴落の歴史（DDチャート）', `最高値からの下落率の推移（全期間・主な暴落）`, narration, reading, {
    ...emptyVisual('ddHistory'), heading: '暴落は、何度も起きてきた', subheading: `最高値からの下落率（DD）の推移・横線は暦年で到達した年の割合`, source: SRC(label, sheets),
    ddHistory: {
      points: h.points,
      labels: [...h.crashes].sort((a, b) => a.y - b.y).map((c) => ({ x: c.x, y: c.y, label: `${c.label} ${pctT(c.troughDD, 0)}` })), // 深い順（置き場所が足りないときは浅いものから省く）
      hLines: h.reach.filter((r) => r.level <= -10).map((r) => ({ y: r.level, label: `到達した年 ${r.share}%` })),
      highlights: h.permanent.map((pm) => ({ from: yearFrac(pm.peakDate), to: yearFrac(pm.recoveryDate ?? sheets.asOf), label: `${pm.label.split('：')[1] ?? ''} 本格回復まで約${Math.round(pm.years)}年` })),
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
  const now = a.daysSinceATH, last = a.forward[a.forward.length - 1];
  const fan: FanSpec = {
    series: [
      { key: 'path', label: `実際の値動き（最高値更新の1ヶ月前〜今日）`, role: 'focus', points: a.path, endLabel: `今日 ${pctT(a.dd)}` },
      { key: 'hi', label: '上限（上位10%）', role: 'avg', dash: true, points: a.forward.map((p) => ({ x: p.x, y: p.hi })), endLabel: `上限 ${pctT(last?.hi)}` },
      { key: 'mean', label: '平均', role: 'median', dash: true, points: a.forward.map((p) => ({ x: p.x, y: p.mean })), endLabel: `平均 ${pctT(last?.mean)}` },
      { key: 'lo', label: '下限（下位10%）', role: 'warn', dash: true, points: a.forward.map((p) => ({ x: p.x, y: p.lo })), endLabel: `下限 ${pctT(last?.lo)}` },
    ],
    band: { label: '過去実績の範囲（10〜90%）', points: a.forward.map((p) => ({ x: p.x, lo: p.lo, hi: p.hi })) },
    xTicks: [{ x: a.path[0]?.x ?? -21, label: '1ヶ月前' }, { x: 0, label: `最高値更新（${md(a.athDate)}）` }, { x: now, label: '今日' }, { x: last?.x ?? now + 60, label: `${(last?.x ?? now) - now}営業日後` }],
    yUnit: '%', nowX: now, nowLabel: '今日',
    hLines: [{ y: -3, label: '−3%（DD局面の入口）' }],
    chips: a.base.outcomes.map((o, i) => ({ label: o.label, value: `${o.share}%`, role: (i === 0 ? 'focus' : i === 2 ? 'warn' : 'median') as FanRole })),
    notePos: 'bottom',
    note: a.state === 'drawdown'
      ? `【DD局面中の分岐】現在${pctT(a.dd)}。同じ水準だった日の${a.horizon}営業日以内：\n${a.current.outcomes.map((o) => `${o.label} ${o.share}%`).join('／')}`
      : `最高値更新からDD局面入りした割合（累積）：${a.ddEntryAfterAth.map((x) => `${x.days}日以内${x.share}%`).join('・')}`,
  };
  const stateT = a.state === 'athZone' ? `最高値から${pctT(a.dd)}の最高値圏` : `最高値から${pctT(a.dd)}のDD局面`;
  const stateR = a.state === 'athZone' ? `さいたかねから、${pctR(a.dd)}の、さいたかねけん` : `さいたかねから、${pctR(a.dd)}の、でぃーでぃーきょくめん`;
  const baseT = a.base.outcomes.map((o) => `${o.label}が${o.share}%`).join('、');
  const baseR = a.base.outcomes.map((o, i) => `${OUTCOME_R.athZone[i]}が、${numR(o.share)}ぱーせんと`).join('、');
  const curT = a.state === 'drawdown' ? `現在はDD局面に入っていて、同じ水準だった過去${a.current.n}日では、${a.current.outcomes.map((o) => `${o.label}が${o.share}%`).join('、')}でした。` : '';
  const curR = a.state === 'drawdown' ? `げんざいは、でぃーでぃーきょくめんに、はいっていて、おなじ、すいじゅんだった、かこ、${intR(a.current.n)}にちでは、${a.current.outcomes.map((o, i) => `${OUTCOME_R.drawdown[i]}が、${numR(o.share)}ぱーせんと`).join('、')}でした。` : '';
  const narration = `${md(a.athDate)}の最高値更新の1ヶ月前から今日までの値動きです。今は${stateT}にいます。過去、最高値圏にいた日の${a.horizon}営業日以内の結果は、${baseT}でした。${curT}${last ? `この先${last.x - now}営業日の平均は${pctT(last.mean)}、上限${pctT(last.hi)}、下限${pctT(last.lo)}です。` : ''}`;
  const reading = `${intR(Number(a.athDate.slice(5, 7)))}がつ、${intR(Number(a.athDate.slice(8, 10)))}にちの、さいたかね、こうしんの、いっかげつまえから、きょうまでの、ねうごきです。いまは、${stateR}に、います。かこ、さいたかねけんに、いた、ひの、${intR(a.horizon)}えいぎょうび、いないの、けっかは、${baseR}でした。${curR}${last ? `このさき、${intR(last.x - now)}えいぎょうびの、へいきんは、${pctR(last.mean)}、じょうげん、${pctR(last.hi)}、かげん、${pctR(last.lo)}です。` : ''}`;
  return scene('現在地点からの深掘り', `最高値圏から、この先どうなりやすいか（${a.state === 'drawdown' ? 'DD局面中の分岐つき' : '最高値圏'}）`, narration, reading, {
    ...emptyVisual('fan'), heading: '最高値圏から、この先どうなりやすいか',
    subheading: `チップ：最高値圏（−3%以内）から${a.horizon}営業日以内の結果・点線：過去実績の上限／平均／下限`, source: SRC(label, sheets), fan,
  }, 16);
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
  // 累計リターンを「何倍になったか」に直し、対数目盛のビーズウォームで描く（5年と30年を同じ図に並べるため）
  const dg = groups.map((g) => {
    const mult = g.samples.map((v) => Math.round((1 + v / 100) * 100) / 100);
    const meanMult = Math.round((mult.reduce((a, b) => a + b, 0) / mult.length) * 100) / 100;
    const meanCagr = Math.round((g.samples.map((v) => cagr(v, years(g))).reduce((a, b) => a + b, 0) / g.samples.length) * 10) / 10;
    return { label: g.label, samples: mult, mean: meanMult, cagr: meanCagr, win: Math.round((g.winRate ?? 0) * 1000) / 10, n: g.n, min: Math.min(...mult) };
  });
  const narration = `保有期間を5年から30年に延ばして、各年の年初から保有した場合の結果を、何倍になったかで並べました。目盛りは対数です。${dg.map((g) => `${g.label}保有でプラスだった割合は${g.win}%（${g.n}標本）、平均${g.mean}倍、年率にすると${pctT(g.cagr)}`).join('、')}でした。期間が長いほど、マイナスで終わる例が少なくなっています。`;
  const reading = `ほゆうきかんを、ごねんから、さんじゅうねんに、のばして、かくねんの、ねんしから、ほゆうした、ばあいの、けっかを、なんばいに、なったかで、ならべました。めもりは、たいすうです。${dg.map((g) => `${intR(Number(g.label.replace('年', '')))}ねん、ほゆうで、ぷらすだった、わりあいは、${numR(g.win)}ぱーせんと、${intR(g.n)}ひょうほん、へいきん、${numR(g.mean, 2)}ばい、ねんりつにすると、${pctR(g.cagr)}`).join('、')}でした。きかんが、ながいほど、まいなすで、おわる、れいが、すくなくなっています。`;
  return scene('長期ローリングリターン', `長期保有の勝率と何倍になったか（5〜30年・各年始点）`, narration, reading, {
    ...emptyVisual('distribution'), heading: '長期で見ると、ほぼ負けない', subheading: `保有期間別：何倍になったか（対数目盛・1点＝各年の年初から保有した場合・1倍未満＝マイナス）`, unit: '倍', source: SRC(label, sheets),
    distribution: { unit: '倍', logScale: true, groups: dg.map((g) => ({ label: `${g.label}（勝率${g.win}%・年率${pctT(g.cagr)}）`, samples: g.samples, mean: g.mean })) },
  }, 14);
}

// ---------------------------------------------------------------- S16 年初来パス比較
const MONTH_TICKS = [{ x: 0, label: '1月' }, { x: 42, label: '3月' }, { x: 84, label: '5月' }, { x: 126, label: '7月' }, { x: 168, label: '9月' }, { x: 210, label: '11月' }, { x: 251, label: '12月末' }];
export function ytdPathsScene(y: YtdPathsSheet | null, label: string, sheets: Sp500Sheets): ExplainerScene | null {
  if (!y) return null;
  const fan: FanSpec = {
    series: [
      ...y.past.map((p) => ({ key: String(p.year), label: `${p.year}年`, role: 'bg' as const, points: p.path })),
      { key: 'avg', label: `歴代平均（${y.nYears}年）`, role: 'avg', points: y.avg, endLabel: `歴代平均 ${pctT(y.avg[y.avg.length - 1]?.y)}` },
      { key: 'cur', label: `${y.year}年（今年）`, role: 'focus', points: y.current, endLabel: `今年 ${pctT(y.ytdNow)}` },
      ...(y.outlook.length > 1 ? [
        { key: 'oHi', label: '年末の上限（上位10%）', role: 'avg' as FanRole, dash: true, points: y.outlook.map((p) => ({ x: p.x, y: p.hi })), endLabel: `上限 ${pctT(y.outlook[y.outlook.length - 1].hi)}` },
        { key: 'oMean', label: '年末の平均', role: 'median' as FanRole, dash: true, points: y.outlook.map((p) => ({ x: p.x, y: p.mean })), endLabel: `今年の平均 ${pctT(y.outlook[y.outlook.length - 1].mean)}` },
        { key: 'oLo', label: '年末の下限（下位10%）', role: 'warn' as FanRole, dash: true, points: y.outlook.map((p) => ({ x: p.x, y: p.lo })), endLabel: `下限 ${pctT(y.outlook[y.outlook.length - 1].lo)}` },
      ] : []),
    ],
    band: y.outlook.length > 1 ? { label: '今年の残りに過去の値動きを当てはめた範囲（10〜90%）', points: y.outlook.map((p) => ({ x: p.x, lo: p.lo, hi: p.hi })) } : undefined,
    xTicks: MONTH_TICKS, yUnit: '%', nowX: y.k, nowLabel: '現在', bgLegend: `過去の各年（${y.nYears}本）`, clipBg: true,
    chips: [
      { label: `${y.year}年の年初来`, value: pctT(y.ytdNow), role: 'focus' },
      { label: '同じ時点の歴代平均', value: pctT(y.avgAtK), role: 'avg' },
      { label: `${y.nYears}年中の順位`, value: `上位${y.rankPct}%` },
    ],
  };
  const oEnd = y.outlook[y.outlook.length - 1];
  const narration = `過去${y.nYears}年分の、年初からの値動きをすべて重ねました。今年は年初来${pctT(y.ytdNow)}で、同じ時点の歴代平均${pctT(y.avgAtK)}を${y.ytdNow >= y.avgAtK ? '上回り' : '下回り'}、${y.nYears}年の中で上位${y.rankPct}%の位置にいます。${oEnd ? `残りの期間に過去の値動きを当てはめると、年末は平均${pctT(oEnd.mean)}、上限${pctT(oEnd.hi)}、下限${pctT(oEnd.lo)}です。` : ''}`;
  const reading = `かこ、${intR(y.nYears)}ねんぶんの、ねんしからの、ねうごきを、すべて、かさねました。ことしは、ねんしらい、${pctR(y.ytdNow)}で、おなじ、じてんの、れきだいへいきん、${pctR(y.avgAtK)}を、${y.ytdNow >= y.avgAtK ? 'うわまわり' : 'したまわり'}、${intR(y.nYears)}ねんの、なかで、じょうい、${numR(y.rankPct)}ぱーせんとの、いちに、います。${oEnd ? `のこりの、きかんに、かこの、ねうごきを、あてはめると、ねんまつは、へいきん、${pctR(oEnd.mean)}、じょうげん、${pctR(oEnd.hi)}、かげん、${pctR(oEnd.lo)}です。` : ''}`;
  return scene('年初来パス比較', `今年の年初来 vs 過去${y.nYears}年（歴代平均・順位）`, narration, reading, {
    ...emptyVisual('fan'), heading: '今年の値動きは、強い？弱い？', subheading: `年初来騰落率の推移（前年末＝0%）・過去${y.nYears}年と比較`, source: SRC(label, sheets), fan,
  }, 13);
}

// ---------------------------------------------------------------- S17-23 将来シナリオ
const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'];
const CIRCLED_R = ['いち', 'に', 'さん', 'よん', 'ご', 'ろく', 'なな', 'はち'];
export function scenarioScene(sc: ScenarioSheet, i: number, label: string, sheets: Sp500Sheets, maxYears = 20, lead: XY[] | null = null): ExplainerScene | null {
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
      // 全条件のシナリオ（⑦）だけ：今年の実績線を左に描き、その先を「予測」の枠で囲む（モックアップ23枚目）
      ...(lead && lead.length > 1 ? [{ key: 'lead', label: `${sheets.scenarios?.year ?? ''}年の実績（今日＝0%）`, role: 'lead' as FanRole, points: lead }] : []),
    ],
    ...(lead && lead.length > 1 ? { predictBox: { fromX: 0, label: '予測（該当年の実際のその後）' } } : {}),
    markers: sc.marks.filter((m) => m.y != null).map((m) => ({ x: m.x, y: m.y as number, label: `${m.label} ${pctT(m.y)}`, role: 'median' as const })),
    xTicks: [...(lead && lead.length > 1 ? [{ x: lead[0].x, label: '年初' }] : []), { x: 0, label: '現在' }, { x: 252, label: '1年後' }, { x: 504, label: '2年後' }, { x: 756, label: '3年後' }],
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

// ---------------------------------------------------------------- S9 DD速度センサーの分岐（実際の値動きを起点に）
export function branchScene(b: BranchSheet | null, label: string, sheets: Sp500Sheets, years: number): ExplainerScene | null {
  if (!b || !b.lead.length) return null;
  const endP = b.lead[b.lead.length - 1];
  const span = Math.max(8, Math.round((endP.x - (b.lead[0]?.x ?? 0)) * 1.2) || 8);
  const recP = Math.round((b.recovered / b.total) * 1000) / 10, judP = Math.round((b.judged / b.total) * 1000) / 10;
  const lead = b.lead.map((p) => ({ x: p.x, n: p.y }));
  let branch: BranchSpec, heading: string, narration: string, reading: string;
  if (b.state === 'normal' && b.zone) {
    const [nh, , dd] = b.zone;
    branch = {
      lead, thresholdY: -3, thresholdLabel: '−3%（DD局面の入口）', xLabel: '営業日', unit: '%',
      outcomes: [
        { key: 'up', label: '新高値を更新', tone: 'up', path: [{ x: endP.x, n: endP.y }, { x: endP.x + span, n: 0.5 }], stat: { title: `20営業日以内に新高値（${nh.share}%）`, lines: [`最高値圏（−3%以内）にいた日の実績`] } },
        { key: 'down', label: 'DD局面入り', tone: 'down', path: [{ x: endP.x, n: endP.y }, { x: endP.x + span, n: -4 }], stat: { title: `20営業日以内に−3%超（${dd.share}%）`, lines: [`入った場合、そのうち${judP}%は−5%まで進む`] } },
      ],
    };
    heading = '最高値圏から、この先はどちらに？';
    narration = `現在は最高値から${pctT(b.ddNow)}の最高値圏です。過去、最高値圏にいた日のうち、20営業日以内に新高値を更新したのは${nh.share}%、DD局面に入ったのは${dd.share}%でした。DD局面に入った場合、過去${years}年の${b.total}回のうち${judP}%がマイナス5%まで進んでいます。`;
    reading = `げんざいは、さいたかねから、${pctR(b.ddNow)}の、さいたかねけんです。かこ、さいたかねけんに、いた、ひの、うち、にじゅう、えいぎょうび、いないに、しんたかねを、こうしんしたのは、${numR(nh.share)}ぱーせんと、でぃーでぃーきょくめんに、はいったのは、${numR(dd.share)}ぱーせんとでした。でぃーでぃーきょくめんに、はいった、ばあい、かこ、${intR(years)}ねんの、${intR(b.total)}かいの、うち、${numR(judP)}ぱーせんとが、まいなす、ごぱーせんとまで、すすんでいます。`;
  } else {
    const isR5 = b.state === 'reached5' && b.bucket;
    const depthLines = (rates: { threshold: number; share: number }[]) => [`−${rates[0].threshold}%以上${rates[0].share}%／−${rates[1].threshold}%以上${rates[1].share}%`, `−${rates[2].threshold}%以上${rates[2].share}%／−${rates[3].threshold}%以上${rates[3].share}%`];
    branch = {
      lead, thresholdY: -3, thresholdLabel: '−3%（分岐の起点）', xLabel: '営業日', unit: '%',
      outcomes: [
        { key: 'recover', label: '−5%の前に新高値', tone: 'up', path: [{ x: endP.x, n: endP.y }, { x: endP.x + span, n: 0 }], stat: { title: `−5%を超えなかった（${recP}%）`, lines: [`DD−3%到達${b.total}回中 ${b.recovered}回`] } },
        { key: 'deeper', label: isR5 ? 'さらに下落（今回はこちら）' : '−5%を超えて進む', tone: 'down', path: [{ x: endP.x, n: endP.y }, { x: endP.x + span, n: isR5 ? b.bucket!.medianDD : -6 }],
          stat: isR5
            ? { title: `−5%を超えた（${judP}%・今回はこちら）`, lines: [`同じ速さ（${b.bucket!.label}）${b.bucket!.n}回のその後`, ...depthLines(b.bucket!.rates), `最大DDの中央値 ${pctT(b.bucket!.medianDD)}`] }
            : { title: `−5%を超えた（${judP}%）`, lines: [`DD−3%到達${b.total}回中 ${b.judged}回・その後`, ...depthLines(b.judgedRates)] } },
      ],
    };
    heading = '今回のDD−3%、その後はどちらに？';
    narration = isR5
      ? `過去${years}年でDD−3%に到達した${b.total}回は、−5%の前に新高値を回復した${recP}%と、−5%を超えて進んだ${judP}%に分かれます。今回は−3%から${b.acc}営業日で−5%を超えた、${b.bucket!.label.replace(/（.*）/, '')}の高速な下落です。同じ速さだった${b.bucket!.n}回では、その後の最大DDがマイナス8%以上に達したのが${b.bucket!.rates[0].share}%、マイナス10%以上が${b.bucket!.rates[1].share}%、マイナス15%以上が${b.bucket!.rates[2].share}%、マイナス20%以上が${b.bucket!.rates[3].share}%で、中央値は${pctT(b.bucket!.medianDD)}でした。`
      : `過去${years}年でDD−3%に到達した${b.total}回は、−5%の前に新高値を回復した${recP}%と、−5%を超えて進んだ${judP}%に分かれます。今回はDD−3%到達から${b.elapsed}営業日で、現在${pctT(b.ddNow)}です。`;
    reading = isR5
      ? `かこ、${intR(years)}ねんで、でぃーでぃー、まいなす、さんぱーせんとに、とうたつした、${intR(b.total)}かいは、まいなす、ごぱーせんとの、まえに、しんたかねを、かいふくした、${numR(recP)}ぱーせんとと、まいなす、ごぱーせんとを、こえて、すすんだ、${numR(judP)}ぱーせんとに、わかれます。こんかいは、まいなす、さんぱーせんとから、${intR(b.acc ?? 0)}えいぎょうびで、まいなす、ごぱーせんとを、こえた、こうそくな、げらくです。おなじ、はやさだった、${intR(b.bucket!.n)}かいでは、そのごの、さいだい、でぃーでぃーが、まいなす、はちぱーせんと、いじょうに、たっしたのが、${numR(b.bucket!.rates[0].share)}ぱーせんと、まいなす、じゅっぱーせんと、いじょうが、${numR(b.bucket!.rates[1].share)}ぱーせんと、まいなす、じゅうごぱーせんと、いじょうが、${numR(b.bucket!.rates[2].share)}ぱーせんと、まいなす、にじゅっぱーせんと、いじょうが、${numR(b.bucket!.rates[3].share)}ぱーせんとで、ちゅうおうちは、${pctR(b.bucket!.medianDD)}でした。`
      : `かこ、${intR(years)}ねんで、でぃーでぃー、まいなす、さんぱーせんとに、とうたつした、${intR(b.total)}かいは、まいなす、ごぱーせんとの、まえに、しんたかねを、かいふくした、${numR(recP)}ぱーせんとと、まいなす、ごぱーせんとを、こえて、すすんだ、${numR(judP)}ぱーせんとに、わかれます。こんかいは、でぃーでぃー、まいなす、さんぱーせんと、とうたつから、${intR(b.elapsed)}えいぎょうびで、げんざい、${pctR(b.ddNow)}です。`;
  }
  return scene('DD速度センサー（分岐）', `${heading}（過去${years}年・${b.total}局面）`, narration, reading, {
    ...emptyVisual('branch'), heading, subheading: b.state === 'normal' ? `直近20営業日の実際の値動き → 2つの分岐（過去${years}年の実績）` : `今回の実際の値動き（−3%到達日＝0） → 2つの分岐（過去${years}年・${b.total}回）`, branch, source: SRC(label, sheets),
  }, 14);
}

// ---------------------------------------------------------------- S10 1日で1%超下がったら
export function dropDayScene(d: DropDaySheet | null, label: string, sheets: Sp500Sheets, years: number): ExplainerScene | null {
  if (!d) return null;
  const items: VisualItem[] = [];
  d.horizons.forEach((h) => {
    items.push({ label: h.label, value: String(h.afterDrop), text: '', icon: 'chartDown', seriesKey: 'drop', seriesLabel: '1%超下落した日の後' });
    items.push({ label: h.label, value: String(h.allDays), text: '', icon: 'chartUp', seriesKey: 'all', seriesLabel: 'すべての日の後（平均）' });
  });
  const narration = `DD局面とは別に、1日で1%を超えて下落した日に注目します。過去${years}年で${d.count.toLocaleString('ja-JP')}回、年平均${d.perYear}回ありました。翌営業日は上昇${d.nextUp}%、下落${d.nextDown}%で、ほぼ五分五分です。その後の平均リターンは、${d.horizons.slice(1).map((h) => `${h.label}が${pctT(h.afterDrop, 2)}（すべての日は${pctT(h.allDays, 2)}）`).join('、')}で、通常の日と同等か、やや高めでした。`;
  const reading = `でぃーでぃーきょくめんとは、べつに、いちにちで、いちぱーせんとを、こえて、げらくした、ひに、ちゅうもくします。かこ、${intR(years)}ねんで、${intR(d.count)}かい、ねんへいきん、${numR(d.perYear)}かい、ありました。よくえいぎょうびは、じょうしょう、${numR(d.nextUp)}ぱーせんと、げらく、${numR(d.nextDown)}ぱーせんとで、ほぼ、ごぶごぶです。そのごの、へいきん、りたーんは、${d.horizons.slice(1).map((h) => `${h.days === 5 ? 'いっしゅうかんご' : h.days === 21 ? 'いっかげつご' : 'さんかげつご'}が、${pctR(h.afterDrop, 2)}、すべての、ひは、${pctR(h.allDays, 2)}`).join('、')}で、つうじょうの、ひと、どうとうか、やや、たかめでした。`;
  return scene('1日で1%超下がったら', `1日1%超の下落のその後（過去${years}年・${d.count}回）`, narration, reading, {
    ...emptyVisual('groupedBar'), heading: '1日で1%超下がったら、その後は？', subheading: `平均リターンの比較：1%超下落した日の後 vs すべての日の後（過去${years}年）`, unit: '%', source: SRC(label, sheets), items,
    chips: [
      { label: `過去${years}年の回数`, value: `${d.count.toLocaleString('ja-JP')}回` },
      { label: '年平均', value: `${d.perYear}回` },
      { label: '翌営業日に上昇', value: `${d.nextUp}%`, role: 'focus' },
      { label: '翌営業日に下落', value: `${d.nextDown}%`, role: 'warn' },
    ],
  }, 14);
}

// ---------------------------------------------------------------- S12 最高値更新のペース（16区分・チップつき）
export function athPaceScene(a: AthPaceSheet | null, label: string, sheets: Sp500Sheets, years: number): ExplainerScene | null {
  if (!a) return null;
  const items: VisualItem[] = a.bins.map((b, i) => ({ label: b.label, value: String(b.count), text: '', icon: 'chartUp', seriesEmphasis: i === a.currentBin }));
  const cur = a.bins[a.currentBin];
  const narration = `過去${years}年で最高値を更新したのは${a.count.toLocaleString('ja-JP')}回、年平均${a.perYear}回で、${a.year}年はここまで${a.thisYear}回更新しています。更新から次の更新までの間隔を見ると、${a.bins[0].label}が${a.bins[0].count}回と最も多く、現在は最後の更新から${a.elapsed}営業日で、${cur ? `「${cur.label}」の区分（過去${cur.count}回）` : ''}にいます。`;
  const reading = `かこ、${intR(years)}ねんで、さいたかねを、こうしんしたのは、${intR(a.count)}かい、ねんへいきん、${numR(a.perYear)}かいで、${intR(a.year)}ねんは、ここまで、${intR(a.thisYear)}かい、こうしんしています。こうしんから、つぎの、こうしんまでの、かんかくを、みると、よくじつの、こうしんが、${intR(a.bins[0].count)}かいと、もっとも、おおく、げんざいは、さいごの、こうしんから、${intR(a.elapsed)}えいぎょうびで、${cur ? `${cur.label}の、くぶん、かこ、${intR(cur.count)}かいに、います。` : ''}`;
  return scene('最高値更新のペース', `最高値更新のペース（過去${years}年・${a.count}回）`, narration, reading, {
    ...emptyVisual('histogram'), heading: '最高値更新のペースを知る', subheading: `更新から次の更新までの間隔（営業日）の分布・強調は現在の経過日数の区分`, unit: '回', source: SRC(label, sheets), items,
    chips: [
      { label: `過去${years}年の更新回数`, value: `${a.count.toLocaleString('ja-JP')}回` },
      { label: '年平均', value: `${a.perYear}回` },
      { label: `${a.year}年（年初来）`, value: `${a.thisYear}回`, role: 'focus' },
      { label: '最後の更新から', value: `${a.elapsed}営業日`, role: 'median' },
    ],
  }, 13);
}

/** シートの計算結果から、モックアップの順の場面一覧（章ごと）を作るための部品をまとめて返す */
export function buildSheetScenes(sheets: Sp500Sheets | null, points: { date: string | Date; close?: number | null; price?: number | null }[] | null, label = 'S&P500') {
  if (!sheets) return null;
  const years = Math.round(sheets.title?.years ?? 0) || (sheets.facts?.years ?? 0);
  return {
    zoom: zoomScene(sheets.zoom, label, sheets),
    upDown: upDownScene(sheets.upDown, label, sheets),
    ddOverlay: ddOverlayScene(sheets.ddOverlay, label, sheets),
    ddHistory: ddHistoryScene(sheets.ddHistory, label, sheets),
    athZone: athZoneScene(sheets.athZone, label, sheets),
    longRolling: points ? longRollingScene(points, label, sheets) : null,
    ytdPaths: ytdPathsScene(sheets.ytdPaths, label, sheets),
    scenarios: (sheets.scenarios?.scenarios ?? []).map((s, i) => scenarioScene(s, i, label, sheets, 20, s.key === 'all' ? sheets.scenarios!.lead : null)).filter((x): x is ExplainerScene => !!x),
    ddDefinition: ddDefinitionScene(sheets.ddDefinition, label, sheets),
    branch: branchScene(sheets.branch, label, sheets, years),
    dropDay: dropDayScene(sheets.dropDay, label, sheets, years),
    athPace: athPaceScene(sheets.athPace, label, sheets, years),
    facts: factsScene(sheets.facts, label, sheets),
    disclaimer: disclaimerScene(),
  };
}
