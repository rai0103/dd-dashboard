// SP500の「年比較」：特定の過去年（1〜12月）の値動きを、今年（途中経過）と重ねて比較するための計算。
// ・横軸は年内の経過日（1月1日＝1の通算日。データは営業日のみで、休場日は線をつなぐ）。
// ・評価額（index）：各年の年初時点＝前年最終営業日の終値を100とした指数（前年データが無い年は年初の最初の終値＝100）。
// ・DD（dd）：各年の年初来高値（その年の終値の最高値）からの下落率（%、0以下）。通常のDD計算と同じく終値ベース。
// ・比較の対象は「トラックレコードのある年」＝1月上旬〜12月下旬まで揃っている確定年（データ開始年の途中から・今年は除く）。
// このファイルは外部importを持たないため、`node --test` から直接実行できる。

export type YearMetric = "index" | "dd";
export interface YearPoint { doy: number; date: string; index: number; dd: number }
export type YearSeries = Map<number, YearPoint[]>;

const dayOfYear = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86400000) + 1;
};
const toIso = (d: Date | string) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

export function buildYearSeries(points: { date: Date | string; price: number }[]): YearSeries {
  const byDate = new Map<string, number>();
  for (const p of points) if (Number.isFinite(p.price) && p.price > 0) byDate.set(toIso(p.date), p.price);
  const sorted = [...byDate].sort((a, b) => a[0].localeCompare(b[0]));
  const out: YearSeries = new Map();
  let prevYear = -1, prevYearLast: number | null = null, curYear = -1, base = 0, high = 0, lastPrice = 0;
  let list: YearPoint[] = [];
  for (const [date, price] of sorted) {
    const y = Number(date.slice(0, 4));
    if (y !== curYear) {
      if (list.length) { out.set(curYear, list); prevYear = curYear; prevYearLast = lastPrice; }
      // 前年のデータが連続してある場合だけ前年最終値を年初の基準にする（データの空白をまたいだ年は自年の最初の終値を基準にする）
      base = prevYearLast !== null && prevYear === y - 1 ? prevYearLast : price;
      curYear = y; high = price; list = [];
    }
    high = Math.max(high, price);
    lastPrice = price;
    list.push({ doy: dayOfYear(date), date, index: (price / base) * 100, dd: (price / high - 1) * 100 });
  }
  if (list.length) out.set(curYear, list);
  return out;
}

// 確定年（比較対象になる年）：1月10日までに始まり12月20日以降まである年。今年（currentYear）は除く。
export function completeYears(series: YearSeries, currentYear: number): number[] {
  return [...series.entries()]
    .filter(([y, pts]) => y !== currentYear && pts.length > 0 && pts[0].doy <= 10 && pts[pts.length - 1].doy >= 354)
    .map(([y]) => y).sort((a, b) => a - b);
}

// 米大統領の任期年：選挙は4年ごと（2024, 2020, …）。year % 4 → 0:任期4年目（選挙年）, 1:1年目, 2:2年目（中間選挙年）, 3:3年目。
export function presidentialTermYear(year: number): 1 | 2 | 3 | 4 {
  const r = ((year % 4) + 4) % 4;
  return (r === 0 ? 4 : r) as 1 | 2 | 3 | 4;
}

export type YearPresetKey = "election" | "term1" | "midterm" | "term3" | "recent10" | "similar10" | "from10" | "around10";
export const YEAR_PRESETS: { key: YearPresetKey; label: string; needsYear: boolean }[] = [
  { key: "election", label: "大統領選挙年（任期4年目）", needsYear: false },
  { key: "term1", label: "大統領任期1年目", needsYear: false },
  { key: "midterm", label: "中間選挙年（任期2年目）", needsYear: false },
  { key: "term3", label: "大統領任期3年目", needsYear: false },
  { key: "recent10", label: "直近10年", needsYear: false },
  { key: "similar10", label: "現在と類似した10年（自動抽出）", needsYear: false },
  { key: "from10", label: "指定した年から10年", needsYear: true },
  { key: "around10", label: "指定した年の前後10年", needsYear: true },
];

