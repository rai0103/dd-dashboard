// 週次レポートの固定場面（実データ。AIに作文させない）。計算は weeklyReportCore.ts
import type { ChapterPlan, ExplainerScene, VisualItem } from './types';
import { emptyVisual } from './types';
import { newSceneId, minSecFor } from './scriptModel';
import { kanaizeReading } from './readingUtil';
import { shortFundName, yenJp, signed, pct1, md } from './weeklyReportCore';
import type { WeeklyData, Purchase } from './weeklyReportCore';
import { weeklyFactsText } from './weeklyReportCore';
import { TRIAL_RULES, yearsToGoal } from './trialPlan';
import type { TrialStatus } from './trialPlan';
export * from './trialPlan';
export * from './weeklyReportCore';

const plan = (title: string, reading: string, goal: string): ChapterPlan => ({ title, reading, role: 'body', goal, keyPoints: '', sceneCount: 0 });
function scene(title: string, caption: string, narration: string, visual: ExplainerScene['visual']): ExplainerScene {
  // 英字の銘柄名は、数字の読みかえ（kanaizeReading）より先にかなにしておく（「S&P500」が「S&Pごひゃく」にならないように）
  const pre = narration.replace(/S&P500/g, 'えすあんどぴーごひゃく').replace(/NASDAQ100/g, 'なすだっくひゃく').replace(/FANG\+/g, 'ふぁんぐぷらす').replace(/TOPIX/g, 'とぴっくす').replace(/日経225/g, 'にっけいにーにーご');
  return { id: newSceneId(), title, caption, narration, reading: kanaizeReading(pre), visual, chapter: 0, minSec: minSecFor(visual.kind), fixedKey: `fixed:weekly:${title}` };
}

/** 「今週の資産状況」の場面（銘柄別の値動き・今月の買い付け・目標の達成率）。週次・月次とも使う */
function holdingScenes(d: WeeklyData, purchases: Purchase[]): ExplainerScene[] {
  const scenes: ExplainerScene[] = [];
  const moved = d.rows.filter((r) => r.pct != null);
  if (moved.length) {
    const best = moved.reduce((a, b) => ((b.pct as number) > (a.pct as number) ? b : a));
    const worst = moved.reduce((a, b) => ((b.pct as number) < (a.pct as number) ? b : a));
    const items: VisualItem[] = moved.map((r) => ({ label: r.short, value: (r.pct as number).toFixed(1), text: '', icon: (r.pct as number) >= 0 ? 'chartUp' : 'chartDown' }));
    scenes.push(scene('銘柄別の値動き', `一番上げたのは${best.short}`,
      `銘柄ごとの${md(d.prevDate!)}からの値動きです。一番上げたのは${best.short}で${signed(best.pct as number, pct1)}。${worst.name !== best.name ? `${(worst.pct as number) < 0 ? '一番下げた' : '一番伸びが小さかった'}のは${worst.short}で${signed(worst.pct as number, pct1)}でした。` : ''}`,
      { ...emptyVisual('bar'), heading: '銘柄別の値動き', subheading: `${md(d.prevDate!)}→${md(d.asOf)}（買い付け分を除く）`, items, unit: '%', source: '大和コネクト証券の口座（スクショ）' }));
  }
  if (purchases.length) {
    const sum = purchases.reduce((s2, p) => s2 + p.amount, 0);
    scenes.push(scene('今月の買い付け', `今月は${yenJp(sum)}を買い付け`,
      `今月の買い付けです。${purchases.map((p) => `${shortFundName(p.name) || p.name}を${yenJp(p.amount)}`).join('、')}、合計${yenJp(sum)}を買いました。`,
      { ...emptyVisual('bar'), heading: '今月の買い付け', subheading: `合計 ${sum.toLocaleString()}円`, items: purchases.map((p) => ({ label: shortFundName(p.name) || p.name, value: (p.amount / 10000).toFixed(1), text: `${Math.round(p.amount).toLocaleString()}円`, icon: 'yen' })), unit: '万円', source: '大和コネクト証券の取引' }));
  }
  return scenes;
}

