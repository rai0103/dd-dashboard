// 週次レポートの固定場面（実データ。AIに作文させない）。計算は weeklyReportCore.ts
import type { ChapterPlan, ExplainerScene, VisualItem, FanSpec, FanSeries } from './types';
import { emptyVisual } from './types';
import { newSceneId, minSecFor } from './scriptModel';
import { kanaizeReading } from './readingUtil';
import { shortFundName, yenJp, signed, pct1, md } from './weeklyReportCore';
import type { WeeklyData, Purchase } from './weeklyReportCore';
import { weeklyFactsText } from './weeklyReportCore';
import { TRIAL_RULES, yearsToGoal, simulatePlan, principalAt, contributionInMonth, monthlyReturn } from './trialPlan';
import type { TrialStatus, ValuePoint } from './trialPlan';
export * from './trialPlan';
export * from './weeklyReportCore';

const plan = (title: string, reading: string, goal: string): ChapterPlan => ({ title, reading, role: 'body', goal, keyPoints: '', sceneCount: 0 });
function scene(title: string, caption: string, narration: string, visual: ExplainerScene['visual']): ExplainerScene {
  // 英字の銘柄名は、数字の読みかえ（kanaizeReading）より先にかなにしておく（「S&P500」が「S&Pごひゃく」にならないように）
  const pre = narration.replace(/S&P500/g, 'えすあんどぴーごひゃく').replace(/NASDAQ100/g, 'なすだっくひゃく').replace(/FANG\+/g, 'ふぁんぐぷらす').replace(/TOPIX/g, 'とぴっくす').replace(/日経225/g, 'にっけいにーにーご');
  return { id: newSceneId(), title, caption, narration, reading: kanaizeReading(pre), visual, chapter: 0, minSec: visual.kind === 'fan' ? 10 : minSecFor(visual.kind), fixedKey: `fixed:weekly:${title}` };
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
    scenes.push(scene('今週の買い付け', `今週は${yenJp(sum)}を買い付け`,
      `今週は買い付けをしました。${purchases.map((p) => `${shortFundName(p.name) || p.name}を${yenJp(p.amount)}`).join('、')}${purchases.length > 1 ? `、合計${yenJp(sum)}` : ''}です。`,
      purchases.length === 1
        ? { ...emptyVisual('number'), heading: '今週の買い付け', subheading: purchases[0].date ? `${md(purchases[0].date)}に約定` : '', items: [{ label: shortFundName(purchases[0].name) || purchases[0].name, value: String(Math.round(sum)), text: '', icon: 'yen' }], unit: '円', source: '大和コネクト証券の取引' }
        : { ...emptyVisual('bar'), heading: '今週の買い付け', subheading: `合計 ${sum.toLocaleString()}円`, items: purchases.map((p) => ({ label: shortFundName(p.name) || p.name, value: (p.amount / 10000).toFixed(1), text: `${Math.round(p.amount).toLocaleString()}円`, icon: 'yen' })), unit: '万円', source: '大和コネクト証券の取引' }));
  }
  return scenes;
}