// 現在と類似した年の自動抽出（将来の調整はこの関数と SIMILAR_* 定数で行う）：
//   1. 今年の各営業日（1月1日〜最新日）について、比較年の「同じ通算日以前で最も近い営業日」の値を取り出して並べる
//      （値は評価額チャートなら年初=100の指数＝年初来騰落率、DDチャートなら年初来高値からの下落率）。
//   2. 今年の系列との RMSE（二乗平均平方根誤差、%ポイント）を計算し、小さい順（＝水準も形も近い順）に並べる。
//      RMSEの差が SIMILAR_TIE_EPS 以内なら、相関係数（形の似方）が高い方を上位にする。
//   3. 上位 n 年を返す。今年のデータが SIMILAR_MIN_POINTS 営業日未満なら判定しない（空配列）。
export const SIMILAR_MIN_POINTS = 5;
export const SIMILAR_TIE_EPS = 0.05;
function valueAt(pts: YearPoint[], doy: number, metric: YearMetric): number {
  let v = pts[0][metric];
  for (const p of pts) { if (p.doy > doy) break; v = p[metric]; }
  return v;
}
function correlation(a: number[], b: number[]): number {
  const n = a.length, ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}
export function rankSimilarYears(series: YearSeries, currentYear: number, candidates: number[], metric: YearMetric, n = 10): { year: number; rmse: number; corr: number }[] {
  const cur = series.get(currentYear);
  if (!cur || cur.length < SIMILAR_MIN_POINTS) return [];
  const target = cur.map((p) => p[metric]);
  return candidates
    .filter((y) => series.get(y)?.length)
    .map((y) => {
      const pts = series.get(y)!;
      const other = cur.map((p) => valueAt(pts, p.doy, metric));
      const rmse = Math.sqrt(other.reduce((s, v, i) => s + (v - target[i]) ** 2, 0) / other.length);
      return { year: y, rmse, corr: correlation(target, other) };
    })
    .sort((a, b) => (Math.abs(a.rmse - b.rmse) > SIMILAR_TIE_EPS ? a.rmse - b.rmse : b.corr - a.corr))
    .slice(0, n);
}

// プリセットから比較年を選ぶ（確定年の範囲に限る）。note：入力年がデータ範囲外・範囲を縮めた等の補足。
export function selectCompareYears(preset: YearPresetKey, opts: { series: YearSeries; currentYear: number; metric: YearMetric; inputYear?: number | null }): { years: number[]; note: string | null } {
  const years = completeYears(opts.series, opts.currentYear);
  if (!years.length) return { years: [], note: "比較できる確定年のデータがありません。" };
  const first = years[0], last = years[years.length - 1];
  const inRange = (from: number, to: number) => years.filter((y) => y >= from && y <= to);
  switch (preset) {
    case "election": return { years: years.filter((y) => presidentialTermYear(y) === 4), note: null };
    case "term1": return { years: years.filter((y) => presidentialTermYear(y) === 1), note: null };
    case "midterm": return { years: years.filter((y) => presidentialTermYear(y) === 2), note: null };
    case "term3": return { years: years.filter((y) => presidentialTermYear(y) === 3), note: null };
    case "recent10": return { years: years.slice(-10), note: null };
    case "similar10": {
      const ranked = rankSimilarYears(opts.series, opts.currentYear, years, opts.metric, 10);
      return ranked.length ? { years: ranked.map((r) => r.year).sort((a, b) => a - b), note: null } : { years: [], note: `今年のデータが${SIMILAR_MIN_POINTS}営業日未満のため、類似年を判定できません。` };
    }
    case "from10":
    case "around10": {
      const x = opts.inputYear;
      if (x == null || !Number.isInteger(x)) return { years: [], note: "年を入力してください。" };
      if (x < first || x > last) return { years: [], note: `${first}〜${last}年の範囲で入力してください。` };
      const [from, to] = preset === "from10" ? [x, x + 9] : [x - 5, x + 4]; // 前後10年＝前5年＋入力年＋後4年（計10年）
      const picked = inRange(from, to);
      const note = picked.length < 10 ? `データのある範囲に合わせて${picked[0]}〜${picked[picked.length - 1]}年（${picked.length}年）に縮めました。` : null;
      return { years: picked, note };
    }
  }
}

