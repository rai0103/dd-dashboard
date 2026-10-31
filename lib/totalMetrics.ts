// 投資収支Excelの「TOTAL指標」シート（パフォーマンス指標の正本）の解析。
// Sheet1の53〜59行（TOTAL欄）の利回り・リターンは計算式の都合で指標としては使わず、このシートの値を採用する。
// シートは3つのセクションから成る：
//   A. 時系列（1行目が日付、B列以降が各時点。A列のラベル→行の用途）
//   B. 最新時点サマリー（A列ラベル・B列値。見出し「【最新時点サマリー】」の下）
//   C. 暦年別リターン（A列が「年」の見出し行の直下から、A列が数値の行まで。A=年・B=年末総資産・C=年間純入金・D=年間損益・E=年間リターン・F=備考）
// ラベルは行番号に依存せず前方一致で探す（「★運用成績そのもの」等の末尾は変わりうるため）。同じラベルが複数セクションに
// あるもの（総資産・（参考）単純損益率等）を取り違えないよう、検索は各セクションの範囲内に限定する。
// 見つからないラベルは握りつぶさず、どのラベルが無いかをerrorsで返す（アップロード画面にそのまま表示する）。
// 値はExcelのキャッシュ値（再計算済みの数値）を読む。リターンは小数で保持する（0.2154＝21.54%）。
// このファイルは外部importを持たないため、`node --test` から直接実行できる（シートは2次元配列で受け取る）。
//
// 設計上の注意（B・Cの値はA.時系列から導出する）：
// A.時系列（1〜24行目）は、列が増えるたびに日付の検出ロジック自体が自動的に伸びるため、ユーザーが新しい月の
// 列をシートに追加しさえすれば常に最新列を指す。一方、B.最新時点サマリー（26〜38行目）とC.暦年別リターンの
// 「今年（YTD）」の行は、固定セル・固定行の値のため、新しい列を追加した際にコピーし忘れると前月の値のまま
// 残ってしまう（実際にこの不具合が発生した）。そのためB・Cの値は、シートに書かれた値をそのまま信用せず、
// 常にA.時系列の最新列から計算し直す。B.最新時点サマリーの「最新日」欄・C.の過去の確定年の行は、ユーザーの
// 更新忘れを検知してお知らせするための突合せにのみ使う（表示される数値そのものには使わない）。

export const TOTAL_METRICS_SHEET = "TOTAL指標";

export interface TotalMetricsSummary {
  latestDate: string | null; // YYYY-MM-DD
  periodYears: number | null;
  totalAssets: number | null; // 円
  principal: number | null; // 累計純入金（元本）
  totalPnl: number | null; // 累計損益（総資産−元本）
  cumulativeTwr: number | null; // 累積リターン（TWR）。3.706＝+370.6%
  annualTwr: number | null; // 年率リターン（TWR）＝主指標
  annualXirr: number | null; // 年率リターン（XIRR）＝副指標
  annualModifiedDietz: number | null; // 年率リターン（修正ディーツ）＝参考
  simpleReturn: number | null; // （参考）単純損益率＝非推奨の参考値
}
export interface TotalMetricsPoint {
  date: string; // YYYY-MM-DD
  totalAssets: number | null;
  principal: number | null;
  twrIndex: number | null; // 開始=1.0
  cumulativeTwr: number | null;
  annualTwr: number | null;
  annualXirr: number | null;
  totalPnl: number | null;
  periodYears: number | null; // 経過年数（日数÷365.25）。summaryの運用期間はこの最新列の値を使う
  annualModifiedDietz: number | null; // 年率リターン（修正ディーツ・参考）。古いシートには無い場合がありnull
  simpleReturn: number | null; // （参考）単純損益率。古いシートには無い場合がありnull
}
export interface CalendarYearReturn {
  year: number;
  yearEndAssets: number | null;
  netDeposit: number | null;
  pnl: number | null;
  twr: number | null; // 年間リターン（TWR）
  note: string | null; // 備考（例：最新年は「YTD」）
}
export interface TotalMetrics {
  summary: TotalMetricsSummary;
  series: TotalMetricsPoint[];
  calendarYears: CalendarYearReturn[];
}
export type SheetRows = unknown[][]; // SheetJSの sheet_to_json(sheet, { header: 1, raw: true, defval: null, blankrows: true }) の形