const pctS = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`;
const manYen = (v: number) => `${(v / 10000).toLocaleString(undefined, { maximumFractionDigits: 1 })}万円`;
const man1 = (v: number) => Math.round(v / 1000) / 10; // 万円（小数1桁）
const yenS = (v: number) => `${Math.round(v).toLocaleString()}円`;

/* ---------------- グラフ（S&P500の分析動画と同じ折れ線の図解＝fan）の部品 ---------------- */
const START_Y = Number(TRIAL_RULES.startYm.slice(0, 4)), START_M = Number(TRIAL_RULES.startYm.slice(5, 7));
/** スタート（2026年1月1日）からの月数（日付の途中は日割り） */
export function monthsSinceStart(date: string): number {
  const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7)), d = Number(date.slice(8, 10)) || 1;
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return (y - START_Y) * 12 + (m - START_M) + (d - 1) / dim;
}
const monthLabel = (k: number) => { const t = START_M - 1 + k; const y = START_Y + Math.floor(t / 12), m = (t % 12) + 1; return m === 1 && k > 0 ? `${y}年1月` : `${m}月`; };
/** 横軸（スタートからの月数）の目盛り。多すぎるときは間引く */
function monthTicks(maxX: number): { x: number; label: string }[] {
  const n = Math.max(1, Math.ceil(maxX));
  const step = n <= 7 ? 1 : n <= 14 ? 2 : n <= 30 ? 3 : 6;
  const out: { x: number; label: string }[] = [];
  for (let k = 0; k <= n; k += step) out.push({ x: k, label: monthLabel(k) });
  return out;
}
/** 元本（入金の合計）の階段の線（万円）。各月の初めに入金する */
function principalSteps(toX: number): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  let p = 0;
  for (let k = 0; k <= Math.floor(toX); k++) {
    const t = START_M - 1 + k, ym = `${START_Y + Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
    pts.push({ x: k, y: man1(p) });
    p += contributionInMonth(ym);
    pts.push({ x: k, y: man1(p) });
  }
  pts.push({ x: toX, y: man1(p) });
  return pts;
}
/** 評価額の推移（万円）。同じ日は最後の値 */
function valueLine(history: ValuePoint[], asOf: string, assets: number): { x: number; y: number }[] {
  const m = new Map<string, number>();
  for (const p of [...(history || [])].filter((x) => x && x.value > 0 && x.date <= asOf).sort((a, b) => a.date.localeCompare(b.date))) m.set(p.date.slice(0, 10), p.value);
  m.set(asOf, assets);
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([d, v]) => ({ x: monthsSinceStart(d), y: man1(v) }));
}
const fanVisual = (heading: string, subheading: string, fan: FanSpec, source: string) => ({ ...emptyVisual('fan'), heading, subheading, fan: { yUnit: '万', ...fan }, unit: '万円', source });

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
  /** これまでの評価額（投資収支xlsxの月末・スクショの日）。グラフの線に使う */
  history?: ValuePoint[];
}

/** 表紙の次の1枚：チャンネルのルールを箇条書きで説明する（毎回同じ内容。数値はルールから作る） */
export const RULES_SCENE_KEY = 'fixed:weekly:rules-bullets';
export function trialRulesScene(inp: TrialReportInput): ExplainerScene {
  const R = TRIAL_RULES;
  const ratePct = (inp.target.rate * 100).toFixed(0);
  const items: VisualItem[] = [
    { label: 'スタート', value: '', text: `${START_Y}年${START_M}月、初期費用${manYen(R.initial)}`, icon: 'flag' },
    { label: '毎月の積立', value: '', text: `毎月${manYen(R.monthly)}`, icon: 'calendar' },
    { label: 'ボーナス月', value: '', text: `6月・12月に各${manYen(R.bonus)}を追加`, icon: 'coin' },
    { label: '年間の投資額', value: '', text: '年100万円', icon: 'yen' },
    { label: '目標', value: '', text: `${inp.target.years}年で1億円（必要な利回り：年率 約${ratePct}%）`, icon: 'target' },
  ];
  const sc = scene('このチャンネルのルール', `年100万円で${inp.target.years}年1億円`,
    `このチャンネルのルールです。${START_Y}年${START_M}月に初期費用${manYen(R.initial)}でスタートし、毎月${manYen(R.monthly)}を積み立てます。6月と12月はボーナスから${manYen(R.bonus)}ずつ追加して、合計で年100万円の投資です。目標は${inp.target.years}年で1億円。そのために必要な利回りは、年率およそ${ratePct}%です。`,
    { ...emptyVisual('summary'), heading: 'このチャンネルのルール', items });
  return { ...sc, minSec: 12, fixedKey: RULES_SCENE_KEY };
}

