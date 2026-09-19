// 投資収支Excel（ユーザーが毎月月末に手動集計しているファイル）のアップロード・解析。
// 既存のSP500/QQQトラックレコードCSV機能とは完全に独立したデータソース（統合しない）。
//
// パース方針：シートの行番号はユーザーの将来の編集で変わりうるため、行番号にはハードコードで依存せず、
// A列（先頭列）のラベル文字列を都度検索して該当行を特定する。見つからないラベルはエラーとして収集し、
// 呼び出し側（アップロードUI）でユーザーにそのまま提示する（握りつぶさない）。
//
// xlsx（SheetJS）は月1回のアップロード時にしか使わない重いライブラリのため、静的importでは取り込まず、
// parseInvestmentExcel内で動的importする（通常のダッシュボード表示時のバンドルサイズに含めないため）。
import type * as XLSXType from "xlsx";

export interface InvestmentSeriesPoint {
  date: string; // YYYY-MM-DD
  periodYears: number | null;
  totalAssets: number | null;
  principal: number | null;
  realizedReturn: number | null;
  realizedYield: number | null; // %表記（例：8.5 = 8.5%）
  totalReturn: number | null;
  totalYield: number | null; // %表記
}
export interface InvestmentAccountPoint {
  date: string;
  accounts: Record<string, number | null>;
}
export interface InvestmentMonthlyPoint {
  date: string;
  prevMonthTotal: number | null;
  monthPerformance: number | null;
  withdrawal: number | null;
  excessReturn: number | null;
  bonusReserve: number | null;
}
export interface InvestmentPerformanceData {
  series: InvestmentSeriesPoint[];
  accountSeries: InvestmentAccountPoint[];
  accountRecentChange: Record<string, { monthChange: number | null; yearEndChange: number | null }>;
  monthlySeries: InvestmentMonthlyPoint[];
  errors: string[];
  sourceFileName: string;
  parsedAt: string;
}

const ACCOUNT_LABELS = ["楽天証券（私＋妻）", "moomoo証券", "大和コネクト証券", "Coin Check", "iDeCo"];
const SHEET_NAME = "Sheet1";