// 全角/半角・空白の違いを吸収してから前方一致で比べる（例：「年率リターン（TWR」と「年率リターン(TWR・時間加重)★…」）。
const labelKey = (v: unknown) => String(v ?? "").normalize("NFKC").replace(/\s+/g, "");

// 数値セル：数値はそのまま、数値文字列（カンマ・%付き）は変換。空・エラー値（#N/A等）・NaNはnull。
export function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const s = v.replace(/[,¥\s]/g, "");
  if (s === "" || s === "-" || s === "—" || s.startsWith("#")) return null;
  const pct = s.endsWith("%");
  const n = parseFloat(pct ? s.slice(0, -1) : s);
  return Number.isFinite(n) ? (pct ? n / 100 : n) : null;
}
// 日付セル：Excelの日付シリアル値・Date・文字列（YYYY-MM-DD / YYYY/M/D）をYYYY-MM-DDにする。
export function toIsoDate(v: unknown): string | null {
  let d: Date | null = null;
  if (typeof v === "number" && Number.isFinite(v)) d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
  else if (v instanceof Date) d = new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()));
  else if (typeof v === "string") {
    const m = v.trim().match(/^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/);
    if (m) d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  }
  if (!d || Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  return y >= 1990 && y <= 2100 ? d.toISOString().slice(0, 10) : null;
}

// 暦年別リターンの「現在進行中の年（YTD）」の行を、シートの手打ちの値ではなくA.時系列の最新列から計算し直す。
// 前年末時点（series内の、その年の1/1より前の最後の点。無ければ運用開始＝資産0・TWR指数1.0を基準とする）を
// 起点に、年末資産・年間純入金・年間損益・年間TWR（TWR指数の比＝入出金の影響を受けない）を求める。
// 過去の確定年の行は対象にしない（このシートの値をそのまま信頼する）。
function recomputeYtdCalendarYearRow(series: TotalMetricsPoint[], existingNote: string | null): CalendarYearReturn | null {
  const last = series[series.length - 1];
  if (!last || last.totalAssets == null) return null;
  const year = Number(last.date.slice(0, 4));
  const prevYearEnd = [...series].reverse().find((p) => p.date <= `${year - 1}-12-31`) ?? null;
  const baseAssets = prevYearEnd?.totalAssets ?? 0;
  const basePrincipal = prevYearEnd?.principal ?? 0;
  const baseTwrIndex = prevYearEnd?.twrIndex ?? 1; // 運用開始年はTWR指数の基準（開始=1.0）をそのまま使う
  const netDeposit = last.principal != null ? last.principal - basePrincipal : null;
  const pnl = netDeposit != null ? last.totalAssets - baseAssets - netDeposit : null;
  const twr = last.twrIndex != null && baseTwrIndex ? last.twrIndex / baseTwrIndex - 1 : null;
  return { year, yearEndAssets: last.totalAssets, netDeposit, pnl, twr, note: existingNote ?? `${year}年は最新日までのYTD` };
}

