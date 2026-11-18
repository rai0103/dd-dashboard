// 大和コネクト証券などの保有銘柄（投資信託・国内ETF）の値動きを、Stooqの日足で代用して描くための計算。
// 投資信託の基準価額はStooq等に無いため、各ファンドが連動する指数（または同じ指数のETF）を使い、
// 米国の指数はドル円で円に換算、レバレッジ型は日々の値動きを2倍して複利で積み上げる（＝2倍ブル型の作り方）。
// 取得は Cloudflare Worker の /api/stooq-history（Stooqの日足CSV）経由。

export type Dated = { date: string; close: number };

/** 代用データの候補（上から順に試し、データが取れたものを使う） */
export interface ProxySource { symbol: string; label: string; fx?: boolean; lev?: number }
export interface HoldingProxy { key: string; label: string; sources: ProxySource[] }

/**
 * 銘柄名から、値動きの代用にする指数・ETFを決める。当てはまらない銘柄は null（グラフに出さない）。
 * fx：ドル建ての指数をドル円で円に換算する。lev：日々の値動きの倍率（レバレッジ型）。
 */
export function proxyForHolding(name: string): HoldingProxy | null {
  const n = String(name || '').normalize('NFKC');
  const lev = /レバレッジ|レバ|ブル|2倍/.test(n) ? 2 : 1;
  if (/FANG/i.test(n)) return { key: 'fang', label: `NYSE FANG+指数${lev > 1 ? '×2' : ''}（円換算）`, sources: [
    { symbol: '^nyfang', label: 'NYSE FANG+指数', fx: true, lev },
    { symbol: 'fngs.us', label: 'FANG+ ETN（FNGS）', fx: true, lev },
    { symbol: '^ndx', label: 'NASDAQ100（FANG+の代わり）', fx: true, lev },
  ] };
  if (/NASDAQ|ナスダック/i.test(n)) return { key: 'ndx', label: `NASDAQ100${lev > 1 ? '×2' : ''}（円換算）`, sources: [{ symbol: '^ndx', label: 'NASDAQ100', fx: true, lev }] };
  if (/S&P\s*500|S＆P|米国株式/i.test(n)) return { key: 'spx', label: `S&P500${lev > 1 ? '×2' : ''}（円換算）`, sources: [{ symbol: '^spx', label: 'S&P500', fx: true, lev }] };
  if (/TOPIX|国内株式/i.test(n)) return { key: 'tpx', label: 'TOPIX', sources: [{ symbol: '^tpx', label: 'TOPIX' }, { symbol: '1306.jp', label: 'TOPIX連動ETF（1306）' }] };
  if (/日経|225/.test(n)) return lev > 1
    ? { key: 'nkx2', label: '日経平均×2（日経レバ）', sources: [{ symbol: '1570.jp', label: 'NEXT FUNDS 日経レバ（1570）' }, { symbol: '^nkx', label: '日経平均×2', lev: 2 }] }
    : { key: 'nkx', label: '日経平均', sources: [{ symbol: '^nkx', label: '日経平均' }] };
  if (/金|ゴールド|GOLD|1540/i.test(n)) return { key: 'gold', label: '金（円建て）', sources: [{ symbol: '1540.jp', label: '純金上場信託（1540）' }, { symbol: 'xauusd', label: '金（ドル建て）', fx: true }] };
  return null;
}

/** date 以前で最後の値（無ければ null）。series は日付の昇順 */
export function valueAt(series: Dated[], date: string): number | null {
  let lo = 0, hi = series.length - 1, ans = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (series[mid].date <= date) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
  return ans >= 0 ? series[ans].close : null;
}

/** ドル建ての日足をドル円で円に換算する（その日以前で最後のレートを使う。レートが無い日は除く） */
export function toJpy(series: Dated[], usdjpy: Dated[]): Dated[] {
  const out: Dated[] = [];
  for (const p of series) { const fx = valueAt(usdjpy, p.date); if (fx != null) out.push({ date: p.date, close: p.close * fx }); }
  return out;
}

/** 日々の値動きを lev 倍して複利で積み上げた系列（先頭は元の値。2倍ブル型の作り方） */
export function leveraged(series: Dated[], lev: number): Dated[] {
  if (lev === 1 || series.length < 2) return series;
  const out: Dated[] = [{ ...series[0] }];
  for (let i = 1; i < series.length; i++) {
    const r = series[i].close / series[i - 1].close - 1;
    out.push({ date: series[i].date, close: Math.max(0, out[i - 1].close * (1 + lev * r)) });
  }
  return out;
}

