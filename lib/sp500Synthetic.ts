// SP500本系列の「VOO換算」合成：SP500指数の手動入力を終了し、VOOの自動取得データだけで長期のDDチャート・年比較・トラックレコードを
// 維持するための合成シリーズを作る。
//   ・接続点より前：これまで手動入力してきたSP500指数（バックアップとして保持）× 補正係数
//   ・接続点以降：VOOの実際の終値（Twelve Data経由の自動取得）
//   ・補正係数 ＝ 接続点でのVOOの終値 ÷ 接続点でのSP500指数 → 接続点で価格が段差なくつながる。騰落率・DD率はスケール変換で変わらない。
// 接続点の選び方：SP500とVOOの両方がある「最も新しい日」。
//   VOO上場直後（2010年）を接続点にすると、Stooqから取り込んだVOOの過去データが配当込みに調整された値（≒トータルリターン）のため、
//   配当を含まないSP500指数と2010年以降で騰落率が年2%前後ずれる（検証で確認）。最新の重複日で接続すれば、既存の全期間の統計は
//   これまでと完全に一致し、以後は配当を含まない実際のVOO終値（自動取得）で続く。
// このファイルは外部importを持たないため、`node --test` から直接実行できる。

export interface DatedPrice { date: Date; price: number }
export interface SyntheticResult {
  series: DatedPrice[];
  junctionDate: string | null; // YYYY-MM-DD（接続できない場合はnull）
  factor: number | null;
  sp500Count: number; // 換算に使ったSP500（接続点より前）の件数
  vooCount: number; // 接続点以降のVOOの件数
  mode: "spliced" | "sp500-only" | "voo-only";
}
const iso = (d: Date) => d.toISOString().slice(0, 10);

export function buildVooEquivalentSeries(sp500: DatedPrice[], voo: DatedPrice[]): SyntheticResult {
  const clean = (list: DatedPrice[]) => {
    const m = new Map<string, DatedPrice>();
    for (const p of list) if (p && Number.isFinite(p.price) && p.price > 0) m.set(iso(p.date), p); // 同じ日付は後勝ち
    return [...m.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
  };
  const sp = clean(sp500), vo = clean(voo);
  if (!vo.length) return { series: sp, junctionDate: null, factor: null, sp500Count: sp.length, vooCount: 0, mode: "sp500-only" };
  const vooByDate = new Map(vo.map((p) => [iso(p.date), p.price]));
  let junction: DatedPrice | null = null;
  for (let i = sp.length - 1; i >= 0; i--) if (vooByDate.has(iso(sp[i].date))) { junction = sp[i]; break; }
  if (!junction) return { series: vo, junctionDate: null, factor: null, sp500Count: 0, vooCount: vo.length, mode: "voo-only" };
  const jIso = iso(junction.date);
  const factor = vooByDate.get(jIso)! / junction.price;
  const before = sp.filter((p) => iso(p.date) < jIso).map((p) => ({ date: p.date, price: p.price * factor }));
  const after = vo.filter((p) => iso(p.date) >= jIso);
  return { series: [...before, ...after], junctionDate: jIso, factor, sp500Count: before.length, vooCount: after.length, mode: "spliced" };
}

// 異常値チェック：価格が正でない点と、1日で ±maxDailyMove を超える変化（実際の暴落日も含まれうるので一覧で確認する）。
export function scanAnomalies(series: DatedPrice[], maxDailyMove = 0.12): { nonPositive: number; bigMoves: { date: string; changePct: number }[] } {
  let nonPositive = 0;
  const bigMoves: { date: string; changePct: number }[] = [];
  for (let i = 0; i < series.length; i++) {
    if (!(series[i].price > 0)) nonPositive++;
    if (i > 0 && series[i - 1].price > 0) {
      const r = series[i].price / series[i - 1].price - 1;
      if (Math.abs(r) > maxDailyMove) bigMoves.push({ date: iso(series[i].date), changePct: r * 100 });
    }
  }
  return { nonPositive, bigMoves };
}