export function parseTotalMetricsSheet(rows: SheetRows): { metrics: TotalMetrics; errors: string[] } {
  const errors: string[] = [];
  const cell = (r: number, c: number): unknown => rows[r]?.[c] ?? null;
  const labelAt = (r: number) => labelKey(cell(r, 0));
  const findRowFrom = (prefix: string, start: number, end: number): number | null => {
    const key = labelKey(prefix);
    for (let r = start; r < end; r++) if (labelAt(r).startsWith(key)) return r;
    return null;
  };
  const n = rows.length;

  // セクションの境界
  const dateRow = findRowFrom("日付", 0, n);
  const summaryHeader = findRowFrom("【最新時点サマリー】", 0, n);
  const yearHeader = (() => { for (let r = (summaryHeader ?? 0) + 1; r < n; r++) if (labelAt(r) === "年") return r; return null; })();
  if (dateRow === null) errors.push(`${TOTAL_METRICS_SHEET}：時系列の「日付」行が見つかりません。`);
  if (summaryHeader === null) errors.push(`${TOTAL_METRICS_SHEET}：見出し「【最新時点サマリー】」が見つかりません。`);
  if (yearHeader === null) errors.push(`${TOTAL_METRICS_SHEET}：暦年別リターンの見出し行（A列が「年」）が見つかりません。`);

  // A. 時系列（日付行〜サマリー見出しの手前）。列は1行目の日付が空になる直前まで（＝列が増えても自動的に追従する）。
  const series: TotalMetricsPoint[] = [];
  if (dateRow !== null) {
    const seriesEnd = summaryHeader ?? n;
    const cols: { c: number; date: string }[] = [];
    for (let c = 1; ; c++) {
      const date = toIsoDate(cell(dateRow, c));
      if (!date) break;
      cols.push({ c, date });
    }
    if (!cols.length) errors.push(`${TOTAL_METRICS_SHEET}：「日付」行に日付が見つかりません。`);
    const seriesRow = (prefix: string, required = true): number | null => {
      const r = findRowFrom(prefix, dateRow + 1, seriesEnd);
      if (r === null && required) errors.push(`${TOTAL_METRICS_SHEET}：時系列のラベル「${prefix}」が見つかりません。`);
      return r;
    };
    const rowOf = {
      totalAssets: seriesRow("総資産"),
      principal: seriesRow("累計純入金"),
      twrIndex: seriesRow("TWR指数"),
      cumulativeTwr: seriesRow("累積リターン（TWR"),
      annualTwr: seriesRow("年率リターン（TWR"),
      annualXirr: seriesRow("年率リターン（XIRR"),
      totalPnl: seriesRow("累計損益"),
      periodYears: seriesRow("経過年数"),
      annualModifiedDietz: seriesRow("年率リターン（修正ディーツ", false),
      simpleReturn: seriesRow("（参考）単純損益率", false),
    };
    const val = (r: number | null, c: number) => (r === null ? null : toNumber(cell(r, c)));
    for (const { c, date } of cols) {
      series.push({
        date, totalAssets: val(rowOf.totalAssets, c), principal: val(rowOf.principal, c), twrIndex: val(rowOf.twrIndex, c),
        cumulativeTwr: val(rowOf.cumulativeTwr, c), annualTwr: val(rowOf.annualTwr, c), annualXirr: val(rowOf.annualXirr, c), totalPnl: val(rowOf.totalPnl, c),
        periodYears: val(rowOf.periodYears, c), annualModifiedDietz: val(rowOf.annualModifiedDietz, c), simpleReturn: val(rowOf.simpleReturn, c),
      });
    }
  }

  // B. 最新時点サマリー：値はすべてA.時系列の最新列から取る（上の設計上の注意を参照）。
  const summary: TotalMetricsSummary = { latestDate: null, periodYears: null, totalAssets: null, principal: null, totalPnl: null, cumulativeTwr: null, annualTwr: null, annualXirr: null, annualModifiedDietz: null, simpleReturn: null };
  const lastPoint = series.length ? series[series.length - 1] : null;
  if (lastPoint) {
    summary.latestDate = lastPoint.date;
    summary.periodYears = lastPoint.periodYears;
    summary.totalAssets = lastPoint.totalAssets;
    summary.principal = lastPoint.principal;
    summary.totalPnl = lastPoint.totalPnl;
    summary.cumulativeTwr = lastPoint.cumulativeTwr;
    summary.annualTwr = lastPoint.annualTwr;
    summary.annualXirr = lastPoint.annualXirr;
    summary.annualModifiedDietz = lastPoint.annualModifiedDietz;
    summary.simpleReturn = lastPoint.simpleReturn;
  }
  if (summaryHeader !== null) {
    let summaryEnd = n;
    for (let r = summaryHeader + 1; r < n; r++) if (labelAt(r).startsWith("【")) { summaryEnd = r; break; }
    // 「最新日」欄は値としては使わないが、時系列の最新列と突合せて、シート側の更新忘れをお知らせする
    // （26〜38行目は固定セルのため、列を追加した際にコピーし忘れると前月の値のまま残ってしまう）。
    const latestRow = findRowFrom("最新日", summaryHeader + 1, summaryEnd);
    if (latestRow === null) {
      errors.push(`${TOTAL_METRICS_SHEET}：最新時点サマリーのラベル「最新日」が見つかりません。`);
    } else {
      const summaryLatestDate = toIsoDate(cell(latestRow, 1));
      if (summaryLatestDate && lastPoint && summaryLatestDate !== lastPoint.date) {
        errors.push(`${TOTAL_METRICS_SHEET}：【最新時点サマリー】欄の「最新日」（${summaryLatestDate}）が時系列の最新列（${lastPoint.date}）と異なります。表示の数値には時系列側の最新列の値を使用しているため、この欄（26〜38行目）の更新を忘れても問題ありません。`);
      }
    }
  }

  // C. 暦年別リターン（見出し「年」の直下から、A列が数値（年）の間）。G列以降（計算用）は無視。
  const calendarYears: CalendarYearReturn[] = [];
  if (yearHeader !== null) {
    for (let r = yearHeader + 1; r < n; r++) {
      const year = toNumber(cell(r, 0));
      if (year === null || !Number.isInteger(year)) break;
      const note = cell(r, 5);
      calendarYears.push({ year, yearEndAssets: toNumber(cell(r, 1)), netDeposit: toNumber(cell(r, 2)), pnl: toNumber(cell(r, 3)), twr: toNumber(cell(r, 4)), note: note == null || note === "" ? null : String(note) });
    }
    if (!calendarYears.length) errors.push(`${TOTAL_METRICS_SHEET}：暦年別リターンのデータ行が見つかりません。`);
  }
  // 今年（進行中の年）の行は、シートの固定値ではなく時系列の最新列から計算し直す（上の設計上の注意を参照）。
  // 既存の行が前月のまま残っている（＝最新列と総資産が一致しない）場合は上書きし、
  // 年が変わったのに行自体が無い（年末更新時に追加し忘れた）場合は新しい行を追加する。
  if (lastPoint && lastPoint.totalAssets != null) {
    const latestYear = Number(lastPoint.date.slice(0, 4));
    const lastRow = calendarYears.length ? calendarYears[calendarYears.length - 1] : null;
    const stale = !!lastRow && lastRow.year === latestYear && lastRow.yearEndAssets !== lastPoint.totalAssets;
    const missing = !lastRow || lastRow.year < latestYear;
    if (stale || missing) {
      const recomputed = recomputeYtdCalendarYearRow(series, stale ? lastRow!.note : null);
      if (recomputed) {
        errors.push(`${TOTAL_METRICS_SHEET}：【暦年別リターン】の${latestYear}年の行がシートに記載の値のまま更新されていなかったため、時系列の最新列（${lastPoint.date}）から計算し直した値を使用しています。列を追加した際にこの行の更新を忘れても、次回以降は自動的に補われます。`);
        if (stale) calendarYears[calendarYears.length - 1] = recomputed;
        else calendarYears.push(recomputed);
      }
    }
  }

  return { metrics: { summary, series, calendarYears }, errors };
}