/** 代用データ（取得した日足）を、銘柄の値動き（円）に組み立てる。fx（ドル→円）は先に換算してから倍率をかける */
export function buildProxySeries(raw: Dated[], src: ProxySource, usdjpy: Dated[] | null): Dated[] {
  let s = raw;
  if (src.fx) { if (!usdjpy?.length) return []; s = toJpy(s, usdjpy); }
  return leveraged(s, src.lev ?? 1);
}

/**
 * 値動き（騰落率%）の比較用：各系列を start 以降に切り出し、start（各系列の最初の日）を0%として並べる。
 * 戻り値は日付ごとの行 { date, [key]: % }（どれかの系列に値がある日すべて。値が無い系列は直前の値を引き継ぐ）
 */
export function performanceRows(series: Record<string, Dated[]>, start: string): Record<string, number | string>[] {
  const keys = Object.keys(series).filter((k) => series[k]?.length);
  const base: Record<string, number> = {};
  const dates = new Set<string>();
  for (const k of keys) {
    const s = series[k].filter((p) => p.date >= start);
    if (!s.length) continue;
    base[k] = s[0].close;
    for (const p of s) dates.add(p.date);
  }
  const rows: Record<string, number | string>[] = [];
  for (const d of [...dates].sort()) {
    const row: Record<string, number | string> = { date: d };
    for (const k of Object.keys(base)) {
      const v = valueAt(series[k], d);
      if (v != null && d >= series[k].find((p) => p.date >= start)!.date) row[k] = (v / base[k] - 1) * 100;
    }
    rows.push(row);
  }
  return rows;
}

/**
 * 評価額の積み上げ（銘柄別）の推移。
 * ・スクショの取り込み（snapshots）がある日：その日の銘柄ごとの評価額（実際の値）
 * ・それ以外の月（投資収支xlsxの月ごとの口座合計 totals がある日）：一番近いスクショの銘柄構成を、代用データの値動きで
 *   その日の値に動かし（口数は変わらないと仮定）、合計がその月の口座の評価額に一致するように比率を合わせた推計値
 * 戻り値は日付順の行 { date, estimated, total, [銘柄名]: 円 }
 */
export function stackedHoldingRows(
  snapshots: { date: string; items: Record<string, number> }[],
  totals: { date: string; value: number | null }[],
  priceOf: (name: string) => Dated[] | null,
  start: string,
): { rows: Record<string, number | string | boolean>[]; names: string[] } {
  const snaps = snapshots.filter((s) => s.date >= start).sort((a, b) => a.date.localeCompare(b.date));
  const names = [...new Set(snaps.flatMap((s) => Object.keys(s.items)))].sort();
  const rows: Record<string, number | string | boolean>[] = [];
  const snapMonths = new Set(snaps.map((s) => s.date.slice(0, 7)));
  for (const s of snaps) {
    const row: Record<string, number | string | boolean> = { date: s.date, estimated: false };
    let total = 0;
    for (const n of names) { const v = s.items[n] ?? 0; row[n] = v; total += v; }
    row.total = total;
    rows.push(row);
  }
  if (snaps.length) {
    for (const t of totals) {
      if (t.date < start || t.value == null || snapMonths.has(t.date.slice(0, 7))) continue;
      // 一番近いスクショ（前にあれば前、無ければ後）の構成を、値動きでその日に動かす
      const before = [...snaps].reverse().find((s) => s.date <= t.date);
      const ref = before ?? snaps[0];
      const est: Record<string, number> = {};
      let sum = 0;
      for (const n of names) {
        const v0 = ref.items[n] ?? 0;
        if (!v0) { est[n] = 0; continue; }
        const ps = priceOf(n);
        const p1 = ps ? valueAt(ps, t.date) : null, p0 = ps ? valueAt(ps, ref.date) : null;
        est[n] = p1 != null && p0 ? v0 * (p1 / p0) : v0;
        sum += est[n];
      }
      if (!(sum > 0)) continue;
      const k = t.value / sum;
      const row: Record<string, number | string | boolean> = { date: t.date, estimated: true, total: t.value };
      for (const n of names) row[n] = Math.round(est[n] * k);
      rows.push(row);
    }
  }
  rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return { rows, names };
}