// ---------------- 年ごとのパフォーマンス（拡大表示の一覧表用） ----------------
// points は全期間の日次データ（dd＝既存ダッシュボードと同じ「過去最高値（ATH）からの下落率%」。d.FULL をそのまま渡す）。
// ATH更新・DD-3%は年ごとにリセットせず、データが存在する全期間を通しで見て「その年に発生した事象」だけを数える。
//   騰落率：年初（前年最終営業日の終値、前年データが無ければその年の最初の終値）→ その年の最終営業日（今年は最新日）の終値
//   MDD：その年の dd（史上最高値からの下落率）の最小値（既存の期間統計 computePeriodStats の maxDD と同じ定義）
//   ATH更新回数：その日の終値が、それまでの全期間の最高値（史上最高値）を上回った日数。下落局面が続き史上最高値を更新できない年は0回。
//   DD-3%以上の回数（2種類。どちらも「−3%ラインの単純な上下動」では増やさない）：
//     通期 dd3Count：史上最高値（全期間）から −3% 以下に入った時点から、次に史上最高値を更新するまでを1つの下落局面として1回。
//       局面中に −3% を一時的に上回って再び下回っても数えない。前年から続く局面は年をまたいでも数えない（局面が始まった年に1回）。
//     年内 dd3CountYtd：同じ考え方を、その年の年初来高値（その年の終値の最高値）を基準に適用する。年内の高値を更新するまでを
//       1つの局面として1回。年が変わると基準（年初来高値）も局面もリセットする。
//   年初来ATH更新回数 athCountToDate：cutoffMD（"MM-DD"、例：今年の最新日 "10-06"）以前の日付だけで数えたATH更新回数
//     （進行中の今年と過去の各年を、1月1日〜同じ月日の同じ期間で比べるため）。
//   年度（その年単独・年初来高値基準）athCountYear／mddYear：その年の終値の最高値（年初来高値）を基準にした、年内の高値更新日数と最大下落率
//     （年初の最初の終値を起点とし、初日は更新に数えない）。dd3CountYtd と同じく年ごとにリセットする。
export interface YearStats { year: number; lastDate: string; returnPct: number; mdd: number; athCount: number; athCountToDate: number; dd3Count: number; athCountYear: number; mddYear: number; dd3CountYtd: number }
export function computeYearStats(points: { date: Date | string; price: number; dd?: number }[], years: number[], cutoffMD: string | null = null): Map<number, YearStats> {
  const want = new Set(years);
  const sorted = points.map((p) => ({ date: toIso(p.date), price: p.price })).filter((p) => Number.isFinite(p.price) && p.price > 0).sort((a, b) => a.date.localeCompare(b.date));
  const acc = new Map<number, { first: number; last: number; lastDate: string; prevYearLast: number | null; mdd: number; athCount: number; athCountToDate: number; dd3Count: number; athCountYear: number; mddYear: number; dd3CountYtd: number }>();
  let ath = -Infinity, inDD = false, prevPrice: number | null = null, prevYear: number | null = null;
  let ytdHigh = -Infinity, inDDYtd = false;
  for (const p of sorted) {
    const y = Number(p.date.slice(0, 4));
    if (!acc.has(y)) {
      acc.set(y, { first: p.price, last: p.price, lastDate: p.date, prevYearLast: prevYear === y - 1 ? prevPrice : null, mdd: 0, athCount: 0, athCountToDate: 0, dd3Count: 0, athCountYear: 0, mddYear: 0, dd3CountYtd: 0 });
      ytdHigh = -Infinity; inDDYtd = false; // 年内の基準と局面は年ごとにリセット
    }
    const a = acc.get(y)!;
    // 通期：史上最高値を更新したら局面終了。−3%以下に入ったら（局面中でなければ）新規1回
    const isNewAth = p.price > ath && ath !== -Infinity; // データ先頭の1日は比較対象が無いので更新に数えない
    if (p.price > ath) { ath = p.price; inDD = false; }
    const dd = (p.price / ath - 1) * 100;
    if (isNewAth) { a.athCount++; if (cutoffMD === null || p.date.slice(5) <= cutoffMD) a.athCountToDate++; }
    if (dd <= -3 && !inDD) { a.dd3Count++; inDD = true; }
    // 年内：年初来高値を更新したら局面終了。−3%以下に入ったら（局面中でなければ）新規1回
    if (p.price > ytdHigh) { if (ytdHigh !== -Infinity) a.athCountYear++; ytdHigh = p.price; inDDYtd = false; }
    const ddYtd = (p.price / ytdHigh - 1) * 100;
    a.mddYear = Math.min(a.mddYear, ddYtd);
    if (ddYtd <= -3 && !inDDYtd) { a.dd3CountYtd++; inDDYtd = true; }
    a.mdd = Math.min(a.mdd, dd);
    a.last = p.price; a.lastDate = p.date;
    prevPrice = p.price; prevYear = y;
  }
  const out = new Map<number, YearStats>();
  for (const y of want) {
    const a = acc.get(y);
    if (!a) continue;
    const base = a.prevYearLast ?? a.first;
    out.set(y, { year: y, lastDate: a.lastDate, returnPct: (a.last / base - 1) * 100, mdd: a.mdd, athCount: a.athCount, athCountToDate: a.athCountToDate, dd3Count: a.dd3Count, athCountYear: a.athCountYear, mddYear: a.mddYear, dd3CountYtd: a.dd3CountYtd });
  }
  return out;
}