// 表示用：小数（0.2154）を%文字列にする。NaN・空は「—」。signed=trueなら正の値に「+」を付ける。
export function formatPct(v: number | null | undefined, digits = 1, signed = false): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const s = (v * 100).toFixed(digits);
  return `${signed && v > 0 ? "+" : ""}${s}%`;
}

// 暦年ごとの元本投入額（入金−出金の純額）＝その年の最後の時点の累計純入金 − 前年の最後の時点の累計純入金。
// 前年以前に時点が無い年（運用開始年）は0円を起点とする。その年に累計純入金のある時点が無ければnull。
export function calendarYearPrincipalChanges(series: TotalMetricsPoint[], years: number[]): Map<number, number | null> {
  const pts = series.filter((p) => p.principal != null).sort((a, b) => a.date.localeCompare(b.date));
  const lastUpTo = (year: number) => { let v: number | null = null; for (const p of pts) { if (Number(p.date.slice(0, 4)) <= year) v = p.principal; else break; } return v; };
  const out = new Map<number, number | null>();
  for (const y of years) {
    const hasPoint = pts.some((p) => Number(p.date.slice(0, 4)) === y);
    out.set(y, hasPoint ? (lastUpTo(y) as number) - (lastUpTo(y - 1) ?? 0) : null);
  }
  return out;
}

