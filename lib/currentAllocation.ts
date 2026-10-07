// 「DD毎のA〜E配分表」の最上段に出す「現状」行の計算（純関数）。
//   ・実際のA〜E構成比：クラスごとの評価額を整数%にし、最大剰余法で合計をちょうど100%にそろえる（目標行と同じ整数表示で見比べるため）
//   ・現状−目標のpt差、各クラスの主な銘柄、VOOのDDのラベル
// A〜Eの分類は保有データの rank（既存の銘柄→クラスの対応）をそのまま使い、ここで新しい分類はしない。
// このファイルは外部importを持たないため、`node --test` から直接実行できる。

export const ALLOCATION_CATS = ["A", "B", "C", "D", "E"] as const;
export type Cat = (typeof ALLOCATION_CATS)[number];
export type CatValues = Record<Cat, number>;
export interface HoldingLike { name: string; rank: string; amount: number }

// クラスごとの評価額合計（A〜E以外のrankは数えない）
export function amountsByClass(holdings: HoldingLike[]): CatValues {
  const out: CatValues = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  for (const h of holdings) if ((ALLOCATION_CATS as readonly string[]).includes(h.rank) && Number.isFinite(h.amount)) out[h.rank as Cat] += h.amount;
  return out;
}

// 評価額 → 整数%（合計100）。端数は最大剰余法：切り捨て後、小数部の大きいクラスから1ずつ足す。評価額が無ければ null。
export function largestRemainderPercent(amounts: CatValues): CatValues | null {
  const total = ALLOCATION_CATS.reduce((s, c) => s + Math.max(0, amounts[c]), 0);
  if (!(total > 0)) return null;
  const raw = {} as CatValues, out = {} as CatValues;
  let sum = 0;
  for (const c of ALLOCATION_CATS) { raw[c] = (Math.max(0, amounts[c]) / total) * 100; out[c] = Math.floor(raw[c]); sum += out[c]; }
  const order = [...ALLOCATION_CATS].sort((a, b) => (raw[b] - out[b]) - (raw[a] - out[a]));
  for (let i = 0; i < 100 - sum; i++) out[order[i]] += 1;
  return out;
}

// 現状 − 目標（pt）
export function allocationDiff(actual: CatValues, target: CatValues): CatValues {
  const out = {} as CatValues;
  for (const c of ALLOCATION_CATS) out[c] = actual[c] - target[c];
  return out;
}

// クラス内の評価額上位n銘柄（同じ名前は合算）
export function topHoldingsByClass(holdings: HoldingLike[], cat: Cat, n = 3): { name: string; amount: number }[] {
  const m = new Map<string, number>();
  for (const h of holdings) if (h.rank === cat && Number.isFinite(h.amount)) m.set(h.name, (m.get(h.name) ?? 0) + h.amount);
  return [...m.entries()].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount).slice(0, n);
}

// VOOのDDのラベル。ATH更新中（DD 0）は「VOO ATH」、short=true（スマホ）は「−4.2%」「ATH」のみ。値が無ければ null
export function ddLabel(dd: number | null | undefined, short = false): string | null {
  if (dd == null || !Number.isFinite(dd)) return null;
  if (dd >= 0) return short ? "ATH" : "VOO ATH";
  const v = `−${Math.abs(dd).toFixed(1)}%`;
  return short ? v : `VOO DD ${v}`;
}
