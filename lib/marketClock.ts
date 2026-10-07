// 米国市場（NYSE）の取引日カレンダーと「最新データが古くなったか」の判定。
// 最新データの日付の「翌取引日の開場時刻（米国東部 9:30）」を過ぎてもその日の分が入っていなければ未更新とみなす。
//   例：10/6（火）の終値まで入っている → 10/7（水）9:30 ET までは最新扱い、それ以降は未更新（グレーアウト）。
//       金曜の終値まで入っている → 翌週月曜（祝日なら火曜）9:30 ET まで最新扱い。
// 祝日はNYSEの休場日の規則から自動計算する（元日・キング牧師の日・大統領の日・聖金曜日・戦没者追悼記念日・
// ジューンティーンス（2022年〜）・独立記念日・労働者の日・感謝祭・クリスマス。土曜の祝日は前の金曜、日曜の祝日は翌月曜に振替）。
// このファイルは外部importを持たないため、`node --test` から直接実行できる。

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const isoOf = (d: Date) => d.toISOString().slice(0, 10);

// m月の第n週のweekday（0=日〜6=土）。n=-1は最終週
function nthWeekday(y: number, m: number, weekday: number, n: number): string {
  if (n > 0) {
    const first = utc(y, m, 1).getUTCDay();
    return ymd(y, m, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7);
  }
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const last = utc(y, m, lastDay).getUTCDay();
  return ymd(y, m, lastDay - ((last - weekday + 7) % 7));
}
// 土曜→前日（金）、日曜→翌日（月）に振替
function observed(y: number, m: number, d: number): string {
  const dt = utc(y, m, d), wd = dt.getUTCDay();
  if (wd === 6) dt.setUTCDate(d - 1);
  if (wd === 0) dt.setUTCDate(d + 1);
  return isoOf(dt);
}
// 復活祭（グレゴリオ暦、Anonymous Gregorian algorithm）
function easter(y: number): Date {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return utc(y, month, day);
}

const holidayCache = new Map<number, Set<string>>();
export function nyseHolidays(y: number): Set<string> {
  const cached = holidayCache.get(y);
  if (cached) return cached;
  const goodFriday = easter(y);
  goodFriday.setUTCDate(goodFriday.getUTCDate() - 2);
  const list = [
    observed(y, 1, 1),
    nthWeekday(y, 1, 1, 3), // キング牧師の日：1月第3月曜
    nthWeekday(y, 2, 1, 3), // 大統領の日：2月第3月曜
    isoOf(goodFriday),
    nthWeekday(y, 5, 1, -1), // 戦没者追悼記念日：5月最終月曜
    ...(y >= 2022 ? [observed(y, 6, 19)] : []),
    observed(y, 7, 4),
    nthWeekday(y, 9, 1, 1), // 労働者の日：9月第1月曜
    nthWeekday(y, 11, 4, 4), // 感謝祭：11月第4木曜
    observed(y, 12, 25),
  ];
  // 翌年の元日が土曜の場合、NYSEは前年12/31を振替休日にしない（年度末の決算のため）
  const set = new Set(list.filter((d) => d.startsWith(`${y}-`)));
  holidayCache.set(y, set);
  return set;
}

export function isTradingDay(iso: string): boolean {
  const [y, m, d] = iso.split("-").map(Number);
  const wd = utc(y, m, d).getUTCDay();
  return wd !== 0 && wd !== 6 && !nyseHolidays(y).has(iso);
}

export function nextTradingDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = utc(y, m, d);
  do dt.setUTCDate(dt.getUTCDate() + 1); while (!isTradingDay(isoOf(dt)));
  return isoOf(dt);
}

// 現在時刻の米国東部時間を "YYYY-MM-DD HH:MM"（24時間制）で返す
export function easternStamp(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

// lastIso（最新データの日付 YYYY-MM-DD）の翌取引日の開場（9:30 ET）を過ぎていれば true（＝未更新）
export function isStaleSince(lastIso: string, now: Date = new Date()): boolean {
  return easternStamp(now) >= `${nextTradingDay(lastIso)} 09:30`;
}