/** 1億円までの道のり（投資しない・S&P500・目標の比較） */
function rulesChapter(inp: TrialReportInput): FixedChapter {
  const R = TRIAL_RULES;
  const noInvest = yearsToGoal(0) ?? 100;
  const scenes: ExplainerScene[] = [];
  // 1億円までの道のり（投資しない／S&P500の年率／目標の年率）の折れ線
  const horizon = Math.min(40, Math.max(30, Math.ceil((inp.spx?.years ?? 28) + 2)));
  const goalM = man1(R.goal);
  const path = (rate: number, maxYears: number) => {
    const rows = simulatePlan(rate, Math.round(maxYears * 12));
    const pts: { x: number; y: number }[] = [{ x: 0, y: 0 }];
    for (const r of rows) {
      const y = man1(r.value);
      if (y >= goalM) { pts.push({ x: r.month / 12, y: goalM }); break; }
      if (r.month % 3 === 0) pts.push({ x: r.month / 12, y });
    }
    return pts;
  };
  const series: FanSeries[] = [
    { key: 'none', label: '投資しない（入金だけ）', role: 'lead', points: path(0, horizon), endLabel: `約${Math.round(noInvest)}年かかる` },
  ];
  if (inp.spx?.years) series.push({ key: 'spx', label: `S&P500の過去の年率（${(inp.spx.rate * 100).toFixed(1)}%）`, role: 'avg', points: path(inp.spx.rate, horizon) });
  series.push({ key: 'goal', label: `このチャンネルの目標（年率${(inp.target.rate * 100).toFixed(0)}%）`, role: 'focus', points: path(inp.target.rate, inp.target.years + 1) });
  const markers: FanSpec['markers'] = [{ x: inp.target.years, y: goalM, label: `${inp.target.years}年で1億円`, role: 'focus' }];
  if (inp.spx?.years) markers.push({ x: inp.spx.years, y: goalM, label: `約${Math.round(inp.spx.years)}年`, role: 'avg' });
  const xTicks = [0, 5, 10, 15, 20, 25, 30, 35, 40].filter((y) => y <= horizon).map((y) => ({ x: y, label: `${y}年` }));
  scenes.push(scene('1億円まで何年？', `目標は${inp.target.years}年で1億円`,
    `1億円まで何年かかるのか。投資しないで貯めるだけなら約${Math.round(noInvest)}年かかります。${inp.spx?.years ? `S&P500の過去の値動き、年率${(inp.spx.rate * 100).toFixed(1)}%で運用できれば約${Math.round(inp.spx.years)}年。このチャンネルは、その半分の${inp.target.years}年での達成を目指します。` : `このチャンネルは${inp.target.years}年での達成を目指します。`}`,
    fanVisual('1億円までの道のり', `初期40万円＋年100万円を積み立てた場合${inp.spx?.period ? `（S&P500は${inp.spx.period}の価格の年率）` : ''}`, {
      series, markers, xTicks, hLines: [{ y: goalM, label: '目標 1億円' }],
      chips: [
        { label: '投資しない', value: `約${Math.round(noInvest)}年` },
        ...(inp.spx?.years ? [{ label: `S&P500（年${(inp.spx.rate * 100).toFixed(1)}%）`, value: `約${Math.round(inp.spx.years)}年`, role: 'avg' as const }] : []),
        { label: '目標', value: `${inp.target.years}年（年${(inp.target.rate * 100).toFixed(0)}%）`, role: 'focus' },
      ],
    }, inp.spx ? 'S&P500の日次終値から計算' : 'チャンネルのルールから計算')));
  return { plan: plan('1億円までの道のり', 'いちおくえんまでの、みちのり', '投資しない・S&P500・このチャンネルの目標で、1億円に届くまでの年数の比較'), scenes, position: 'afterIntro' };
}

