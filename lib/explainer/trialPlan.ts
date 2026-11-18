// 「年100万円投資で1億円を目指すチャンネル」のルールと、目標までの道のり（計画）の計算。依存なし（Node のテストでも使う）。
// ルール：2026年1月スタート、初期費用40万円＋毎月5万円＋6月・12月は各20万円（＝年100万円、1年目は初期費用の40万円が上乗せ）。

export const TRIAL_RULES = { startYm: '2026-01', initial: 400_000, monthly: 50_000, bonusMonths: [6, 12], bonus: 200_000, goal: 100_000_000, targetYears: 15 };

const ymAdd = (ym: string, k: number) => { const [y, m] = ym.split('-').map(Number); const t = y * 12 + (m - 1) + k; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; };
const ymDiff = (a: string, b: string) => { const [y1, m1] = a.split('-').map(Number), [y2, m2] = b.split('-').map(Number); return (y1 - y2) * 12 + (m1 - m2); };

/** その月に入金する額（ルールどおり） */
export function contributionInMonth(ym: string, r = TRIAL_RULES): number {
  if (ymDiff(ym, r.startYm) < 0) return 0;
  const m = Number(ym.slice(5, 7));
  return (ym === r.startYm ? r.initial : 0) + r.monthly + (r.bonusMonths.includes(m) ? r.bonus : 0);
}
/** ある日までの元本（入金の合計。月の入金はその月の初めに入れる前提） */
export function principalAt(date: string, r = TRIAL_RULES): number {
  const ym = date.slice(0, 7);
  let s = 0;
  for (let k = 0, cur = r.startYm; ymDiff(ym, cur) >= 0; k++, cur = ymAdd(r.startYm, k)) s += contributionInMonth(cur, r);
  return s;
}

/**
 * 毎月の入金を年率 rate で運用したときの、各月末の元本・評価額（月初に入金し、その月の分も1か月運用する）。
 * months：シミュレーションする月数（スタートの月を1か月目とする）
 */
export function simulatePlan(rate: number, months: number, r = TRIAL_RULES): { ym: string; month: number; principal: number; value: number }[] {
  const g = Math.pow(1 + rate, 1 / 12);
  const out: { ym: string; month: number; principal: number; value: number }[] = [];
  let p = 0, v = 0;
  for (let i = 0; i < months; i++) {
    const ym = ymAdd(r.startYm, i), c = contributionInMonth(ym, r);
    p += c; v = (v + c) * g;
    out.push({ ym, month: i + 1, principal: p, value: v });
  }
  return out;
}
/** 年率 rate で運用したとき、評価額が目標に届くまでの年数（届かなければ null）。rate=0 は入金だけ（投資しない） */
export function yearsToGoal(rate: number, r = TRIAL_RULES): number | null {
  const g = Math.pow(1 + rate, 1 / 12);
  let v = 0;
  for (let i = 0; i < 12 * 300; i++) {
    v = (v + contributionInMonth(ymAdd(r.startYm, i), r)) * g;
    if (v >= r.goal) return (i + 1) / 12;
  }
  return null;
}
/** 目標の年数で目標額に届くために必要な年率 */
export function requiredRate(years: number, r = TRIAL_RULES): number {
  let lo = 0, hi = 1;
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    const last = simulatePlan(mid, Math.round(years * 12), r).pop()!;
    if (last.value >= r.goal) hi = mid; else lo = mid;
  }
  return hi;
}
/** 日次終値の全期間の年率（配当を含まない価格だけの年率） */
export function cagrOf(points: { date: string; close: number }[]): { rate: number; years: number; start: string; end: string } | null {
  const pts = (points || []).filter((p) => p && p.close > 0 && /^\d{4}-\d{2}-\d{2}/.test(p.date)).sort((a, b) => a.date.localeCompare(b.date));
  if (pts.length < 2) return null;
  const a = pts[0], b = pts[pts.length - 1];
  const years = (Date.parse(b.date) - Date.parse(a.date)) / (365.25 * 86400000);
  if (!(years > 1)) return null;
  return { rate: Math.pow(b.close / a.close, 1 / years) - 1, years, start: a.date.slice(0, 10), end: b.date.slice(0, 10) };
}
/** スタートから数えて何か月目か（スタートの月＝1） */
export function monthIndex(date: string, r = TRIAL_RULES): number { return ymDiff(date.slice(0, 7), r.startYm) + 1; }

