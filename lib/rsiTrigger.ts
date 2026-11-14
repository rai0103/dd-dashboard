// VOO・QQQ専用「RSIトリガー＆撤退実日数管理」のロジック（純粋な関数）。テスト：lib/rsiTrigger.test.ts
// ルール（銘柄ごとに1ポジションだけ）：
//   ・待機中に 14日RSI ≦ 買いトリガー になった日の終値で、基準投入額を買う
//   ・保有中に 14日RSI ≧ 売りトリガー になった日の終値で売る（RSI利確）
//   ・買付日からの経過実日数（カレンダー日数）が撤退日数に達した日の終値で売る（期限撤退）
//   ・同じ日に買って売ることはしない。売った翌日以降、再び買いトリガーに達したら次の買付
// 待機期間はMMF（年利3.5%）で運用したとみなし、資金を1つにまとめて回した場合の通算年率（CAGR）も出す。

export interface RsiPoint { date: Date; price: number; rsi: number | null }
export interface RsiTriggerParams { buy: number; sell: number; exitDays: number; base: number; mmfRate?: number; /** バックテストの始期（この日以降でRSIがある最初の日から）。RSI自体は始期より前のデータも使って計算済みのものを使う */ startDate?: Date }
export interface RsiTrade {
  buyDate: Date; buyPrice: number;
  sellDate: Date | null; sellPrice: number; // 未決済は最新値で評価（sellDate=null）
  days: number; reason: 'RSI利確' | '期限撤退' | '保有中';
  value: number; // 売却時（未決済は最新）の評価額（円）＝基準投入額×売値÷買値
  minValue: number; // 保有中に付けた最も低い評価額（円）
  ret: number; // 騰落率（%）
}
export interface RsiBacktestSummary {
  closed: number; winRate: number | null; avgDays: number | null;
  avgValue: number | null; minValue: number | null;
  irr: number | null; // 決済したトレードのキャッシュフローの内部収益率（年率%）
  cagrWithMmf: number | null; // 待機中をMMFで運用し、資金を回し続けた場合の通算年率（%）
  heldCagr: number | null; // 保有していた期間だけで見た年率（決済トレードの騰落を複利でつなぎ、保有実日数の合計で年率化。%）
  buyHoldCagr: number | null; // 参考：同じ期間ずっと保有し続けた場合の年率（%）
  from: Date | null; to: Date | null; open: RsiTrade | null;
}

const DAY = 86400000;
export const calDays = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / DAY);
export const addDays = (a: Date, n: number) => new Date(a.getTime() + n * DAY);
export const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** XIRR（日付付きキャッシュフローの内部収益率・年率）。解が無ければ null */
export function xirr(flows: { date: Date; amount: number }[]): number | null {
  if (flows.length < 2 || !flows.some((f) => f.amount < 0) || !flows.some((f) => f.amount > 0)) return null;
  const t0 = flows[0].date.getTime();
  const npv = (r: number) => flows.reduce((s, f) => s + f.amount / Math.pow(1 + r, (f.date.getTime() - t0) / (365 * DAY)), 0);
  let lo = -0.9999, hi = 10;
  let flo = npv(lo), fhi = npv(hi);
  if (flo * fhi > 0) return null;
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2, fm = npv(mid);
    if (Math.abs(fm) < 1e-7) return mid;
    if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
  }
  return (lo + hi) / 2;
}