const pctS = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`;
const manYen = (v: number) => `${(v / 10000).toLocaleString(undefined, { maximumFractionDigits: 1 })}万円`;

export interface TrialReportInput {
  kind: 'weekly' | 'monthly';
  weekly: WeeklyData | null;
  purchases: Purchase[];
  status: TrialStatus | null;
  /** S&P500の過去の値動き（価格の年率）と、その年率で1億円に届く年数 */
  spx: { rate: number; years: number | null; period?: string } | null;
  /** 目標の年数と、そのために必要な年率 */
  target: { years: number; rate: number };
  monthly: { ym: string; pct: number; start: number; end: number; contribution: number } | null;
  planRows: { ym: string; month: number; plan: number; principal: number; actual: number | null }[] | null;
}

/** 毎回のルール説明（チャンネルの前提） */
function rulesChapter(inp: TrialReportInput): FixedChapter {
  const R = TRIAL_RULES;
  const noInvest = yearsToGoal(0) ?? 100;
  const scenes: ExplainerScene[] = [];
  scenes.push(scene('このチャンネルのルール', '年100万円をコツコツ投資',
    `このチャンネルのルールです。2026年1月に初期費用${manYen(R.initial)}でスタートし、毎月${manYen(R.monthly)}、6月と12月はボーナスから${manYen(R.bonus)}ずつ追加します。合計で年100万円の投資です。`,
    { ...emptyVisual('points'), heading: 'このチャンネルのルール', items: [
      { label: '初期費用', value: '', text: `${manYen(R.initial)}（2026年1月）`, icon: 'flag' },
      { label: '毎月の積立', value: '', text: `${manYen(R.monthly)}`, icon: 'calendar' },
      { label: 'ボーナス月', value: '', text: `6月・12月に各${manYen(R.bonus)}`, icon: 'coin' },
      { label: '年間の投資額', value: '', text: '年100万円', icon: 'yen' },
    ] }));
  const items: VisualItem[] = [{ label: '投資しない', value: String(Math.round(noInvest)), text: '', icon: 'cross' }];
  if (inp.spx?.years) items.push({ label: `S&P500（年${(inp.spx.rate * 100).toFixed(1)}%）`, value: String(Math.round(inp.spx.years)), text: '', icon: 'chartUp' });
  items.push({ label: 'このチャンネルの目標', value: String(inp.target.years), text: '', icon: 'target' });
  scenes.push(scene('1億円まで何年？', `目標は${inp.target.years}年で1億円`,
    `目標は1億円。投資しないで貯めるだけなら約${Math.round(noInvest)}年かかります。${inp.spx?.years ? `S&P500の過去の値動き、年率${(inp.spx.rate * 100).toFixed(1)}%で運用できれば約${Math.round(inp.spx.years)}年。` : ''}このチャンネルは、その半分の${inp.target.years}年での達成を目指します。そのために必要な利回りは、年率およそ${(inp.target.rate * 100).toFixed(0)}%です。`,
    { ...emptyVisual('bar'), heading: '1億円に届くまでの年数', subheading: `初期40万円＋年100万円の積立${inp.spx?.period ? `（S&P500は${inp.spx.period}の価格の年率）` : ''}`, items, unit: '年', source: inp.spx ? 'S&P500の日次終値（ダッシュボード）から計算' : '' }));
  return { plan: plan('このチャンネルのルール', 'このちゃんねるの、るーる', '年100万円の積立ルールと、1億円までの目標年数'), scenes, position: 'afterIntro' };
}

/** 月初：先月の月次リターンと、長期目標（計画）との差 */
function monthlyChapter(inp: TrialReportInput): FixedChapter | null {
  const scenes: ExplainerScene[] = [];
  const mr = inp.monthly;
  if (mr) {
    const m = Number(mr.ym.slice(5, 7));
    scenes.push(scene('先月の月次リターン', `${m}月の成績は${pctS(mr.pct)}`,
      `まずは${m}月の成績です。月末の評価額は${yenJp(mr.end)}。入金した${yenJp(mr.contribution)}を除いた月次リターンは${signed(mr.pct, pct1)}でした。`,
      { ...emptyVisual('number'), heading: `${m}月の月次リターン`, items: [{ label: `${m}月末の評価額 ${Math.round(mr.end).toLocaleString()}円`, value: mr.pct.toFixed(1), text: `入金 ${Math.round(mr.contribution).toLocaleString()}円を除く`, icon: mr.pct >= 0 ? 'chartUp' : 'chartDown' }], unit: '%', source: '投資収支xlsx・大和コネクト証券の口座' }));
  }
  const rows = inp.planRows?.filter((r) => r.actual != null) ?? [];
  if (inp.planRows && rows.length) {
    const last = rows[rows.length - 1];
    const diff = (last.actual as number) - last.plan;
    const items: VisualItem[] = [];
    for (const r of inp.planRows) {
      items.push({ label: '', value: (r.plan / 10000).toFixed(1), text: '', icon: 'target', x: r.month, seriesKey: 'plan', seriesLabel: `計画（年率${(inp.target.rate * 100).toFixed(0)}%）` });
      items.push({ label: '', value: (r.principal / 10000).toFixed(1), text: '', icon: 'yen', x: r.month, seriesKey: 'principal', seriesLabel: '元本', seriesTone: 'warn' } as VisualItem);
      if (r.actual != null) items.push({ label: '', value: (r.actual / 10000).toFixed(1), text: '', icon: 'chartUp', x: r.month, seriesKey: 'actual', seriesLabel: '実績（評価額）', seriesEmphasis: true } as VisualItem);
    }
    scenes.push(scene('長期目標との差', `計画との差は${diff >= 0 ? '+' : '−'}${manYen(Math.abs(diff))}`,
      `次に長期目標との比較です。${inp.target.years}年で1億円に届く計画では、${Number(last.ym.slice(5, 7))}月末の時点で${yenJp(last.plan)}になっている予定です。実績は${yenJp(last.actual as number)}で、計画に対して${signed(diff, yenJp)}、計画比で${(((last.actual as number) / last.plan) * 100).toFixed(1)}%です。`,
      { ...emptyVisual('yearCompare'), heading: '計画と実績（スタートからの月数）', subheading: `${inp.target.years}年で1億円の計画 vs 実際の評価額`, items, unit: '万円', source: '投資収支xlsx・大和コネクト証券の口座' }));
  }
  if (!scenes.length) return null;
  return { plan: plan('先月の成績と長期目標', 'せんげつの、せいせきと、ちょうきもくひょう', '先月の月次リターンと、計画との差'), scenes, position: 'afterIntro' };
}

/** 今の資産状況：入金の推移・元本と評価額・差異・銘柄別・買い付け・目標達成率 */
function statusChapter(inp: TrialReportInput): FixedChapter | null {
  const st = inp.status, d = inp.weekly;
  const scenes: ExplainerScene[] = [];
  if (st) {
    const recent = st.contributions.slice(-12);
    const total = st.contributions.reduce((a, c) => a + c.amount, 0);
    scenes.push(scene('これまでの入金', `入金の合計 ${manYen(total)}`,
      `これまでの入金の流れです。2026年1月の初期費用と毎月の積立、6月のボーナス分を合わせて、入金は合計${yenJp(total)}になりました。`,
      { ...emptyVisual('bar'), heading: 'これまでの入金（月ごと）', subheading: `合計 ${total.toLocaleString()}円${st.contributions.length > 12 ? '（直近12か月）' : ''}`, items: recent.map((c) => ({ label: `${Number(c.ym.slice(5, 7))}月`, value: (c.amount / 10000).toFixed(0), text: '', icon: 'yen' })), unit: '万円', source: 'チャンネルのルール（入金の予定）' }));
    scenes.push(scene('元本と評価額', `評価額 ${yenJp(st.assets)}（${pctS(st.plPct)}）`,
      `${md(st.asOf)}時点の口座は、元本${yenJp(st.principal)}に対して評価額${yenJp(st.assets)}。損益は${signed(st.pl, yenJp)}、トータルリターンは${signed(st.plPct, pct1)}です。`,
      { ...emptyVisual('compare'), heading: '元本と評価額', subheading: `${md(st.asOf)}時点`, items: [
        { label: '元本', value: String(Math.round(st.principal)), text: `入金の合計\n${st.principal.toLocaleString()}円`, icon: 'yen' },
        { label: '評価額', value: String(Math.round(st.assets)), text: `${Math.round(st.assets).toLocaleString()}円\n損益 ${st.pl >= 0 ? '+' : '−'}${Math.abs(Math.round(st.pl)).toLocaleString()}円（${pctS(st.plPct)}）`, icon: st.pl >= 0 ? 'chartUp' : 'chartDown' },
      ], source: '大和コネクト証券の口座' }));
    const diffItems: VisualItem[] = [];
    if (d?.pct != null && d.prevDate) diffItems.push({ label: '前週から', value: d.pct.toFixed(1), text: '', icon: d.pct >= 0 ? 'chartUp' : 'chartDown' });
    if (st.monthPct != null) diffItems.push({ label: '月初から', value: st.monthPct.toFixed(1), text: '', icon: st.monthPct >= 0 ? 'chartUp' : 'chartDown' });
    // スタートの年は「年初から」＝「トータル」になるので出さない
    if (st.yearPct != null && st.yearStart) diffItems.push({ label: '年初から', value: st.yearPct.toFixed(1), text: '', icon: st.yearPct >= 0 ? 'chartUp' : 'chartDown' });
    diffItems.push({ label: 'トータル', value: st.plPct.toFixed(1), text: '', icon: st.plPct >= 0 ? 'chartUp' : 'chartDown' });
    scenes.push(scene('期間ごとの騰落率', `トータル${pctS(st.plPct)}`,
      `期間ごとに見ると、${diffItems.map((x) => `${x.label}${signed(Number(x.value), pct1)}`).join('、')}です。いずれも入金した分を除いた値動きです。`,
      { ...emptyVisual('bar'), heading: '期間ごとの騰落率', subheading: '入金した分を除いた値動き', items: diffItems, unit: '%', source: '大和コネクト証券の口座・投資収支xlsx' }));
  } else if (d) {
    scenes.push(scene('今週の評価額', `評価額 ${yenJp(d.total)}`,
      `${md(d.asOf)}時点の評価額は${yenJp(d.total)}。${d.change != null && d.prevDate ? `前の週から${signed(d.change, yenJp)}、率にして${signed(d.pct ?? 0, pct1)}でした。` : ''}`,
      { ...emptyVisual('number'), heading: '今週の評価額', items: [{ label: `${md(d.asOf)}時点`, value: String(Math.round(d.total)), text: '', icon: 'yen' }], unit: '円', source: '大和コネクト証券の口座（スクショ）' }));
  }
  if (d) scenes.push(...holdingScenes(d, inp.purchases));
  const assets = st?.assets ?? d?.total;
  if (assets != null) {
    const rate = (assets / TRIAL_RULES.goal) * 100;
    scenes.push(scene('目標までの距離', `1億円まであと${manYen(TRIAL_RULES.goal - assets)}`,
      `目標の1億円に対して、達成率は${rate.toFixed(2)}%。あと${yenJp(Math.max(0, TRIAL_RULES.goal - assets))}です。`,
      { ...emptyVisual('number'), heading: '目標1億円までの達成率', items: [{ label: '評価額 ÷ 1億円', value: rate.toFixed(2), text: `あと ${Math.max(0, Math.round(TRIAL_RULES.goal - assets)).toLocaleString()}円`, icon: 'target' }], unit: '%', source: '大和コネクト証券の口座' }));
  }
  if (!scenes.length) return null;
  return { plan: plan('今の資産状況', 'いまの、しさんじょうきょう', '入金の推移・元本と評価額・期間ごとの騰落率・銘柄別の値動き・目標の達成率'), scenes, position: 'afterIntro' };
}

type FixedChapter = { plan: ChapterPlan; scenes: ExplainerScene[]; position: 'afterIntro' };

/** 週次・月次レポートの固定章（ルール → [月次：先月の成績と長期目標] → 今の資産状況）。AIの導入章の直後に入れる */
export function buildTrialReportChapters(inp: TrialReportInput): FixedChapter[] {
  const out: FixedChapter[] = [rulesChapter(inp)];
  if (inp.kind === 'monthly') { const m = monthlyChapter(inp); if (m) out.push(m); }
  const s = statusChapter(inp); if (s) out.push(s);
  return out;
}

/** AIに渡す「今の数字」（雑感・トピックスが実際の数字と食い違わないように） */
export function trialFactsText(inp: TrialReportInput): string {
  const lines: string[] = [];
  const st = inp.status;
  if (st) lines.push(`【現在地（${md(st.asOf)}時点）】元本${yenJp(st.principal)}、評価額${yenJp(st.assets)}、損益${signed(st.pl, yenJp)}（${signed(st.plPct, pct1)}）${st.monthPct != null ? `、月初から${signed(st.monthPct, pct1)}` : ''}${st.yearPct != null && st.yearStart ? `、年初から${signed(st.yearPct, pct1)}` : ''}`);
  if (inp.weekly) lines.push(weeklyFactsText(inp.weekly, inp.purchases).split('\n').filter((l) => !(st && /^目標1億円/.test(l))).map((l) => (st ? l.replace(/^評価額の合計：/, '保有銘柄の評価額の合計：') : l)).join('\n'));
  if (inp.kind === 'monthly' && inp.monthly) lines.push(`【先月（${Number(inp.monthly.ym.slice(5, 7))}月）の月次リターン】${signed(inp.monthly.pct, pct1)}（月末の評価額${yenJp(inp.monthly.end)}）`);
  const pr = inp.planRows?.filter((r) => r.actual != null).pop();
  if (inp.kind === 'monthly' && pr) lines.push(`【長期目標との差】${inp.target.years}年で1億円の計画では今${yenJp(pr.plan)}の予定、実績${yenJp(pr.actual as number)}（計画比${(((pr.actual as number) / pr.plan) * 100).toFixed(1)}%）`);
  lines.push(`【目標】${inp.target.years}年で1億円（必要な年率およそ${(inp.target.rate * 100).toFixed(0)}%）${inp.spx?.years ? `。S&P500の過去の値動き（年率${(inp.spx.rate * 100).toFixed(1)}%）なら約${Math.round(inp.spx.years)}年` : ''}`);
  return lines.join('\n');
}