/* ---------------- 現在地（元本・評価額・差異）と月次の成績 ---------------- */
export interface ValuePoint { date: string; value: number }
export interface TrialStatus {
  asOf: string; principal: number; assets: number; pl: number; plPct: number;
  monthStart: ValuePoint | null; monthPct: number | null;
  yearStart: ValuePoint | null; yearPct: number | null;
  contributions: { ym: string; amount: number }[];
}
const firstOfMonth = (d: string) => `${d.slice(0, 7)}-01`;
/** ref（ある時点の評価額）から asOf までの、入金を除いた騰落率（ref の後の月の入金はその月の初めに入れた前提） */
function returnSince(ref: ValuePoint | null, refStartValue: number, asOf: string, assets: number, r = TRIAL_RULES): number | null {
  const fromYm = ref ? ymAdd(ref.date.slice(0, 7), 1) : r.startYm;
  let c = 0;
  for (let ym = fromYm; ymDiff(asOf.slice(0, 7), ym) >= 0; ym = ymAdd(ym, 1)) c += contributionInMonth(ym, r);
  const base = refStartValue + c;
  return base > 0 ? ((assets - refStartValue - c) / base) * 100 : null;
}
/**
 * 今の現在地。assets＝口座の資産合計（現金を含む）。points＝これまでの評価額（投資収支xlsxの月末・スクショなど）。
 * 月初から＝前月末の評価額から、年初から＝前年末の評価額から（スタートの年は0円から）の、入金を除いた騰落率。
 */
export function trialStatus(asOf: string, assets: number, points: ValuePoint[], r = TRIAL_RULES): TrialStatus {
  const pts = (points || []).filter((p) => p && p.value > 0).sort((a, b) => a.date.localeCompare(b.date));
  const principal = principalAt(asOf, r);
  const monthStart = [...pts].reverse().find((p) => p.date < firstOfMonth(asOf)) ?? null;
  const yearStartP = [...pts].reverse().find((p) => p.date < `${asOf.slice(0, 4)}-01-01`) ?? null;
  const startYear = asOf.slice(0, 4) === r.startYm.slice(0, 4);
  const contributions: { ym: string; amount: number }[] = [];
  for (let ym = r.startYm; ymDiff(asOf.slice(0, 7), ym) >= 0; ym = ymAdd(ym, 1)) contributions.push({ ym, amount: contributionInMonth(ym, r) });
  return {
    asOf, principal, assets, pl: assets - principal, plPct: principal > 0 ? ((assets - principal) / principal) * 100 : 0,
    monthStart, monthPct: monthStart ? returnSince(monthStart, monthStart.value, asOf, assets, r) : (ymDiff(asOf.slice(0, 7), r.startYm) === 0 ? returnSince(null, 0, asOf, assets, r) : null),
    yearStart: yearStartP, yearPct: yearStartP ? returnSince(yearStartP, yearStartP.value, asOf, assets, r) : startYear ? returnSince(null, 0, asOf, assets, r) : null,
    contributions,
  };
}
/** 月末ごとの評価額（同じ月に複数あれば、その月の最後の値） */
export function monthEnds(points: ValuePoint[]): Map<string, ValuePoint> {
  const m = new Map<string, ValuePoint>();
  for (const p of [...(points || [])].filter((x) => x && x.value > 0).sort((a, b) => a.date.localeCompare(b.date))) m.set(p.date.slice(0, 7), p);
  return m;
}
/** ある月の月次リターン（前月末→その月末、その月の入金を除く）。スタートの月は0円から */
export function monthlyReturn(points: ValuePoint[], ym: string, r = TRIAL_RULES): { ym: string; start: number; end: number; contribution: number; pct: number; endDate: string } | null {
  const me = monthEnds(points);
  const end = me.get(ym);
  if (!end) return null;
  const prev = me.get(ymAdd(ym, -1));
  const start = prev ? prev.value : ym === r.startYm ? 0 : NaN;
  if (!Number.isFinite(start)) return null;
  const c = contributionInMonth(ym, r);
  return { ym, start, end: end.value, contribution: c, pct: start + c > 0 ? ((end.value - start - c) / (start + c)) * 100 : 0, endDate: end.date };
}
/** 計画（目標の年数で届く年率で運用した場合）と実績の月ごとの比較（スタートからupToYmまで） */
export function planVsActual(points: ValuePoint[], upToYm: string, rate: number, r = TRIAL_RULES): { ym: string; month: number; plan: number; principal: number; actual: number | null }[] {
  const n = Math.max(1, ymDiff(upToYm, r.startYm) + 1);
  const me = monthEnds(points);
  return simulatePlan(rate, n, r).map((p) => ({ ym: p.ym, month: p.month, plan: p.value, principal: p.principal, actual: me.get(p.ym)?.value ?? null }));
}
