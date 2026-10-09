// GET /api/market-summary の計算ロジック（純粋関数）と、Twelve Data time_series の取得。
// 比較の定義（基準日は「その日以前で最も近い取引日」）:
//   前日比 = 直前の取引日 / 前週比 = 7日前 / 前月比 = 1か月前 / 前年比 = 1年前
// 取引日の判定は、Twelve Dataの日足（取引日のみ）の並びをそのまま使う。

export type Close = { date: string; close: number }; // date: YYYY-MM-DD, 昇順
export type Changes = { close: number; d1: number | null; w1: number | null; m1: number | null; y1: number | null };

const pct = (now: number, base: number | undefined): number | null =>
  base == null || base === 0 ? null : Math.round(((now / base) - 1) * 10000) / 100;

// 指定日（YYYY-MM-DD）以前で最も近い取引日の終値を返す（series は昇順）
export function closeOnOrBefore(series: Close[], ymd: string): number | undefined {
  let lo = 0, hi = series.length - 1, found: number | undefined;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid].date <= ymd) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found === undefined ? undefined : series[found].close;
}

// 日付を n 日前（UTC基準の暦日）の YYYY-MM-DD にする
export function shiftDays(ymd: string, days: number): string {
  const d = new Date(ymd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}
// 月末の繰り上がりを防ぐ（例: 3/31の1か月前は2/28）
export function shiftMonths(ymd: string, months: number): string {
  const [y, m, day] = ymd.split("-").map(Number);
  const total = y * 12 + (m - 1) - months;
  const ty = Math.floor(total / 12), tm = total % 12;
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  const d = new Date(Date.UTC(ty, tm, Math.min(day, lastDay)));
  return d.toISOString().slice(0, 10);
}

// 直近の取引日（series の末尾）を基準に、各期間の騰落率を計算する
export function computeChanges(series: Close[]): Changes | null {
  if (series.length < 2) return null;
  const last = series[series.length - 1];
  // 前日比は「末尾の1つ前の取引日」。日付ベースの他の期間と揃えるため、末尾の直前の値を使う
  const prev = series[series.length - 2].close;
  return {
    close: last.close,
    d1: pct(last.close, prev),
    w1: pct(last.close, closeOnOrBefore(series, shiftDays(last.date, 7))),
    m1: pct(last.close, closeOnOrBefore(series, shiftMonths(last.date, 1))),
    y1: pct(last.close, closeOnOrBefore(series, shiftMonths(last.date, 12))),
  };
}

// Twelve Data time_series（日足・昇順）を取得して Close[] にする。土日の重複行は除く。
export async function fetchDailyCloses(symbol: string, apiKey: string, startDate: string, fetchImpl: typeof fetch = fetch): Promise<Close[]> {
  const params = new URLSearchParams({ symbol, interval: "1day", order: "ASC", start_date: startDate, apikey: apiKey });
  const res = await fetchImpl(`https://api.twelvedata.com/time_series?${params}`);
  if (!res.ok) throw new Error(`twelvedata ${symbol} HTTP ${res.status}`);
  const data = (await res.json()) as { status?: string; message?: string; values?: { datetime: string; close: string }[] };
  if (data.status !== "ok" || !Array.isArray(data.values)) throw new Error(`${symbol}: ${data.message ?? "no values"}`);
  const byDate = new Map<string, number>();
  for (const v of data.values) {
    const date = v.datetime.slice(0, 10), close = parseFloat(v.close);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(close)) byDate.set(date, close);
  }
  return [...byDate].map(([date, close]) => ({ date, close })).sort((a, b) => a.date.localeCompare(b.date));
}
