// VOO/QQQ/GOLD（XAUUSD）の終値系列（IndexedDBキー"spy_voo_price_history"、1日1レコード { date, voo?, qqq?, gold?, goldSrc? }）の更新ルール。
// ゴールドはStooq CSV取り込み・直接入力と、Twelve Data APIの自動取得（起動時）の2経路で更新されるため、優先順位を次のとおり決める：
//   CSV取り込み・直接入力 ＞ API自動取得
//   - CSV/直接入力は常にその日のgoldを上書きし、goldSrcを消す（＝ユーザー登録値として扱う）
//   - API取得値は「goldが未登録の日」か「前回もAPIで登録した日（goldSrc === "api"）」にだけ書き込む
//     （当日の値は取引中に変わるため、API登録分は後のAPI取得で更新してよい。ユーザー登録値は上書きしない）
// このファイルは外部importを持たないため、`node --test` から直接実行できる。

export type PriceRecord = { date: Date; voo?: number; qqq?: number; gold?: number; goldSrc?: "api" };
export type PriceRow = { date: Date; price: number };
export type PriceField = "voo" | "qqq" | "gold";

const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const byDate = (series: PriceRecord[]) => new Map(series.map((p) => [dayKey(p.date), p]));
const sorted = (map: Map<string, PriceRecord>) => Array.from(map.values()).sort((a, b) => a.date.getTime() - b.date.getTime());

// CSV一括取り込み・直接入力：同じ日付の既存レコードには該当フィールドのみ上書きで合成する。
// goldの場合はユーザー登録値になるためgoldSrc（API由来の印）を消す。
export function importUserPrices(series: PriceRecord[], kind: PriceField, rows: PriceRow[]): PriceRecord[] {
  const map = byDate(series);
  for (const row of rows) {
    const key = dayKey(row.date);
    const next: PriceRecord = { ...(map.get(key) ?? { date: row.date }), [kind]: row.price };
    if (kind === "gold") delete next.goldSrc;
    map.set(key, next);
  }
  return sorted(map);
}

// API自動取得のゴールド終値を反映する。ユーザー登録値（goldがありgoldSrcが無い日）は上書きしない。
// changed：1件でも書き込んだか（保存・同期の要否の判定用）
export function applyApiGold(series: PriceRecord[], rows: PriceRow[]): { series: PriceRecord[]; changed: boolean } {
  const map = byDate(series);
  let changed = false;
  for (const row of rows) {
    const key = dayKey(row.date);
    const existing = map.get(key);
    if (existing?.gold != null && existing.goldSrc !== "api") continue; // CSV/直接入力の値を優先
    if (existing?.gold === row.price && existing.goldSrc === "api") continue;
    map.set(key, { ...(existing ?? { date: row.date }), gold: row.price, goldSrc: "api" });
    changed = true;
  }
  return { series: changed ? sorted(map) : series, changed };
}

// kindのデータのみ削除する。goldの場合はAPI由来の印も消す。全フィールドが消えた日付のレコードは除去する。
export function resetPriceField(series: PriceRecord[], kind: PriceField): PriceRecord[] {
  return series
    .map((p) => { const c = { ...p }; delete c[kind]; if (kind === "gold") delete c.goldSrc; return c; })
    .filter((p) => p.voo != null || p.qqq != null || p.gold != null);
}

// 起動時にゴールドの履歴をAPIから取り直すかどうか。登録済みのgoldが無ければ全期間（start_date無し）、
// 最終日から staleDays 日より空いていれば最終日以降を取得する（週末をまたぐだけなら取得しない）。null＝取得不要。
export function goldHistoryFetchStart(series: PriceRecord[], today: Date, staleDays = 3): { startDate: string | null } | null {
  let last: Date | null = null;
  for (const p of series) if (p.gold != null && (!last || p.date > last)) last = p.date;
  if (!last) return { startDate: null };
  const gapDays = (today.getTime() - last.getTime()) / 86400000;
  return gapDays > staleDays ? { startDate: dayKey(last) } : null;
}