export function backtestRsiTrigger(points: RsiPoint[], p: RsiTriggerParams): { trades: RsiTrade[]; summary: RsiBacktestSummary } {
  const mmf = p.mmfRate ?? 0.035;
  const trades: RsiTrade[] = [];
  const start = points.findIndex((x) => x.rsi != null && (!p.startDate || x.date.getTime() >= p.startDate.getTime()));
  const empty: RsiBacktestSummary = { closed: 0, winRate: null, avgDays: null, avgValue: null, minValue: null, irr: null, cagrWithMmf: null, heldCagr: null, buyHoldCagr: null, from: null, to: null, open: null };
  if (start < 0) return { trades, summary: empty };
  let entry = -1, lastExit = -1, minPrice = Infinity;
  // 資金を1つにまとめて回す場合の残高（待機中はMMFの利回り、保有中は株数×終値）
  let pot = p.base, units = 0, lastDate = points[start].date;
  for (let i = start; i < points.length; i++) {
    const pt = points[i];
    if (entry < 0) pot *= Math.pow(1 + mmf, calDays(lastDate, pt.date) / 365);
    lastDate = pt.date;
    if (pt.rsi == null) continue;
    if (entry < 0) {
      if (i > lastExit && pt.rsi <= p.buy) { entry = i; minPrice = pt.price; units = pot / pt.price; }
      continue;
    }
    minPrice = Math.min(minPrice, pt.price);
    if (i === entry) continue;
    const days = calDays(points[entry].date, pt.date);
    const reason = pt.rsi >= p.sell ? 'RSI利確' : days >= p.exitDays ? '期限撤退' : null;
    if (reason) {
      const e = points[entry];
      trades.push({ buyDate: e.date, buyPrice: e.price, sellDate: pt.date, sellPrice: pt.price, days, reason, value: p.base * pt.price / e.price, minValue: p.base * minPrice / e.price, ret: (pt.price / e.price - 1) * 100 });
      pot = units * pt.price; units = 0;
      entry = -1; lastExit = i;
    }
  }
  const last = points[points.length - 1];
  let open: RsiTrade | null = null;
  if (entry >= 0) {
    const e = points[entry];
    open = { buyDate: e.date, buyPrice: e.price, sellDate: null, sellPrice: last.price, days: calDays(e.date, last.date), reason: '保有中', value: p.base * last.price / e.price, minValue: p.base * minPrice / e.price, ret: (last.price / e.price - 1) * 100 };
    trades.push(open);
    pot = units * last.price;
  }
  const closed = trades.filter((t) => t.sellDate);
  const flows = closed.flatMap((t) => [{ date: t.buyDate, amount: -p.base }, { date: t.sellDate as Date, amount: t.value }]).sort((a, b) => a.date.getTime() - b.date.getTime());
  const years = calDays(points[start].date, last.date) / 365;
  const irr = xirr(flows);
  const heldDays = closed.reduce((s, t) => s + t.days, 0);
  const heldGrowth = closed.reduce((g, t) => g * (t.value / p.base), 1);
  return {
    trades,
    summary: {
      closed: closed.length,
      winRate: closed.length ? (closed.filter((t) => t.ret > 0).length / closed.length) * 100 : null,
      avgDays: closed.length ? closed.reduce((s, t) => s + t.days, 0) / closed.length : null,
      avgValue: closed.length ? closed.reduce((s, t) => s + t.value, 0) / closed.length : null,
      minValue: closed.length ? Math.min(...closed.map((t) => t.value)) : null,
      irr: irr == null ? null : irr * 100,
      cagrWithMmf: years > 0 ? (Math.pow(pot / p.base, 1 / years) - 1) * 100 : null,
      heldCagr: heldDays > 0 ? (Math.pow(heldGrowth, 365 / heldDays) - 1) * 100 : null,
      buyHoldCagr: years > 0 ? (Math.pow(last.price / points[start].price, 1 / years) - 1) * 100 : null,
      from: points[start].date, to: last.date, open,
    },
  };
}

export type RsiStatusKind = 'wait' | 'buy' | 'hold' | 'take' | 'timeout';
export interface RsiTriggerStatus {
  kind: RsiStatusKind; rsi: number | null;
  toBuy?: number; // 買いトリガーまでのRSIの差
  elapsed?: number; remaining?: number; deadline?: Date; progress?: number;
  value?: number; pnlYen?: number; pnlPct?: number;
}
/**
 * 現在の状態。position（買付日・買付価格）があれば保有中として、利確（RSI≧売り）→期限撤退（経過実日数≧撤退日数）→
 * 保有中（カウントダウン）の順に判定する。無ければ買いサイン（RSI≦買い）か待機中。経過日数は today（暦日）で数える。
 */
