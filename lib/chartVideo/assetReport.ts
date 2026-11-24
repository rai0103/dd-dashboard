// [グラフ動画] 資産形成レポート（年100万円投資で1億円を目指すチャンネル・大和コネクト証券）の数字を、
// ダッシュボードが保存しているデータ（lib/storage.ts）から組み立てる。
// 計算はダッシュボードの「⑦初心者トライアル」と同じ関数を使う（resolveBeginnerTrial・stackedHoldingRows・trialStatus など）。
// 数字はすべてここで作り、AIには作らせない（台本はこの数字を読み上げるだけ）。
import { storage } from '../storage';
import { resolveBeginnerTrial } from '../investmentPerformance';
import { withInitialSnapshot, purchasesMatched, checkpointsMatched } from '../beginnerTrialSeed';
import { stackedHoldingRows, proxyForHolding, buildProxySeries, type Dated } from '../holdingProxies';
import { TRIAL_RULES, requiredRate, simulatePlan, trialStatus, planVsActual, cagrOf, yearsToGoal, monthIndex, principalAt } from '../explainer/trialPlan';
import { buildWeeklyData, shortFundName, WEEKLY_CHANNEL } from '../explainer/weeklyReportCore';

export const ASSET_CHANNEL = WEEKLY_CHANNEL;
const BROKER_KEY = 'daiwa';
const ACCOUNT_LABEL = '大和コネクト証券';
const START = '2026-01-01';
const PROXY_CACHE_KEY = 'holding_proxy_cache_v1';

export interface AssetHolding { name: string; short: string; value: number; pct: number | null; change: number | null }
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
  stack: { names: string[]; shorts: string[]; rows: { date: string; total: number; values: number[]; estimated: boolean }[] };
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
  const stack = {
    names: st.names,
    shorts: st.names.map(shortFundName),
    rows: st.rows.map((r) => ({ date: String(r.date), total: Number(r.total) || 0, values: st.names.map((n) => Number(r[n]) || 0), estimated: !!r.estimated })),
  };

  // 前回のスクショからの変化（その間の買い付けは値上がりに含めない）
  let weekly: AssetReport['weekly'] = null;
  const w0 = buildWeeklyData(snaps, []);
  if (w0?.prevDate) {
    const buys = purchases.filter((p) => p.date > w0.prevDate! && p.date <= w0.asOf).map((p) => ({ name: p.name, amount: p.amount }));
    const w = buildWeeklyData(snaps, buys);
    if (w && w.change != null) weekly = { prevDate: w.prevDate!, change: w.change, pct: w.pct };
  }
  const wRows = new Map((w0 ? buildWeeklyData(snaps, []) : null)?.rows.map((r) => [r.name, r]) ?? []);
  const holdingSrc: { name: string; value: number }[] = daiwa.length
    ? daiwa.map((h: any) => ({ name: h.name, value: h.amount }))
    : Object.entries(snaps[snaps.length - 1]?.items ?? {}).map(([name, v]) => ({ name, value: Number(v) }));
  const holdings = holdingSrc.filter((h) => h.value > 0).sort((a, b) => b.value - a.value)
    .map((h) => ({ name: h.name, short: shortFundName(h.name), value: h.value, pct: wRows.get(h.name)?.pct ?? null, change: wRows.get(h.name)?.change ?? null }));

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