// 全角スペース・タブ・連続する空白を正規化してから比較する（Excel側の些細な編集で解析が壊れるのを防ぐ）。
function normalizeLabel(s: unknown): string {
  return String(s ?? "").replace(/[　\t]+/g, " ").replace(/\s+/g, " ").trim();
}
function cellToString(cell: XLSXType.CellObject | undefined): string {
  if (!cell) return "";
  if (typeof cell.w === "string" && cell.w.trim() !== "") return cell.w;
  if (cell.v == null) return "";
  return String(cell.v);
}
// Excelのシリアル値・日付型セル・文字列（YYYY-MM-DD/YYYY/MM/DD/YYYY年MM月DD日等）のいずれでも日付に変換する。
function excelCellToDate(XLSX: typeof XLSXType, cell: XLSXType.CellObject | undefined): Date | null {
  if (!cell || cell.v == null || cell.v === "") return null;
  let d: Date | null = null;
  if (cell.t === "d") {
    d = cell.v instanceof Date ? cell.v : new Date(cell.v as any);
  } else if (cell.t === "n") {
    const parsed = XLSX.SSF.parse_date_code(cell.v as number);
    if (parsed) d = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
  } else if (cell.t === "s") {
    const s = String(cell.v).trim();
    const m = s.match(/^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/);
    if (m) d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  }
  if (!d || Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  if (y < 1990 || y > 2100) return null; // 集計列（前月比等）の数値を誤って日付と解釈しないための健全性チェック
  return d;
}
// 金額セル：カンマ区切り・通貨記号混じりでも頑健にパースする。
function parseNumericCell(cell: XLSXType.CellObject | undefined): number | null {
  if (!cell || cell.v == null || cell.v === "") return null;
  if (typeof cell.v === "number") return cell.v;
  const s = String(cell.v).replace(/[,¥$%\s]/g, "");
  if (s === "" || s === "-" || s === "—") return null;
  const n = parseFloat(s);
  return Number.isNaN(n) ? null : n;
}
// 利回りセル：Excelの%書式（生値が0.085等の小数）の場合は100倍してパーセント表記の数値に揃える。
// 書式情報は読み込みオプションによっては cell.z ではなく整形済みテキスト cell.w にのみ残る場合があるため、
// 実際に確認できたのはcell.w側だった（SheetJSでの読み込み・書き込みの往復で確認済み）ので両方を見る。
function parseYieldCell(cell: XLSXType.CellObject | undefined): number | null {
  const n = parseNumericCell(cell);
  if (n === null) return null;
  const isPercentFormat = (typeof cell?.z === "string" && cell.z.includes("%")) || (typeof cell?.w === "string" && cell.w.includes("%"));
  return isPercentFormat ? Number((n * 100).toFixed(2)) : n;
}
function ymd(d: Date): string { return d.toISOString().slice(0, 10); }

export async function parseInvestmentExcel(arrayBuffer: ArrayBuffer, fileName: string): Promise<InvestmentPerformanceData> {
  const XLSX = await import("xlsx"); // 月1回のアップロード時のみ読み込む重いライブラリ（通常表示時のバンドルには含めない）
  const errors: string[] = [];
  const wb = XLSX.read(arrayBuffer, { type: "array", cellDates: false, cellNF: true });
  const sheetName = wb.SheetNames.includes(SHEET_NAME) ? SHEET_NAME : wb.SheetNames[0];
  if (sheetName !== SHEET_NAME) errors.push(`シート「${SHEET_NAME}」が見つからなかったため、先頭のシート「${sheetName}」を使用しました。`);
  const sheet = wb.Sheets[sheetName];
  if (!sheet || !sheet["!ref"]) {
    errors.push("シートが空、またはデータが見つかりませんでした。");
    return { series: [], accountSeries: [], accountRecentChange: {}, monthlySeries: [], errors, sourceFileName: fileName, parsedAt: new Date().toISOString() };
  }
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  const get = (r: number, c: number) => sheet[XLSX.utils.encode_cell({ r, c })];

  // ① 日付ヘッダー行（1行目=row0）：列1以降で、ヘッダーが日付として解釈できる列だけを時系列の列として採用する。
  //   「前月比」「前年末比」等の集計列はテキストヘッダーのため自然に除外される（列位置のハードコードはしない）。
  const dateCols: { col: number; date: Date }[] = [];
  for (let c = 1; c <= range.e.c; c++) {
    const d = excelCellToDate(XLSX, get(0, c));
    if (d) dateCols.push({ col: c, date: d });
  }
  if (!dateCols.length) errors.push("1行目に日付として解釈できる列が見つかりませんでした。");
  const lastDateCol = dateCols.length ? dateCols[dateCols.length - 1].col : 0;

  // 「前月比」「前年末比」列：日付列より後ろにある最初の該当ヘッダーを採用する（資産集計セクション専用の集計列）。
  let monthChangeCol: number | null = null, yearEndChangeCol: number | null = null;
  for (let c = lastDateCol + 1; c <= range.e.c; c++) {
    const label = normalizeLabel(cellToString(get(0, c)));
    if (monthChangeCol === null && label === "前月比") monthChangeCol = c;
    if (yearEndChangeCol === null && label === "前年末比") yearEndChangeCol = c;
  }

  // ② A列のラベル→行番号の対応表。
  const rowLabels = new Map<number, string>();
  for (let r = range.s.r; r <= range.e.r; r++) {
    const label = normalizeLabel(cellToString(get(r, 0)));
    if (label) rowLabels.set(r, label);
  }
  const findRows = (label: string): number[] => {
    const norm = normalizeLabel(label);
    const rows: number[] = [];
    for (const [r, l] of rowLabels) if (l === norm) rows.push(r);
    return rows.sort((a, b) => a - b);
  };
  // セクション区切り行（＝A列にラベルはあるが日付列に一切データが無い行）を検出し、任意の行が
  // どのセクションに属するかを判定する。特定のセクション名をハードコードせず汎用的な判定にすることで、
  // 将来シートにセクションが追加・変更されても壊れないようにする。
  const rowHasNoData = (row: number): boolean =>
    dateCols.every(({ col }) => { const c = get(row, col); return !c || c.v == null || c.v === ""; });
  const sectionHeaderRows = [...rowLabels.entries()]
    .filter(([r]) => rowHasNoData(r))
    .map(([r, label]) => ({ row: r, label }))
    .sort((a, b) => a.row - b.row);
  const sectionForRow = (row: number): string => {
    let sec = "（シート先頭・セクション不明）";
    for (const h of sectionHeaderRows) { if (h.row <= row) sec = h.label; else break; }
    return sec;
  };
  // sectionRangeを指定すると行範囲 [start, end) に絞り込んで検索する（同名ラベルが他セクションにもある場合の
  // 誤検出を防ぐ）。範囲内に見つからない場合はシート全体にフォールバックし、その旨をエラーに記録する。
  // 複数見つかった場合は、どのセクションに何件あったかをエラーメッセージに含める（診断用）。
  const findRow = (label: string, sectionRange: { start: number; end: number } | null = null): number | null => {
    const all = findRows(label);
    if (!all.length) { errors.push(`「${label}」の行が見つかりませんでした。`); return null; }
    const scoped = sectionRange ? all.filter((r) => r >= sectionRange.start && r < sectionRange.end) : all;
    const used = scoped.length ? scoped : all;
    if (sectionRange && !scoped.length) errors.push(`「${label}」が対象セクション内に見つからなかったため、シート全体から検索しました（${sectionForRow(used[0])}内の行を使用）。`);
    if (all.length > 1) {
      const others = all.filter((r) => r !== used[0]).map((r) => `${sectionForRow(r)}内(行${r + 1})`).join("、");
      errors.push(`「${label}」の行が複数見つかりました。${sectionForRow(used[0])}内(行${used[0] + 1})の行を使用し、${others}は対象外としました。`);
    }
    return used[0];
  };
  // 「利回（年）」は複数出現するため、直前の行のラベルで区別する。
  const findYieldRowAfter = (prevLabel: string, prevRow: number | null): number | null => {
    if (prevRow === null) return null;
    const candidates = findRows("利回（年）").filter((r) => r === prevRow + 1);
    if (!candidates.length) { errors.push(`「${prevLabel}」の直後にあるはずの「利回（年）」行が見つかりませんでした。`); return null; }
    return candidates[0];
  };
  // 口座別内訳（資産集計）の行：口座名と同名のラベルが複数セクションに存在しうる
  // （例：口座ごとの明細セクションだけでなく、"TOTAL"セクション内の内訳行としても同じラベルが出現する）。
  // 実際のシートで確認された優先順位で選ぶ：
  //   ①その口座名と同じ名前のセクション（例：「moomoo証券」という名前のセクション自体）内の行
  //   ②「資産集計」セクション内の行
  //   ③"TOTAL"セクション以外の行（TOTAL内の同名行は口座別の内訳表記であり、時系列データ本体ではないため対象外）
  //   ④それでも無ければ先頭に見つかった行
  const findAccountRow = (label: string): number | null => {
    const all = findRows(label);
    if (!all.length) { errors.push(`「${label}」の行が見つかりませんでした。`); return null; }
    // セクション見出し行自身（例：「moomoo証券」という名前のセクションの見出し行）は日付列にデータを
    // 持たないため、たとえ同名ラベルでもデータ行の候補からは除外する（そうしないと空のデータしか
    // 持たない見出し行を「口座名と同じセクション内の行」として誤って採用してしまう）。
    const withData = all.filter((r) => !rowHasNoData(r));
    const candidates = withData.length ? withData : all;
    const norm = normalizeLabel(label);
    const ownSection = candidates.find((r) => normalizeLabel(sectionForRow(r)) === norm);
    const inAssetSummary = candidates.find((r) => normalizeLabel(sectionForRow(r)) === "資産集計");
    const outsideTotal = candidates.find((r) => normalizeLabel(sectionForRow(r)) !== "TOTAL");
    const chosen = ownSection ?? inAssetSummary ?? outsideTotal ?? candidates[0];
    if (all.length > 1) {
      const others = all.filter((r) => r !== chosen).map((r) => `${sectionForRow(r)}内(行${r + 1})`).join("、");
      errors.push(`「${label}」の行が複数見つかりました。${sectionForRow(chosen)}内(行${chosen + 1})の行を使用し、${others}は対象外としました。`);
    }
    return chosen;
  };

  const extractRowSeries = (row: number | null, parse: (cell: XLSXType.CellObject | undefined) => number | null): (number | null)[] =>
    dateCols.map(({ col }) => (row === null ? null : parse(get(row, col))));

  const periodRow = findRow("期間（年）");
  const totalAssetsRow = findRow("総資産");
  const principalRow = findRow("元本");
  const realizedReturnRow = findRow("リターン（売却益+配当）");
  const realizedYieldRow = findYieldRowAfter("リターン（売却益+配当）", realizedReturnRow);
  const totalReturnRow = findRow("トータルリターン（リターン+評価益）");
  const totalYieldRow = findYieldRowAfter("トータルリターン（リターン+評価益）", totalReturnRow);

  const periodVals = extractRowSeries(periodRow, parseNumericCell);
  const totalAssetsVals = extractRowSeries(totalAssetsRow, parseNumericCell);
  const principalVals = extractRowSeries(principalRow, parseNumericCell);
  const realizedReturnVals = extractRowSeries(realizedReturnRow, parseNumericCell);
  const realizedYieldVals = extractRowSeries(realizedYieldRow, parseYieldCell);
  const totalReturnVals = extractRowSeries(totalReturnRow, parseNumericCell);
  const totalYieldVals = extractRowSeries(totalYieldRow, parseYieldCell);

  const series: InvestmentSeriesPoint[] = dateCols.map(({ date }, i) => ({
    date: ymd(date), periodYears: periodVals[i], totalAssets: totalAssetsVals[i], principal: principalVals[i],
    realizedReturn: realizedReturnVals[i], realizedYield: realizedYieldVals[i], totalReturn: totalReturnVals[i], totalYield: totalYieldVals[i],
  }));

  // FREトライアル（楽天証券のみ）セクション：直近月次パフォーマンス。
  const prevMonthTotalRow = findRow("総資産（前月末/月初）");
  const monthPerformanceRow = findRow("当月パフォーマンス（当月－前月）");
  const withdrawalRow = findRow("取り崩し（当月生活費/月初資金移動）");
  const excessReturnRow = findRow("超過収益（当月パフォーマンス‐取り崩し）");
  const bonusReserveRow = findRow("ボーナス（6・12月）原資");
  const prevMonthTotalVals = extractRowSeries(prevMonthTotalRow, parseNumericCell);
  const monthPerformanceVals = extractRowSeries(monthPerformanceRow, parseNumericCell);
  const withdrawalVals = extractRowSeries(withdrawalRow, parseNumericCell);
  const excessReturnVals = extractRowSeries(excessReturnRow, parseNumericCell);
  const bonusReserveVals = extractRowSeries(bonusReserveRow, parseNumericCell);
  const monthlySeries: InvestmentMonthlyPoint[] = dateCols.map(({ date }, i) => ({
    date: ymd(date), prevMonthTotal: prevMonthTotalVals[i], monthPerformance: monthPerformanceVals[i],
    withdrawal: withdrawalVals[i], excessReturn: excessReturnVals[i], bonusReserve: bonusReserveVals[i],
  }));

  // 口座別内訳：口座開設前の空欄は0円ではなくnull（データなし）として扱う。
  const accountRows: Record<string, number | null> = {};
  for (const label of ACCOUNT_LABELS) accountRows[label] = findAccountRow(label);
  const accountSeries: InvestmentAccountPoint[] = dateCols.map(({ date }, i) => ({
    date: ymd(date),
    accounts: Object.fromEntries(ACCOUNT_LABELS.map((label) => {
      const row = accountRows[label];
      return [label, row === null ? null : parseNumericCell(get(row, dateCols[i].col))];
    })),
  }));
  const accountRecentChange: Record<string, { monthChange: number | null; yearEndChange: number | null }> = {};
  for (const label of ACCOUNT_LABELS) {
    const row = accountRows[label];
    accountRecentChange[label] = {
      monthChange: row !== null && monthChangeCol !== null ? parseNumericCell(get(row, monthChangeCol)) : null,
      yearEndChange: row !== null && yearEndChangeCol !== null ? parseNumericCell(get(row, yearEndChangeCol)) : null,
    };
  }

  return { series, accountSeries, accountRecentChange, monthlySeries, errors, sourceFileName: fileName, parsedAt: new Date().toISOString() };
}

// ---- 分析用の純粋関数 ----

// ②自己資産のDD分析：既存のSP500 DD計算（ATH追跡・DD%）と同じ方式を、総資産の時系列にそのまま適用する。
export function computeOwnAssetDrawdown(series: InvestmentSeriesPoint[]) {
  const points = series.filter((p) => p.totalAssets !== null) as (InvestmentSeriesPoint & { totalAssets: number })[];
  if (!points.length) return null;
  let ath = 0, athDate = points[0].date, maxDD = 0, maxDDDate = points[0].date;
  const FULL = points.map((p) => {
    if (p.totalAssets > ath) { ath = p.totalAssets; athDate = p.date; }
    const dd = ath > 0 ? Number((((p.totalAssets / ath) - 1) * 100).toFixed(2)) : 0;
    if (dd < maxDD) { maxDD = dd; maxDDDate = p.date; }
    return { date: p.date, totalAssets: p.totalAssets, ath, dd };
  });
  const last = FULL[FULL.length - 1];
  return { FULL, currentDD: last.dd, currentATH: last.ath, currentATHDate: athDate, maxDD, maxDDDate };
}

// ③ベンチマーク比較：市場トラックレコード（{date,price}のFULL配列）から、指定期間の価格ベースCAGR(%)を算出する。
// 追加投資により元本が段階的に増える投資家自身の利回りとの厳密な比較ではない点はUI側で必ず注記する。
function nearestPriceOnOrBefore(FULL: { date: Date; price: number }[], targetDate: Date): number | null {
  let best: number | null = null;
  for (const p of FULL) { if (p.date <= targetDate) best = p.price; else break; }
  return best;
}
export function computeBenchmarkCAGR(FULL: { date: Date; price: number }[], startDate: Date, endDate: Date): number | null {
  if (!FULL || !FULL.length) return null;
  const startPrice = nearestPriceOnOrBefore(FULL, startDate);
  const endPrice = nearestPriceOnOrBefore(FULL, endDate);
  const days = (endDate.getTime() - startDate.getTime()) / 86400000;
  if (startPrice === null || endPrice === null || startPrice <= 0 || days <= 0) return null;
  return Number(((Math.pow(endPrice / startPrice, 365.25 / days) - 1) * 100).toFixed(2));
}