export function rsiTriggerStatus(last: { price: number; rsi: number | null }, p: RsiTriggerParams, position: { date: Date; price: number } | null, today: Date): RsiTriggerStatus {
  const rsi = last.rsi;
  if (position) {
    const elapsed = Math.max(0, calDays(position.date, today));
    const deadline = addDays(position.date, p.exitDays);
    const remaining = p.exitDays - elapsed;
    const value = p.base * last.price / position.price;
    const base = { rsi, elapsed, remaining, deadline, progress: Math.min(1, elapsed / Math.max(1, p.exitDays)), value, pnlYen: value - p.base, pnlPct: (last.price / position.price - 1) * 100 };
    if (rsi != null && rsi >= p.sell) return { kind: 'take', ...base };
    if (elapsed >= p.exitDays) return { kind: 'timeout', ...base };
    return { kind: 'hold', ...base };
  }
  if (rsi != null && rsi <= p.buy) return { kind: 'buy', rsi };
  return { kind: 'wait', rsi, toBuy: rsi == null ? undefined : rsi - p.buy };
}

// ---- 設定（VOO・QQQ個別。基準投入額は共通・万円） ----
export interface RsiTriggerInstrumentSettings { buy: number; sell: number; exitDays: number; position: { date: string; price: number } | null }
export interface RsiTriggerSettings { base: number; voo: RsiTriggerInstrumentSettings; qqq: RsiTriggerInstrumentSettings; nkx: RsiTriggerInstrumentSettings }
export const DEFAULT_RSI_TRIGGER_SETTINGS: RsiTriggerSettings = {
  base: 100,
  voo: { buy: 30, sell: 70, exitDays: 130, position: null },
  qqq: { buy: 30, sell: 70, exitDays: 190, position: null },
  nkx: { buy: 30, sell: 70, exitDays: 130, position: null },
};
export const MMF_RATE = 0.035;
/** 保存値を読み込むときに、欠けた項目を既定値で補う */
export function normalizeRsiTriggerSettings(v: any): RsiTriggerSettings {
  const d = DEFAULT_RSI_TRIGGER_SETTINGS;
  const num = (x: any, def: number) => (typeof x === 'number' && isFinite(x) ? x : def);
  const pos = (x: any) => (x && typeof x.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.date) && typeof x.price === 'number' && x.price > 0 ? { date: x.date, price: x.price } : null);
  const inst = (x: any, def: RsiTriggerInstrumentSettings): RsiTriggerInstrumentSettings => ({ buy: num(x?.buy, def.buy), sell: num(x?.sell, def.sell), exitDays: num(x?.exitDays, def.exitDays), position: pos(x?.position) });
  return { base: num(v?.base, d.base), voo: inst(v?.voo, d.voo), qqq: inst(v?.qqq, d.qqq), nkx: inst(v?.nkx, d.nkx) };
}
/** 設定と系列から、ある銘柄の現在の状態を求める（DDDashboardのステータス欄・パネル共通） */
export function statusFor(FULL: RsiPoint[] | null | undefined, s: RsiTriggerInstrumentSettings, baseMan: number, today: Date): RsiTriggerStatus | null {
  if (!FULL || !FULL.length) return null;
  const last = FULL[FULL.length - 1];
  const pos = s.position ? { date: new Date(`${s.position.date}T00:00:00Z`), price: s.position.price } : null;
  return rsiTriggerStatus(last, { buy: s.buy, sell: s.sell, exitDays: s.exitDays, base: baseMan * 10000 }, pos, today);
}
