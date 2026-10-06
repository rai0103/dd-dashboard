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

  // A. 時系列（日付行〜サマリー見出しの手前）。列は1行目の日付が空になる直前まで。
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
    const seriesRow = (prefix: string): number | null => {
      const r = findRowFrom(prefix, dateRow + 1, seriesEnd);
      if (r === null) errors.push(`${TOTAL_METRICS_SHEET}：時系列のラベル「${prefix}」が見つかりません。`);
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
    };
    const val = (r: number | null, c: number) => (r === null ? null : toNumber(cell(r, c)));
    for (const { c, date } of cols) {
      series.push({
        date, totalAssets: val(rowOf.totalAssets, c), principal: val(rowOf.principal, c), twrIndex: val(rowOf.twrIndex, c),
        cumulativeTwr: val(rowOf.cumulativeTwr, c), annualTwr: val(rowOf.annualTwr, c), annualXirr: val(rowOf.annualXirr, c), totalPnl: val(rowOf.totalPnl, c),
      });
    }
  }

  // B. 最新時点サマリー（見出しの下〜暦年別の見出し or 次の【】見出しの手前）。値はB列。
  const summary: TotalMetricsSummary = { latestDate: null, periodYears: null, totalAssets: null, principal: null, totalPnl: null, cumulativeTwr: null, annualTwr: null, annualXirr: null, annualModifiedDietz: null, simpleReturn: null };
  if (summaryHeader !== null) {
    let summaryEnd = n;
    for (let r = summaryHeader + 1; r < n; r++) if (labelAt(r).startsWith("【")) { summaryEnd = r; break; }
    const summaryRow = (prefix: string, required = true): number | null => {
      const r = findRowFrom(prefix, summaryHeader + 1, summaryEnd);
      if (r === null && required) errors.push(`${TOTAL_METRICS_SHEET}：最新時点サマリーのラベル「${prefix}」が見つかりません。`);
      return r;
    };
    const num = (prefix: string, required = true) => { const r = summaryRow(prefix, required); return r === null ? null : toNumber(cell(r, 1)); };
    const latestRow = summaryRow("最新日");
    summary.latestDate = latestRow === null ? null : toIsoDate(cell(latestRow, 1));
    summary.periodYears = num("運用期間（年）");
    summary.totalAssets = num("総資産");
    summary.principal = num("累計純入金（元本）");
    summary.totalPnl = num("累計損益（総資産−元本）");
    summary.cumulativeTwr = num("累積リターン（TWR）");
    summary.annualTwr = num("年率リターン（TWR");
    summary.annualXirr = num("年率リターン（XIRR");
    summary.annualModifiedDietz = num("年率リターン（修正ディーツ", false); // 参考（任意）
    summary.simpleReturn = num("（参考）単純損益率", false); // 参考（任意・非推奨）
    // 「（修正前の旧式…」の行は読み込まない（どの前方一致にも該当しない）
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

  return { metrics: { summary, series, calendarYears }, errors };
}

// 表示用：小数（0.2154）を%文字列にする。NaN・空は「—」。signed=trueなら正の値に「+」を付ける。
export function formatPct(v: number | null | undefined, digits = 1, signed = false): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const s = (v * 100).toFixed(digits);
  return `${signed && v > 0 ? "+" : ""}${s}%`;
}
