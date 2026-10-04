// PC⇔スマホ同期の3-wayマージ。同期データは「キー → JSON文字列」の丸ごと1件（Worker KV）なので、そのままPUTすると
// 後から書いた端末が全キーを上書きし、他の端末での更新（例：スマホで取り込んだmoomooの保有銘柄・更新日）が消えてしまう。
// そこで送信前にサーバーの現在値を取得し、前回同期した時点の値（base）と比べて「どちらの端末で変わったか」をキーごと・
// 項目ごとに判定して合成する。このファイルは外部importを持たないため、`node --test` から直接実行できる。

export type SyncData = Record<string, string>;

// 項目（オブジェクトのキー）単位で3-wayマージするキー
const MAP_KEYS = new Set(["holdings_as_of", "broker_summaries", "broker_holding_history", "classification_overrides", "category_default_ranks", "fixed_positions"]);
// 日付ごとの配列を日付単位でマージするキー
const DATE_SERIES_KEYS = new Set(["voo_price_history", "spy_voo_price_history"]);

const parse = (s: string | undefined): any => { if (s == null) return undefined; try { return JSON.parse(s); } catch { return undefined; } };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// 1項目の3-way判定：片方だけ変わっていればその値、両方変わっていれば conflict で決める
function merge3<T>(base: T | undefined, local: T | undefined, server: T | undefined, conflict: (l: T | undefined, s: T | undefined) => T | undefined): T | undefined {
  if (same(local, server)) return local;
  if (same(local, base)) return server;
  if (same(server, base)) return local;
  return conflict(local, server);
}

// 両端末で同じ項目が変わったとき：更新日は新しい方、口座サマリーは取込が新しい方、それ以外はこの端末（local）を優先
function resolveMapEntry(key: string, l: any, s: any): any {
  if (l === undefined) return s;
  if (s === undefined) return l;
  if (key === "holdings_as_of") return String(s) > String(l) ? s : l;
  if (key === "broker_summaries") return String(s?.importedAt ?? "") > String(l?.importedAt ?? "") ? s : l;
  return l;
}

function mergeMap(key: string, base: any, local: any, server: any): any {
  const b = base ?? {}, l = local ?? {}, s = server ?? {};
  const out: Record<string, unknown> = {};
  for (const k of new Set([...Object.keys(l), ...Object.keys(s)])) {
    const v = merge3(b[k], l[k], s[k], (lv, sv) => resolveMapEntry(key, lv, sv));
    if (v !== undefined) out[k] = v;
  }
  return out;
}

// 保有銘柄は口座主（owner）ごとにまとめて3-way判定する（取り込みは口座単位で丸ごと置き換えるため）。
// 両端末で同じ口座が変わった場合はこの端末を優先。
function mergeHoldings(base: any[] | undefined, local: any[] | undefined, server: any[] | undefined): any[] {
  const group = (list: any[] | undefined) => {
    const m = new Map<string, any[]>();
    for (const h of list ?? []) { const k = String(h?.owner ?? ""); if (!m.has(k)) m.set(k, []); m.get(k)!.push(h); }
    return m;
  };
  const b = group(base), l = group(local), s = group(server);
  const owners = [...new Set([...l.keys(), ...s.keys()])];
  return owners.flatMap((o) => merge3(b.get(o), l.get(o), s.get(o), (lv, sv) => lv ?? sv) ?? []);
}

// 価格履歴：日付ごとに3-way判定（両方で変わった日はこの端末を優先）。日付順に並べる。
function mergeDateSeries(base: any[] | undefined, local: any[] | undefined, server: any[] | undefined): any[] {
  const byDate = (list: any[] | undefined) => new Map((list ?? []).map((p) => [String(p?.date), p]));
  const b = byDate(base), l = byDate(local), s = byDate(server);
  const dates = [...new Set([...l.keys(), ...s.keys()])].sort();
  return dates.map((d) => merge3(b.get(d), l.get(d), s.get(d), (lv, sv) => lv ?? sv)).filter((p) => p !== undefined);
}

// base：前回この端末が同期した時点のサーバーデータ（無ければ null。初回は判定できないため、地図型はマージ・その他はこの端末優先）
export function mergeSyncData(base: SyncData | null, local: SyncData, server: SyncData): SyncData {
  const out: SyncData = {};
  for (const key of new Set([...Object.keys(local), ...Object.keys(server)])) {
    const bs = base?.[key], ls = local[key], ss = server[key];
    if (ls === ss) { if (ls !== undefined) out[key] = ls; continue; }
    if (base && ls === bs) { if (ss !== undefined) out[key] = ss; continue; }
    if (base && ss === bs) { if (ls !== undefined) out[key] = ls; continue; }
    // 両方で変わった（または base が無い）：中身を見てマージする
    const b = parse(bs), l = parse(ls), s = parse(ss);
    let merged: unknown;
    if (l === undefined || s === undefined) merged = l ?? s;
    else if (MAP_KEYS.has(key) && typeof l === "object" && typeof s === "object" && !Array.isArray(l)) merged = mergeMap(key, b, l, s);
    else if (key === "portfolio_holdings" && Array.isArray(l) && Array.isArray(s)) merged = mergeHoldings(b, l, s);
    else if (DATE_SERIES_KEYS.has(key) && Array.isArray(l) && Array.isArray(s)) merged = mergeDateSeries(b, l, s);
    else merged = l; // その他（設定・投資収支Excel等）はこの端末を優先
    if (merged !== undefined) out[key] = JSON.stringify(merged);
  }
  return out;
}
