// [グラフ動画] 資産形成レポート（年100万円投資で1億円を目指すチャンネル・大和コネクト証券）の数字を、
// ダッシュボードが保存しているデータ（lib/storage.ts）から組み立てる。
// 計算はダッシュボードの「⑦初心者トライアル」と同じ関数を使う（resolveBeginnerTrial・stackedHoldingRows・trialStatus など）。
// 数字はすべてここで作り、AIには作らせない（台本はこの数字を読み上げるだけ）。
import { storage } from '../storage';
import { resolveBeginnerTrial } from '../investmentPerformance';
import { withInitialSnapshot, purchasesMatched, checkpointsMatched } from '../beginnerTrialSeed';
import { stackedHoldingRows, proxyForHolding, buildProxySeries, type Dated } from '../holdingProxies';
import { TRIAL_RULES, requiredRate, simulatePlan, trialStatus, planVsActual, cagrOf, yearsToGoal, monthIndex, principalAt } from '../explainer/trialPlan';
import { buildWeeklyData, WEEKLY_CHANNEL } from '../explainer/weeklyReportCore';
import { fundAbbr, fundKey } from './fundNames';

/** 銘柄の色（どの場面でも同じ銘柄は同じ色。今の評価額が大きい順に割り当てる） */
export const FUND_COLORS = ['#45C4B0', '#5B90C7', '#8E7CC3', '#D9A24B', '#7FA37A', '#BE7A63', '#C77FB0', '#4FA0A6', '#A3A24B', '#C0654B'];

export const ASSET_CHANNEL = WEEKLY_CHANNEL;
const BROKER_KEY = 'daiwa';
const ACCOUNT_LABEL = '大和コネクト証券';
const START = '2026-01-01';
const PROXY_CACHE_KEY = 'holding_proxy_cache_v1';

export interface AssetHolding { name: string; short: string; value: number; pct: number | null; change: number | null; color: string }
export interface AssetReport {
  asOf: string;
  source: 'excel' | 'screenshot';
  channel: string;
  value: number;
  principal: number;
  pl: number;
  plPct: number;
  goal: number;
  goalPct: number;
  monthPct: number | null;
  yearPct: number | null;
  /** 前回のスクショ（5日以上前）からの変化 */
  weekly: { prevDate: string; change: number; pct: number | null } | null;
  /** 評価額・元本の推移（月末ごと＋最新） */
  points: { date: string; value: number | null; principal: number | null }[];
  /** 銘柄別の評価額の積み上げ（推計を含む） */
  stack: { names: string[]; shorts: string[]; colors: string[]; rows: { date: string; total: number; values: number[]; estimated: boolean }[] };
  holdings: AssetHolding[];
  /** 計画（目標の年数で届く年率）と実績の月ごとの比較 */
  plan: { rate: number; rows: { ym: string; month: number; plan: number; principal: number; actual: number | null }[] };
  /** 1億円までの道のり（計画どおりの年率で15年） */
  road: { rate: number; months: number; curve: { month: number; value: number; principal: number }[]; nowMonth: number; spx: { rate: number; years: number | null; period: string; curve: { month: number; value: number }[] } | null };
  rules: typeof TRIAL_RULES;
}

const parse = async (key: string) => { try { const r = await storage.get(key); return r?.value ? JSON.parse(r.value) : null; } catch { return null; } };
const localYMD = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** ダッシュボードが1日1回保存している代用データ（値動き）から、銘柄ごとの日足を作る（無ければnull） */
function proxyPriceOf(): (name: string) => Dated[] | null {
  let raw: Record<string, Dated[]> = {};
  try { raw = JSON.parse(localStorage.getItem(PROXY_CACHE_KEY) || 'null')?.raw ?? {}; } catch { raw = {}; }
  const memo = new Map<string, Dated[] | null>();
  return (name: string) => {
    if (memo.has(name)) return memo.get(name)!;
    let out: Dated[] | null = null;
    const px = proxyForHolding(name);
    for (const src of px?.sources ?? []) {
      const vals = raw[src.symbol];
      if (!vals || vals.length < 20) continue;
      const fx = src.fx ? raw.usdjpy ?? null : null;
      if (src.fx && !fx) continue;
      const built = buildProxySeries(vals, src, fx);
      if (built.length >= 20) { out = built; break; }
    }
    memo.set(name, out);
    return out;
  };
}

