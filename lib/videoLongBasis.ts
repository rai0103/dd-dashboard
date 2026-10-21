// 年末見通しの根拠データ：CSV（日次）から、直近10年の年間騰落率と、同じ大統領サイクル区分の年の推移を作る。
import { StockDataPoint } from './videoTypes';

export interface BasisYear { year: number; ret: number; pts?: { t: number; v: number }[] }
export interface CyclePath { year: number; ret: number; pts: { t: number; v: number }[] }
export interface LongBasis { recent: BasisYear[]; cycle: CyclePath[]; curPath: { t: number; v: number }[]; curYear: number }

/** 暦年の騰落率（前年末終値→当年末終値）。当年が未完了の年は含めない */
export function annualReturns(daily: StockDataPoint[], fromYear: number, toYear: number): BasisYear[] {
  const lastClose = new Map<number, number>();
  for (const d of daily) lastClose.set(parseInt(d.date.slice(0, 4), 10), d.close);
  const out: BasisYear[] = [];
  for (let y = fromYear; y <= toYear; y++) {
    const a = lastClose.get(y - 1), b = lastClose.get(y);
    if (a && b) out.push({ year: y, ret: (b / a - 1) * 100 });
  }
  return out;
}

/** 1年分の推移（前年末=100、横軸は1/1〜12/31を0〜1） */
export function yearPath(daily: StockDataPoint[], year: number, endDate?: string): { t: number; v: number }[] {
  let base = 0;
  const pts: { t: number; v: number }[] = [];
  const y0 = Date.UTC(year, 0, 1), y1 = Date.UTC(year + 1, 0, 1);
  for (const d of daily) {
    const y = parseInt(d.date.slice(0, 4), 10);
    if (y === year - 1) base = d.close;
    else if (y === year) {
      if (endDate && d.date > endDate) break;
      if (!base) continue;
      const [yy, mm, dd] = d.date.split('-').map(Number);
      pts.push({ t: (Date.UTC(yy, mm - 1, dd) - y0) / (y1 - y0), v: (d.close / base) * 100 });
    }
  }
  return pts;
}

export function buildBasis(daily: StockDataPoint[], curYear: number, cycleYears: number[], asOf: string): LongBasis | null {
  if (!daily.length) return null;
  const recent = annualReturns(daily, curYear - 10, curYear - 1).map(x => ({ ...x, pts: yearPath(daily, x.year) }));
  const rets = new Map(annualReturns(daily, Math.min(...cycleYears, curYear), curYear - 1).map(x => [x.year, x.ret] as const));
  const cycle = cycleYears.filter(y => y < curYear && rets.has(y)).map(y => ({ year: y, ret: rets.get(y)!, pts: yearPath(daily, y) })).filter(p => p.pts.length > 20);
  return { recent, cycle, curPath: yearPath(daily, curYear, asOf), curYear };
}

/** 推移の途中の値（tは0〜1。折れ線を補間） */
export function valueAt(pts: { t: number; v: number }[], t: number): number {
  if (!pts.length) return 100;
  if (t <= pts[0].t) return pts[0].v;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].t >= t) { const a = pts[i - 1], c = pts[i]; const f = c.t > a.t ? (t - a.t) / (c.t - a.t) : 0; return a.v + (c.v - a.v) * f; }
  }
  return pts[pts.length - 1].v;
}