// チェックした年の平均（一覧表の最下行）。値が無い場合はnull。
export function averageYearStats(stats: YearStats[]): Record<"returnPct" | "athCountYear" | "mddYear" | "dd3CountYtd" | "athCount" | "mdd" | "dd3Count", number> | null {
  if (!stats.length) return null;
  const avg = (k: keyof YearStats) => stats.reduce((sum, s) => sum + (s[k] as number), 0) / stats.length;
  return { returnPct: avg("returnPct"), athCountYear: avg("athCountYear"), mddYear: avg("mddYear"), dd3CountYtd: avg("dd3CountYtd"), athCount: avg("athCount"), mdd: avg("mdd"), dd3Count: avg("dd3Count") };
}

// 一覧表の並び替え。key は "year" または YearStats の数値列（騰落率・年度/通期のATH・MDD・DD-3%）。
// 値が無い年（統計を出せない年）は向きに関係なく末尾に置き、同じ値の年は新しい年を上にする（表示順が毎回同じになるように）。
export type YearSortKey = "year" | "returnPct" | "athCountYear" | "mddYear" | "dd3CountYtd" | "athCount" | "mdd" | "dd3Count";
export function sortYearsBy(years: number[], stats: Map<number, YearStats>, key: YearSortKey, dir: "asc" | "desc"): number[] {
  const sign = dir === "asc" ? 1 : -1;
  const val = (y: number): number | null => {
    if (key === "year") return y;
    const v = stats.get(y)?.[key];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  return [...years].sort((a, b) => {
    const va = val(a), vb = val(b);
    if (va == null || vb == null) return va == null && vb == null ? b - a : va == null ? 1 : -1;
    return va !== vb ? (va - vb) * sign : b - a;
  });
}
