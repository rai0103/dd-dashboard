// 日経平均株価（^NKX）の系列：バンドル済みの日次終値（lib/nkxData.ts、1949/5/16〜）＋ 起動時にWorker経由でStooqから
// 追加取得した日々の終値（IndexedDB "nikkei_price_history"、端末間で同期）をつなぐ。テスト：lib/nkxSeries.test.ts
import type { DatedPrice } from "./sp500Synthetic.ts";
import { NKX_CSV, NKX_BUNDLE_LAST } from "./nkxData.ts";

/** 日次データとして使う最初の日（東京証券取引所の戦後再開日。これより前のStooqの値は3か月ごとのため使わない） */
export const NKX_START = "1949-05-16";
export { NKX_BUNDLE_LAST };

const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
export const isoOf = (d: Date) => d.toISOString().slice(0, 10);

/** バンドル済みの「YYYY-MM-DD,終値」をDatedPrice[]にする */
export function parseNkxBundle(csv: string = NKX_CSV): DatedPrice[] {
  const out: DatedPrice[] = [];
  for (const line of csv.split("\n")) {
    const k = line.indexOf(",");
    if (k < 0) continue;
    const price = Number(line.slice(k + 1));
    if (price > 0) out.push({ date: toDate(line.slice(0, k)), price });
  }
  return out;
}

/** StooqのCSV（Date,Open,High,Low,Close,Volume）から、1949/5/16以降の終値を取り出す（日付昇順・同じ日は後勝ち） */
export function parseStooqDaily(text: string): DatedPrice[] {
  const lines = text.replace(/^﻿/, "").trim().split(/\r?\n/);
  if (!lines.length) return [];
  const head = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const di = head.findIndex((h) => h === "date" || h === "日付");
  const ci = head.findIndex((h) => h === "close" || h === "終値");
  if (di < 0 || ci < 0) return [];
  const map = new Map<string, number>();
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(",");
    const m = String(c[di] || "").trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    const v = Number(String(c[ci] || "").trim());
    if (!m || !(v > 0)) continue;
    const iso = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    if (iso >= NKX_START) map.set(iso, v);
  }
  return [...map.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([d, v]) => ({ date: toDate(d), price: v }));
}

/** バンドル＋保存済み（追加取得分）をつなぐ。同じ日は保存済みの値を優先し、1949/5/16より前は除く */
export function mergeNkx(bundle: DatedPrice[], stored: DatedPrice[]): DatedPrice[] {
  const map = new Map<string, number>();
  for (const p of bundle) map.set(isoOf(p.date), p.price);
  for (const p of stored) map.set(isoOf(p.date), p.price);
  return [...map.entries()].filter(([d]) => d >= NKX_START).sort(([a], [b]) => (a < b ? -1 : 1)).map(([d, v]) => ({ date: toDate(d), price: v }));
}

/** 保存用：バンドルの最終日より後の分だけを [{date:"YYYY-MM-DD", price}] にする（バンドルと同じ値は保存しない） */
export function nkxStoredRows(series: DatedPrice[]): { date: string; price: number }[] {
  return series.filter((p) => isoOf(p.date) > NKX_BUNDLE_LAST).map((p) => ({ date: isoOf(p.date), price: p.price }));
}

/** 次に取得し始める日（最終日の翌日） */
export function nkxNextStart(series: DatedPrice[]): string {
  const last = series.length ? series[series.length - 1].date : toDate(NKX_BUNDLE_LAST);
  return isoOf(new Date(last.getTime() + 86400000));
}

// ---- 東京市場の「未更新」判定（米国市場の isStaleSince と同じ考え方。祝日は考慮せず、土日だけ飛ばす） ----
/** 東京時間の "YYYY-MM-DD HH:MM" */
export function tokyoStamp(now: Date): string {
  const t = new Date(now.getTime() + 9 * 3600000);
  return `${t.toISOString().slice(0, 10)} ${t.toISOString().slice(11, 16)}`;
}
function nextWeekday(iso: string): string {
  let d = toDate(iso);
  do { d = new Date(d.getTime() + 86400000); } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return isoOf(d);
}
/** 最新データの翌営業日（土日を除く）の大引けからStooqに反映されるまでの余裕を見て18:00（JST）を過ぎても次の終値が無ければ true（＝未更新） */
export function isStaleSinceTokyo(lastIso: string, now: Date = new Date()): boolean {
  return tokyoStamp(now) >= `${nextWeekday(lastIso)} 18:00`;
}