export async function loadAssetReport(): Promise<{ report: AssetReport | null; error: string }> {
  const [perf, holdingsAll, summaries, asOfMap, history, stored, voo] = await Promise.all([
    parse('investment_performance_data'), parse('portfolio_holdings'), parse('broker_summaries'), parse('holdings_as_of'),
    parse('broker_holding_history'), parse('trial_purchases'), parse('price-series:VOO'),
  ]);
  const daiwa = (Array.isArray(holdingsAll) ? holdingsAll : []).filter((h: any) => h && h.broker === BROKER_KEY && h.amount > 0);
  const sm = summaries?.[BROKER_KEY] ?? null;
  const asOf: string = sm?.asOf || asOfMap?.[ACCOUNT_LABEL] || (sm?.importedAt ? localYMD(new Date(sm.importedAt)) : localYMD());
  const shotValue = daiwa.reduce((s: number, h: any) => s + h.amount, 0);
  const shot = daiwa.length ? { asOf, importedAt: sm?.importedAt ?? '', value: shotValue, principal: sm?.unrealizedPl != null ? shotValue - sm.unrealizedPl : (sm?.costBasis ?? null) } : null;
  const src = perf?.beginnerTrial?.length
    ? perf.beginnerTrial
    : (perf?.accountSeries ?? []).map((p: any) => ({ date: p.date, principal: null, value: p.accounts?.[ACCOUNT_LABEL] ?? null }));
  const excel = src.filter((p: any) => p.date >= START && (p.principal != null || p.value != null));
  const resolved = resolveBeginnerTrial(excel, perf?.parsedAt ?? null, shot);
  const latest = resolved.latest;
  if (!latest || latest.value == null) return { report: null, error: '大和コネクト証券のデータがありません。ダッシュボードで投資収支xlsxを取り込むか、大和コネクト証券のスクショを取り込んでください。' };

  const points = resolved.points.map((p: any) => ({ date: p.date, value: p.value ?? null, principal: p.principal ?? null }));
  const value = latest.value;
  const principal = latest.principal ?? principalAt(latest.date);
  const valuePts = points.filter((p) => p.value != null).map((p) => ({ date: p.date, value: p.value as number }));
  const status = trialStatus(latest.date, value, valuePts);

  // 銘柄別の積み上げ（ダッシュボードの「保有銘柄のチャート」と同じ計算）
  const snaps = withInitialSnapshot(history?.[BROKER_KEY] ?? []);
  const purchases = purchasesMatched(snaps, Array.isArray(stored) ? stored : []);
  const cps = checkpointsMatched(snaps);
  const totals = [...points.filter((p) => !cps.some((c) => c.date === p.date)).map((p) => ({ date: p.date, value: p.value })), ...cps].sort((a, b) => a.date.localeCompare(b.date));
  const st = stackedHoldingRows(snaps, totals, proxyPriceOf(), START, purchases);
  // 取り込みのたびに書き方が少し違う同じ銘柄（例：NF日経レバ と NEXT FUNDS 日経平均レバレッジ…）は1つにまとめる。
  // 同じ日に2行ある場合（スクショと月末の推計など）は、実際の値（スクショ）を優先して1行にする
  const keys = [...new Set(st.names.map(fundKey))];
  const labelOf = new Map<string, string>();
  for (const n of [...st.names].reverse()) labelOf.set(fundKey(n), fundAbbr(n)); // 新しい書き方（最後に出てきた名前）を優先
  const byDate = new Map<string, { date: string; total: number; values: number[]; estimated: boolean }>();
  for (const r of st.rows) {
    const values = keys.map((k) => st.names.filter((n) => fundKey(n) === k).reduce((a, n) => a + (Number(r[n]) || 0), 0));
    const row = { date: String(r.date), total: Number(r.total) || 0, values, estimated: !!r.estimated };
    const prev = byDate.get(row.date);
    if (!prev || (prev.estimated && !row.estimated)) byDate.set(row.date, row);
  }
  const stack = {
    names: keys,
    shorts: keys.map((k) => labelOf.get(k) || k),
    colors: [] as string[],
    rows: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };

  // 前回のスクショからの変化（その間の買い付けは値上がりに含めない）
  let weekly: AssetReport['weekly'] = null;
  const w0 = buildWeeklyData(snaps, []);
  if (w0?.prevDate) {
    const buys = purchases.filter((p) => p.date > w0.prevDate! && p.date <= w0.asOf).map((p) => ({ name: p.name, amount: p.amount }));
    const w = buildWeeklyData(snaps, buys);
    if (w && w.change != null) weekly = { prevDate: w.prevDate!, change: w.change, pct: w.pct };
  }
  // 銘柄ごとの前回からの値動き（その間に買った分は値上がりに含めない）
  const wBuys = w0?.prevDate ? purchases.filter((p) => p.date > w0.prevDate! && p.date <= w0.asOf).map((p) => ({ name: p.name, amount: p.amount })) : [];
  const wRows = new Map((w0 ? buildWeeklyData(snaps, wBuys) : null)?.rows.map((r) => [fundKey(r.name), r]) ?? []);
  const holdingSrc: { name: string; value: number }[] = daiwa.length
    ? daiwa.map((h: any) => ({ name: h.name, value: h.amount }))
    : Object.entries(snaps[snaps.length - 1]?.items ?? {}).map(([name, v]) => ({ name, value: Number(v) }));
  const merged = new Map<string, { name: string; value: number }>();
  for (const h of holdingSrc) { if (!(h.value > 0)) continue; const k = fundKey(h.name); const o = merged.get(k); merged.set(k, { name: o?.name ?? h.name, value: (o?.value ?? 0) + h.value }); }
  const holdings = [...merged.entries()].sort((a, b) => b[1].value - a[1].value)
    .map(([k, h], i) => ({ name: h.name, short: fundAbbr(h.name), value: h.value, pct: wRows.get(k)?.pct ?? null, change: wRows.get(k)?.change ?? null, color: FUND_COLORS[i % FUND_COLORS.length] }));
  // 積み上げの色：今持っている銘柄はその色、もう持っていない銘柄は残りの色
  const colorByKey = new Map([...merged.keys()].map((k, i) => [k, holdings[i]?.color]));
  const order = [...merged.entries()].sort((a, b) => b[1].value - a[1].value).map(([k]) => k);
  order.forEach((k, i) => colorByKey.set(k, FUND_COLORS[i % FUND_COLORS.length]));
  let extra = order.length;
  stack.colors = stack.names.map((k) => colorByKey.get(k) ?? FUND_COLORS[extra++ % FUND_COLORS.length]);

  const rate = requiredRate(TRIAL_RULES.targetYears);
  const plan = { rate, rows: planVsActual(valuePts, latest.date.slice(0, 7), rate) };
  const months = TRIAL_RULES.targetYears * 12;
  const curve = simulatePlan(rate, months).map((p) => ({ month: p.month, value: p.value, principal: p.principal }));
  const c = cagrOf(Array.isArray(voo?.points) ? voo.points : []);
  const spx = c ? { rate: c.rate, years: yearsToGoal(c.rate), period: `${c.start.slice(0, 4)}〜${c.end.slice(0, 4)}年`, curve: simulatePlan(c.rate, months).map((p) => ({ month: p.month, value: p.value })) } : null;

  return {
    error: '',
    report: {
      asOf: latest.date, source: latest.source, channel: ASSET_CHANNEL,
      value, principal, pl: value - principal, plPct: principal > 0 ? ((value - principal) / principal) * 100 : 0,
      goal: TRIAL_RULES.goal, goalPct: (value / TRIAL_RULES.goal) * 100,
      monthPct: status.monthPct, yearPct: status.yearPct,
      weekly, points, stack, holdings, plan,
      road: { rate, months, curve, nowMonth: monthIndex(latest.date), spx },
      rules: TRIAL_RULES,
    },
  };
}