/** 月初：先月の月次リターンと、長期目標（計画）との差 */
function monthlyChapter(inp: TrialReportInput): FixedChapter | null {
  const scenes: ExplainerScene[] = [];
  const mr = inp.monthly;
  if (mr) {
    const m = Number(mr.ym.slice(5, 7));
    // スタートから先月までの月次リターン（棒グラフ。先月を強調）
    const items: VisualItem[] = [];
    for (let k = 0; ; k++) {
      const t = START_M - 1 + k, ym = `${START_Y + Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
      if (ym > mr.ym || k > 60) break;
      const r = ym === mr.ym ? mr : monthlyReturn(inp.history ?? [], ym);
      if (r) items.push({ label: `${Number(ym.slice(5, 7))}月`, value: r.pct.toFixed(1), text: '', icon: r.pct >= 0 ? 'chartUp' : 'chartDown' });
    }
    scenes.push(scene('先月の月次リターン', `${m}月の成績は${pctS(mr.pct)}`,
      `まずは${m}月の成績です。月末の評価額は${yenJp(mr.end)}。入金した${yenJp(mr.contribution)}を除いた月次リターンは${signed(mr.pct, pct1)}でした。`,
      items.length >= 2
        ? { ...emptyVisual('bar'), heading: '月次リターンの推移', subheading: `${m}月末の評価額 ${yenS(mr.end)}（入金 ${yenS(mr.contribution)} を除いた値動き）`, items, unit: '%', emphasis: `${m}月`, source: '投資収支xlsx・大和コネクト証券の口座' }
        : { ...emptyVisual('number'), heading: `${m}月の月次リターン`, items: [{ label: `${m}月末の評価額 ${yenS(mr.end)}`, value: mr.pct.toFixed(1), text: `入金 ${yenS(mr.contribution)}を除く`, icon: mr.pct >= 0 ? 'chartUp' : 'chartDown' }], unit: '%', source: '投資収支xlsx・大和コネクト証券の口座' }));
  }
  const rows = inp.planRows?.filter((r) => r.actual != null) ?? [];
  if (inp.planRows && rows.length) {
    const last = rows[rows.length - 1];
    const diff = (last.actual as number) - last.plan;
    const pts = (f: (r: NonNullable<TrialReportInput['planRows']>[number]) => number | null) => [{ x: 0, y: 0 }, ...inp.planRows!.filter((r) => f(r) != null).map((r) => ({ x: r.month, y: man1(f(r) as number) }))];
    scenes.push(scene('長期目標との差', `計画との差は${diff >= 0 ? '+' : '−'}${manYen(Math.abs(diff))}`,
      `次に長期目標との比較です。${inp.target.years}年で1億円に届く計画では、${Number(last.ym.slice(5, 7))}月末の時点で${yenJp(last.plan)}になっている予定です。実績は${yenJp(last.actual as number)}で、計画に対して${signed(diff, yenJp)}、計画比で${(((last.actual as number) / last.plan) * 100).toFixed(1)}%です。`,
      fanVisual('計画と実績', `${inp.target.years}年で1億円の計画（年率${(inp.target.rate * 100).toFixed(0)}%）と、実際の評価額（月末）`, {
        series: [
          { key: 'principal', label: '元本（入金の合計）', role: 'lead', points: pts((r) => r.principal), dash: true },
          { key: 'plan', label: `計画（年率${(inp.target.rate * 100).toFixed(0)}%）`, role: 'median', points: pts((r) => r.plan), endLabel: manYen(last.plan) },
          { key: 'actual', label: '実績（評価額）', role: 'focus', points: pts((r) => r.actual), endLabel: manYen(last.actual as number) },
        ],
        xTicks: monthTicks(last.month).map((t) => ({ x: t.x, label: t.x === 0 ? 'スタート' : `${monthLabel(t.x - 1)}末` })),
        chips: [
          { label: '計画', value: yenS(last.plan), role: 'median' },
          { label: '実績', value: yenS(last.actual as number), role: 'focus' },
          { label: '計画との差', value: `${diff >= 0 ? '+' : '−'}${yenS(Math.abs(diff))}`, role: diff >= 0 ? 'focus' : 'warn' },
        ],
      }, '投資収支xlsx・大和コネクト証券の口座')));
  }
  if (!scenes.length) return null;
  return { plan: plan('先月の成績と長期目標', 'せんげつの、せいせきと、ちょうきもくひょう', '先月の月次リターンと、計画との差'), scenes, position: 'afterIntro' };
}

/** 今の資産状況：元本と評価額の推移・期間ごとの騰落率・銘柄別・買い付け・目標までの道のり */
function statusChapter(inp: TrialReportInput): FixedChapter | null {
  const st = inp.status, d = inp.weekly;
  const scenes: ExplainerScene[] = [];
  if (st) {
    const nowX = monthsSinceStart(st.asOf);
    const vals = valueLine(inp.history ?? [], st.asOf, st.assets);
    scenes.push(scene('元本と評価額', `評価額 ${yenJp(st.assets)}（${pctS(st.plPct)}）`,
      `${md(st.asOf)}時点の口座は、これまでの入金、つまり元本${yenJp(st.principal)}に対して評価額${yenJp(st.assets)}。損益は${signed(st.pl, yenJp)}、トータルリターンは${signed(st.plPct, pct1)}です。`,
      fanVisual('元本と評価額の推移', `${START_Y}年1月のスタートから${md(st.asOf)}まで`, {
        series: [
          { key: 'principal', label: '元本（入金の合計）', role: 'lead', points: principalSteps(nowX), endLabel: manYen(st.principal) },
          ...(vals.length >= 2 ? [{ key: 'value', label: '評価額', role: 'focus' as const, points: vals, endLabel: manYen(st.assets) }] : []),
        ],
        markers: vals.length < 2 ? [{ x: nowX, y: man1(st.assets), label: `評価額 ${manYen(st.assets)}`, role: 'focus' }] : undefined,
        xTicks: monthTicks(nowX),
        chips: [
          { label: '元本', value: yenS(st.principal) },
          { label: '評価額', value: yenS(st.assets), role: 'focus' },
          { label: '損益', value: `${st.pl >= 0 ? '+' : '−'}${yenS(Math.abs(st.pl))}（${pctS(st.plPct)}）`, role: st.pl >= 0 ? 'focus' : 'warn' },
        ],
      }, '大和コネクト証券の口座・投資収支xlsx')));
    const diffItems: VisualItem[] = [];
    if (d?.pct != null && d.prevDate) diffItems.push({ label: '前週から', value: d.pct.toFixed(1), text: '', icon: d.pct >= 0 ? 'chartUp' : 'chartDown' });
    if (st.monthPct != null) diffItems.push({ label: '月初から', value: st.monthPct.toFixed(1), text: '', icon: st.monthPct >= 0 ? 'chartUp' : 'chartDown' });
    // スタートの年は「年初から」＝「トータル」になるので出さない
    if (st.yearPct != null && st.yearStart) diffItems.push({ label: '年初から', value: st.yearPct.toFixed(1), text: '', icon: st.yearPct >= 0 ? 'chartUp' : 'chartDown' });
    diffItems.push({ label: 'トータル', value: st.plPct.toFixed(1), text: '', icon: st.plPct >= 0 ? 'chartUp' : 'chartDown' });
    scenes.push(scene('期間ごとの騰落率', `トータル${pctS(st.plPct)}`,
      `期間ごとに見ると、${diffItems.map((x) => `${x.label}${signed(Number(x.value), pct1)}`).join('、')}です。いずれも入金した分を除いた値動きです。`,
      { ...emptyVisual('bar'), heading: '期間ごとの騰落率', subheading: '入金した分を除いた値動き', items: diffItems, unit: '%', emphasis: d?.pct != null && d.prevDate ? '前週から' : 'トータル', source: '大和コネクト証券の口座・投資収支xlsx' }));
  } else if (d) {
    scenes.push(scene('今週の評価額', `評価額 ${yenJp(d.total)}`,
      `${md(d.asOf)}時点の評価額は${yenJp(d.total)}。${d.change != null && d.prevDate ? `前の週から${signed(d.change, yenJp)}、率にして${signed(d.pct ?? 0, pct1)}でした。` : ''}`,
      { ...emptyVisual('number'), heading: '今週の評価額', items: [{ label: `${md(d.asOf)}時点`, value: String(Math.round(d.total)), text: '', icon: 'yen' }], unit: '円', source: '大和コネクト証券の口座（スクショ）' }));
  }
  if (d) scenes.push(...holdingScenes(d, inp.purchases));
  const assets = st?.assets ?? d?.total;
  const asOf = st?.asOf ?? d?.asOf;
  if (assets != null && asOf) {
    const rate = (assets / TRIAL_RULES.goal) * 100;
    const goalM = man1(TRIAL_RULES.goal);
    const plan15 = simulatePlan(inp.target.rate, inp.target.years * 12);
    const nowX = monthsSinceStart(asOf) / 12;
    const planNow = plan15[Math.max(0, Math.min(plan15.length - 1, Math.round(nowX * 12) - 1))]?.value ?? 0;
    const planPts = [{ x: 0, y: 0 }, ...plan15.filter((r) => r.month % 3 === 0).map((r) => ({ x: r.month / 12, y: man1(r.value) }))];
    const actual = valueLine(inp.history ?? [], asOf, assets).map((p) => ({ x: p.x / 12, y: p.y }));
    const left = Math.max(0, TRIAL_RULES.goal - assets);
    const yearsLeft = Math.max(0, inp.target.years - nowX);
    scenes.push(scene('目標までの距離', `1億円まであと${manYen(left)}`,
      `目標の1億円に対して、達成率は${rate.toFixed(2)}%。あと${yenJp(left)}です。${inp.target.years}年で届く計画では、今の時点で${yenJp(planNow)}になっている予定です。`,
      fanVisual('目標1億円までの道のり', `${inp.target.years}年で1億円の計画（年率${(inp.target.rate * 100).toFixed(0)}%）と、今の位置`, {
        series: [
          { key: 'plan', label: `計画（年率${(inp.target.rate * 100).toFixed(0)}%）`, role: 'median', points: planPts, dash: true },
          ...(actual.length >= 2 ? [{ key: 'actual', label: '実績（評価額）', role: 'focus' as const, points: actual }] : []),
        ],
        markers: [{ x: nowX, y: man1(assets), label: `いまここ ${manYen(assets)}`, role: 'focus' }, { x: inp.target.years, y: goalM, label: `${START_Y + inp.target.years}年に1億円`, role: 'median' }],
        hLines: [{ y: goalM, label: '目標 1億円' }],
        xTicks: [0, 3, 6, 9, 12, 15].filter((y) => y <= inp.target.years).map((y) => ({ x: y, label: `${START_Y + y}年` })),
        chips: [
          { label: '達成率', value: `${rate.toFixed(2)}%`, role: 'focus' },
          { label: '1億円まで', value: `あと${manYen(left)}`, role: 'warn' },
          { label: '残りの期間', value: `約${yearsLeft.toFixed(1)}年` },
          { label: '計画では今', value: manYen(planNow), role: 'median' },
        ],
      }, '大和コネクト証券の口座・チャンネルのルール')));
  }
  if (!scenes.length) return null;
  return { plan: plan('今の資産状況', 'いまの、しさんじょうきょう', '元本と評価額の推移・期間ごとの騰落率・銘柄別の値動き・目標までの道のり'), scenes, position: 'afterIntro' };
}

/** 報告の日付：週次はスクショの日（土日なら直前の金曜＝最後の取引日）、月次はその月 */
export function reportDateLabel(kind: 'weekly' | 'monthly', asOf: string): string {
  const y = Number(asOf.slice(0, 4)), m = Number(asOf.slice(5, 7));
  if (kind === 'monthly') return `月次報告（${y}年${m}月）`;
  const t = new Date(`${asOf.slice(0, 10)}T00:00:00Z`);
  const dow = t.getUTCDay();
  if (dow === 6) t.setUTCDate(t.getUTCDate() - 1); else if (dow === 0) t.setUTCDate(t.getUTCDate() - 2);
  return `週次報告（${t.getUTCFullYear()}年${t.getUTCMonth() + 1}月${t.getUTCDate()}日）`;
}

/** 表紙（タイトルの場面）：チャンネル名・「2026年1月〜（◯年◯月◯日現在）」・「目指せ！15年で1億円！」。
 * 背景の画像は毎回選ぶ（場面の画像）。画像が無いときは評価額の推移をうっすら描く。文字はあとから自由に直せる */
export function decorateTrialTitle(sc: ExplainerScene, inp: TrialReportInput, channel: string, today = new Date()): ExplainerScene {
  if (sc.visual.kind !== 'title') return sc;
  const asOf = inp.status?.asOf ?? inp.weekly?.asOf ?? today.toISOString().slice(0, 10);
  const assets = inp.status?.assets ?? inp.weekly?.total;
  const bg = assets != null ? valueLine(inp.history ?? [], asOf, assets) : [];
  const now = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`;
  return {
    ...sc,
    visual: {
      ...sc.visual,
      heading: channel,
      subheading: `${START_Y}年${START_M}月〜（${now}現在）`,
      emphasis: `目指せ！${inp.target.years}年で1億円！`,
      items: [],
      background: bg.length >= 2 ? bg : undefined,
      titleNote: undefined,
    },
  };
}

/** ルールの箇条書きを、表紙（最初のタイトルの場面）のすぐ次に置く（すでにあれば置き直す） */
export function placeRulesScene(scenes: ExplainerScene[], rules: ExplainerScene): ExplainerScene[] {
  const list = scenes.filter((x) => x.fixedKey !== RULES_SCENE_KEY);
  const ti = list.findIndex((x) => x.visual.kind === 'title');
  const at = ti >= 0 ? ti + 1 : 0;
  return [...list.slice(0, at), { ...rules, chapter: ti >= 0 ? list[ti].chapter : 0 }, ...list.slice(at)];
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
