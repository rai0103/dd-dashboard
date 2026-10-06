// 楽天証券の取引履歴CSV（日本株 tradehistory(JP)・米国株 tradehistory(US)・投資信託 tradehistory(INVST)）の取り込みと、
// 銘柄ごとの実現損益の計算。実績パフォーマンス「⑧トレード損益ランキング」で使う。
//
// ・CSVはCP932（Shift-JIS）。見出し行の列名から3種類を自動判別する。
// ・再アップロードは差分取り込み：1行＝1取引をキー（行の全列＋同一内容の行の出現順）で識別し、保存済みに無い行だけ追加する
//   （同日・同数量・同単価の約定が複数あっても取りこぼさず、同じファイルを再度読ませても0件追加になる）。
// ・実現損益は銘柄ごとに移動平均法（特定口座の「総平均法に準ずる方法」）で計算する。
//   - 現物：買付（積立・再投資・現引を含む）で数量と取得額を加算し、売付・解約時に平均取得単価で原価を出して損益を計上。
//   - 信用：楽天のCSVは信用返済（売埋・買埋）行の受渡金額が「手数料・金利等差引後の決済損益」そのものなので、その値を損益とする。
//     現引は信用買建を現物に振り替える取引で、受渡金額（建玉代金＋諸費用）を現物の取得額として加算する。
//   - 入庫・出庫（口座間の振替、株式分割・併合）は売買ではないので損益は計上しない。ただし保有数量だけは合わせる：
//     同じ日の入庫と出庫は合算し（分割・併合・口座間振替）、取得額の合計は変えずに数量だけ増減する。出庫だけの日は平均単価で
//     数量と取得額を減らす。保有が無い状態での入庫（スピンオフ等）は取得額不明の株として扱い、その売却は「取得価額不明」として印を付ける。
// このファイルは外部importを持たないため、`node --test` から直接実行できる。

export type TradeKind = "JP" | "US" | "INVST";
export type TradeAction = "buy" | "sell" | "marginOpen" | "marginClose" | "delivery" | "transferIn" | "transferOut" | "other";
export const TRADE_KIND_LABEL: Record<TradeKind, string> = { JP: "日本株", US: "米国株", INVST: "投資信託" };

export interface Trade {
  key: string; // 重複判定用の一意キー
  kind: TradeKind;
  date: string; // 約定日 YYYY-MM-DD
  symbol: string; // 銘柄コード／ティッカー／ファンド名
  name: string;
  account: string;
  action: TradeAction;
  margin: boolean; // 信用取引か
  qty: number;
  amountJpy: number | null; // buy/delivery：取得額（手数料込み）、sell：受取額、marginClose：決済損益（符号付き）
  rawType: string; // 取引区分／売買区分（表示・確認用）
}
export interface TradeHistory { version: 1; trades: Trade[]; updatedAt: string | null }
export const emptyTradeHistory = (): TradeHistory => ({ version: 1, trades: [], updatedAt: null });