// 価格系列（VOO換算）の暦年TWR＝年末終値 ÷ 前年末終値 − 1（入出金の無い単一銘柄なので、日次リターンの連鎖＝始点と終点の比）。
// endIso（YYYY-MM-DD）を渡すと、その日までで打ち切る（最新年をポートフォリオの最新日に揃えたYTDにするため）。
// 前年末・その年の終値のどちらかが系列に無ければnull。
export function calendarYearPriceTwr(prices: { date: Date; price: number }[], years: number[], endIso: string | null = null): Map<number, number | null> {
  const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const pts = prices.filter((p) => p && Number.isFinite(p.price) && p.price > 0).map((p) => ({ iso: isoOf(p.date), price: p.price })).sort((a, b) => a.iso.localeCompare(b.iso));
  const lastOnOrBefore = (iso: string) => { let v: number | null = null; for (const p of pts) { if (p.iso <= iso) v = p.price; else break; } return v; };
  const out = new Map<number, number | null>();
  for (const y of years) {
    const start = lastOnOrBefore(`${y - 1}-12-31`);
    const endLimit = endIso && endIso < `${y}-12-31` ? endIso : `${y}-12-31`;
    const hasPointInYear = pts.some((p) => p.iso >= `${y}-01-01` && p.iso <= endLimit);
    const end = hasPointInYear ? lastOnOrBefore(endLimit) : null;
    out.set(y, start != null && end != null ? end / start - 1 : null);
  }
  return out;
}

// 暦年ごとのMDD＝その年単独・年初来高値基準（年をまたいでリセット）で、TWR指数（twrIndex。入出金の影響を除いた運用指数）の
// 最大下落率。年初の最初の時点を高値の起点とするため、その年の最初の時点のMDDは必ず0。マイナスの小数で返す（-0.123＝-12.3%）。
// その年にtwrIndexのある時点が1つも無ければnull。
export function calendarYearTwrMdd(series: TotalMetricsPoint[], years: number[]): Map<number, number | null> {
  const pts = series.filter((p) => p.twrIndex != null).sort((a, b) => a.date.localeCompare(b.date));
  const out = new Map<number, number | null>();
  for (const y of years) {
    const yearPts = pts.filter((p) => Number(p.date.slice(0, 4)) === y);
    if (!yearPts.length) { out.set(y, null); continue; }
    let high = -Infinity, mdd = 0;
    for (const p of yearPts) {
      const v = p.twrIndex as number;
      if (v > high) high = v;
      const dd = v / high - 1;
      if (dd < mdd) mdd = dd;
    }
    out.set(y, mdd);
  }
  return out;
}
