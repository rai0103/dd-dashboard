// 価格CSV（Stooq形式：Date,Open,High,Low,Close,Volume）の共通パース処理。
// もともと components/DDDashboard.jsx 内のローカル関数だったものを、ExplainerStudio（解説動画作成）側の
// 「株式情報」モードでのCSVアップロードでも同じ形式を読めるようにするため、このファイルに切り出した
// （Stage E-1。挙動は変更していない。dd-dashboard本体の呼び出し元はこの関数をimportするよう変更）。

// 引用符で囲まれたフィールド内のカンマ（例: "5,480.22" のような桁区切り）を誤って列区切りとして分割しないCSV行パーサー。
// 単純な line.split(",") だと桁区切りカンマ入りの値で列がずれ、Close列に別の値が混入する不具合があったため導入。
export function parseCSVLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false; }
      else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// Excel等で保存されたUTF-8 CSV先頭のBOMを除去するため（コードポイント指定で明示、ソース上に不可視文字を埋め込まない）
export const BOM_RE = new RegExp("^" + String.fromCharCode(0xfeff));

export function findCol(header: string[], candidates: string[]): number {
  for (const c of candidates) { const idx = header.indexOf(c); if (idx !== -1) return idx; }
  return -1;
}

// 日付のみの文字列（"YYYY-MM-DD" or "YYYY/MM/DD" 等）を、実行環境のタイムゾーンに関わらずUTC 0時のDateとして厳密にパースする。
// new Date(string) はECMAScript仕様上「-」区切りのISO日付のみUTCとして解釈され、「/」区切りなど非ISO形式は実装依存でローカル時刻として
// 解釈されるため、UTCより進んだタイムゾーン（JST等）の環境では日付が1日前にズレる不具合の原因になっていた（例：CSVの日付欄が"/"区切りの場合）。
// この関数は区切り文字によらず年月日を直接抽出してUTC基準のDateを作るため、実行環境に関わらず常に同じ日付になる。
export function parseDateOnly(str: unknown): Date {
  const m = String(str).trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!m) return new Date(NaN);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

export interface ParsedPricePoint { date: Date; price: number }

// Date/Close列を検出してパースする（見出しは "date"/"日付"・"close"/"終値" のいずれでも可、大文字小文字は区別しない）。
// 検出できない場合は空配列を返す（呼び出し側はエラー表示等に使う）。
export function parseStooqCSV(text: string): ParsedPricePoint[] {
  const normalized = text.replace(BOM_RE, "").trim(); // 先頭BOM・前後の空白を除去
  const lines = normalized.split(/\r?\n/).filter((l) => l.trim() !== ""); // \r\n(Windows)・\n(Unix)いずれも対応し、空行は除外
  if (!lines.length) return [];
  const header = parseCSVLine(lines[0]).map((h) => h.trim().toLowerCase());
  const dateIdx = findCol(header, ["date", "日付"]);
  const closeIdx = findCol(header, ["close", "終値"]);
  if (dateIdx === -1 || closeIdx === -1) return [];
  const rows: ParsedPricePoint[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (cols.length <= Math.max(dateIdx, closeIdx)) continue;
    const d = parseDateOnly(cols[dateIdx]);
    const c = parseFloat(String(cols[closeIdx]).replace(/,/g, "").trim());
    if (!isNaN(d.getTime()) && !isNaN(c)) rows.push({ date: d, price: c });
  }
  rows.sort((a, b) => a.date.getTime() - b.date.getTime());
  return rows;
}