// ---------------- CSV ----------------
export function decodeCp932(buf: ArrayBuffer | Uint8Array): string {
  return new TextDecoder("shift_jis").decode(buf instanceof Uint8Array ? buf : new Uint8Array(buf));
}
// ダブルクォート囲み（"" のエスケープ・値内のカンマ／改行）に対応したCSVパーサー。
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  const t = text.replace(/^﻿/, "");
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (quoted) {
      if (ch === '"') { if (t[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch !== "\r") field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== "")); // 空行は捨てる
}
export function detectTradeKind(header: string[]): TradeKind | null {
  const h = header.map((c) => c.trim());
  if (h.includes("銘柄コード")) return "JP";
  if (h.includes("ティッカー")) return "US";
  if (h.includes("ファンド名")) return "INVST";
  return null;
}
// 数値：カンマ区切り・「-」（該当なし）・「4,000(100)」のようなポイント併記に対応。数値でなければnull。
export function num(v: string | undefined): number | null {
  if (v == null) return null;
  const m = v.replace(/,/g, "").trim().match(/^-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}
export function toYmd(v: string | undefined): string | null {
  const m = (v ?? "").trim().match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : null;
}
// ティッカー変更・ファンド名変更で同じ銘柄が別名になっているもの（旧→新）。同一銘柄として平均取得単価を引き継ぐ。
// ここに無いと、変更前に買った分の取得額が変更後の売却に反映されず「取得価額不明」になる。
export const SYMBOL_ALIASES: Record<TradeKind, Record<string, string>> = {
  JP: {},
  US: { FB: "META" }, // 2022/6 Facebook → Meta Platforms
  INVST: { "楽天・全米株式インデックス・ファンド（楽天・バンガード・ファンド（全米株式））": "楽天・全米株式インデックス・ファンド(楽天・VTI)" }, // 2022/12 名称変更
};
// 53bitの文字列ハッシュ（cyrb53）。キーを短く保つために使う（衝突は実用上無視できる）。
function hash53(str: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

// CSV（文字列）→ 取引の配列。unknownRows：売買の種類を判別できず集計対象外にした行の数。
export function parseTradeCsv(text: string): { kind: TradeKind | null; trades: Trade[]; unknownRows: number; error: string | null } {
  const rows = parseCsv(text);
  if (!rows.length) return { kind: null, trades: [], unknownRows: 0, error: "CSVにデータがありません。" };
  const header = rows[0].map((c) => c.trim());
  const kind = detectTradeKind(header);
  if (!kind) return { kind: null, trades: [], unknownRows: 0, error: "楽天証券の取引履歴CSV（日本株・米国株・投資信託）の見出し行が見つかりません。" };
  const col = (name: string) => header.indexOf(name);
  const need = kind === "JP" ? ["約定日", "銘柄コード", "銘柄名", "取引区分", "売買区分", "数量［株］", "受渡金額［円］"]
    : kind === "US" ? ["約定日", "ティッカー", "銘柄名", "取引区分", "売買区分", "数量［株］", "為替レート", "受渡金額［USドル］", "受渡金額［円］"]
    : ["約定日", "ファンド名", "取引", "数量［口］", "受渡金額/(ポイント利用)[円]"];
  const missing = need.filter((n) => col(n) === -1);
  if (missing.length) return { kind, trades: [], unknownRows: 0, error: `列が見つかりません：${missing.join("、")}` };

  const seen = new Map<string, number>();
  const trades: Trade[] = [];
  let unknownRows = 0;
  for (const r of rows.slice(1)) {
    const get = (name: string) => (r[col(name)] ?? "").trim();
    const date = toYmd(get("約定日"));
    if (!date) continue;
    const rowText = r.map((c) => c.trim()).join("\u001f");
    const n = (seen.get(rowText) ?? 0) + 1;
    seen.set(rowText, n);
    const key = `${kind}:${hash53(rowText)}:${n}`;
    let t: Omit<Trade, "key" | "kind" | "date"> | null = null;
    if (kind === "INVST") {
      const type = get("取引");
      const action: TradeAction = type === "買付" || type === "再投資" ? "buy" : type === "解約" ? "sell" : "other";
      t = { symbol: get("ファンド名"), name: get("ファンド名"), account: get("口座"), action, margin: false, qty: num(get("数量［口］")) ?? 0, amountJpy: num(get("受渡金額/(ポイント利用)[円]")), rawType: type };
    } else {
      const tk = get("取引区分"), bk = get("売買区分");
      const symbol = kind === "JP" ? get("銘柄コード") : get("ティッカー");
      // 円の受渡金額：日本株はそのまま。米国株は円決済ならその値、外貨決済ならUSドルの受渡金額×為替レート。
      const yen = kind === "JP" ? num(get("受渡金額［円］")) : (num(get("受渡金額［円］")) ?? (() => { const usd = num(get("受渡金額［USドル］")), fx = num(get("為替レート")); return usd != null && fx != null ? usd * fx : null; })());
      let action: TradeAction = "other", margin = false;
      if (bk === "入庫" || tk.startsWith("入庫")) action = "transferIn";
      else if (bk === "出庫" || tk.startsWith("出庫")) action = "transferOut";
      else if (tk === "信用新規") { action = "marginOpen"; margin = true; }
      else if (tk === "信用返済") { action = "marginClose"; margin = true; }
      else if (tk === "現引") action = "delivery";
      else if (bk === "買付" || (tk === "積立" && bk === "")) action = "buy";
      else if (bk === "売付") action = "sell";
      t = { symbol, name: get("銘柄名"), account: kind === "JP" ? get("口座区分") : get("口座"), action, margin, qty: num(get("数量［株］")) ?? 0, amountJpy: yen, rawType: [tk, bk].filter(Boolean).join("・") };
    }
    if (t.action === "other") unknownRows++;
    t.symbol = SYMBOL_ALIASES[kind][t.symbol] ?? t.symbol;
    trades.push({ key, kind, date, ...t });
  }
  return { kind, trades, unknownRows, error: null };
}

// 差分取り込み：保存済みに無いキーの取引だけ追加する。
export function mergeTrades(existing: Trade[], incoming: Trade[]): { trades: Trade[]; added: number; skipped: number } {
  const keys = new Set(existing.map((t) => t.key));
  const fresh: Trade[] = [];
  let skipped = 0;
  for (const t of incoming) {
    if (keys.has(t.key)) { skipped++; continue; }
    keys.add(t.key);
    fresh.push(t);
  }
  return { trades: [...existing, ...fresh], added: fresh.length, skipped };
}

// ---------------- 実現損益 ----------------
export interface RealizedEvent {
  kind: TradeKind; symbol: string; name: string; date: string;
  margin: boolean; pnl: number;
  unknownBasis: boolean; // 取得価額が分からない株（買付履歴より多い売却・保有の無い状態での入庫分）を含む
}
const ACTION_ORDER: Record<TradeAction, number> = { buy: 0, delivery: 0, marginOpen: 1, transferIn: 2, transferOut: 2, marginClose: 3, sell: 4, other: 5 };
const EPS = 1e-9;

export function computeRealizedEvents(trades: Trade[]): RealizedEvent[] {
  const bySymbol = new Map<string, Trade[]>();
  for (const t of trades) {
    const k = `${t.kind}|${t.symbol}`;
    if (!bySymbol.has(k)) bySymbol.set(k, []);
    bySymbol.get(k)!.push(t);
  }
  const events: RealizedEvent[] = [];
  for (const list of bySymbol.values()) {
    // 約定日順。同じ日の中では買付→（振替）→売却の順に処理する（日計り取引で保有が一時的にマイナスにならないように）
    const sorted = list.map((t, i) => ({ t, i })).sort((a, b) => a.t.date.localeCompare(b.t.date) || ACTION_ORDER[a.t.action] - ACTION_ORDER[b.t.action] || a.i - b.i).map((x) => x.t);
    let qty = 0, cost = 0, unknownQty = 0;
    const name = list[list.length - 1].name;
    for (let i = 0; i < sorted.length; i++) {
      const t = sorted[i];
      if (t.action === "buy" || t.action === "delivery") { qty += t.qty; cost += t.amountJpy ?? 0; }
      else if (t.action === "transferIn" || t.action === "transferOut") {
        // 同じ日の入庫・出庫をまとめて処理する
        let inQty = 0, outQty = 0, j = i;
        for (; j < sorted.length && sorted[j].date === t.date && (sorted[j].action === "transferIn" || sorted[j].action === "transferOut"); j++) {
          if (sorted[j].action === "transferIn") inQty += sorted[j].qty; else outQty += sorted[j].qty;
        }
        i = j - 1;
        const net = inQty - outQty;
        if (inQty > 0 && outQty > 0) { qty = Math.max(0, qty + net); } // 分割・併合・口座間振替：取得額の合計は変えない
        else if (net > 0) { if (qty <= EPS) unknownQty += net; qty += net; } // 入庫のみ：分割なら原価0の追加、保有が無ければ取得額不明
        else if (net < 0) { const out = Math.min(-net, qty); if (qty > EPS) cost -= (cost / qty) * out; qty -= out; unknownQty = Math.min(unknownQty, qty); } // 出庫のみ：平均単価で減らす
      } else if (t.action === "sell") {
        const proceeds = t.amountJpy ?? 0;
        const covered = Math.min(t.qty, Math.max(qty, 0));
        const avg = qty > EPS ? cost / qty : 0;
        const costOut = avg * covered;
        const coveredProceeds = t.qty > EPS ? proceeds * (covered / t.qty) : 0;
        const unknownBasis = covered + EPS < t.qty || unknownQty > EPS;
        events.push({ kind: t.kind, symbol: t.symbol, name, date: t.date, margin: false, pnl: coveredProceeds - costOut, unknownBasis });
        qty -= covered; cost -= costOut;
        if (unknownQty > EPS) unknownQty = Math.max(0, unknownQty - t.qty);
        if (qty <= EPS) { qty = 0; cost = 0; unknownQty = 0; }
      } else if (t.action === "marginClose") {
        events.push({ kind: t.kind, symbol: t.symbol, name, date: t.date, margin: true, pnl: t.amountJpy ?? 0, unknownBasis: false });
      }
    }
  }
  return events.sort((a, b) => a.date.localeCompare(b.date));
}

// ---------------- 集計・ランキング ----------------
export type PeriodFilter = { type: "all" } | { type: "year"; value: string } | { type: "month"; value: string }; // year: "2026"、month: "2026-09"
export type KindFilter = "all" | TradeKind;
export type TradeTypeFilter = "all" | "cash" | "margin";
export interface RankingRow { kind: TradeKind; symbol: string; name: string; pnl: number; sellCount: number; tradeCount: number; unknownBasis: boolean }

const inPeriod = (date: string, p: PeriodFilter) => p.type === "all" || (p.type === "year" ? date.startsWith(p.value) : date.slice(0, 7) === p.value);
const COUNTED: TradeAction[] = ["buy", "sell", "marginOpen", "marginClose", "delivery"]; // 取引件数に数える（入庫・出庫は除く）

// 期間・商品種別・取引種別で絞り込み、銘柄ごとの実現損益を合計する（期間内に実現損益がある銘柄が対象。日付は売却・返済の約定日）。
export function aggregateRanking(events: RealizedEvent[], trades: Trade[], f: { period: PeriodFilter; kind: KindFilter; tradeType: TradeTypeFilter }): RankingRow[] {
  const typeOk = (margin: boolean) => f.tradeType === "all" || (f.tradeType === "margin") === margin;
  const kindOk = (k: TradeKind) => f.kind === "all" || f.kind === k;
  const rows = new Map<string, RankingRow>();
  for (const e of events) {
    if (!inPeriod(e.date, f.period) || !kindOk(e.kind) || !typeOk(e.margin)) continue;
    const k = `${e.kind}|${e.symbol}`;
    const row = rows.get(k) ?? { kind: e.kind, symbol: e.symbol, name: e.name, pnl: 0, sellCount: 0, tradeCount: 0, unknownBasis: false };
    row.pnl += e.pnl; row.sellCount++; row.unknownBasis ||= e.unknownBasis;
    rows.set(k, row);
  }
  for (const t of trades) {
    const row = rows.get(`${t.kind}|${t.symbol}`);
    if (row && COUNTED.includes(t.action) && inPeriod(t.date, f.period) && typeOk(t.margin || t.action === "marginOpen" || t.action === "marginClose")) row.tradeCount++;
  }
  return [...rows.values()].map((r) => ({ ...r, pnl: Math.round(r.pnl) }));
}
// 上位（利益の大きい順）と下位（損失の大きい順）。銘柄数が少ない場合も同じ銘柄が両方に出ないようにする。
export function splitRanking(rows: RankingRow[], n = 10): { top: RankingRow[]; bottom: RankingRow[] } {
  const desc = [...rows].sort((a, b) => b.pnl - a.pnl);
  const top = desc.filter((r) => r.pnl > 0).slice(0, n);
  const topKeys = new Set(top.map((r) => `${r.kind}|${r.symbol}`));
  const bottom = [...rows].sort((a, b) => a.pnl - b.pnl).filter((r) => r.pnl < 0 && !topKeys.has(`${r.kind}|${r.symbol}`)).slice(0, n);
  return { top, bottom };
}
// 期間の選択肢（実現損益がある年・月。新しい順）。
export function periodOptions(events: RealizedEvent[]): { years: string[]; months: string[] } {
  const years = new Set<string>(), months = new Set<string>();
  for (const e of events) { years.add(e.date.slice(0, 4)); months.add(e.date.slice(0, 7)); }
  return { years: [...years].sort().reverse(), months: [...months].sort().reverse() };
}
