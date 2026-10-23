// DD（下落率）の5段階呼び名（調整・下落・暴落・大暴落・歴史的暴落）の分類ロジック。
// 「詳細サマリー出力」（components/DDDashboard.jsx）と「長尺動画」（lib/videoLongMd.ts 等）の
// 両方から参照する単一の定義。境界はDDの深さ（%、負の値）で決まる：
//   10%未満: 調整 / 10〜20%: 下落 / 20〜30%: 暴落 / 30〜50%: 大暴落 / 50%以上: 歴史的暴落

export interface DdCategoryBucket {
  label: string;
  thresholdPct: number; // 0, -10, -20, -30, -50 (この節目以上に深い場合に該当)
}

export const DD_CATEGORY_BUCKETS: DdCategoryBucket[] = [
  { label: '調整', thresholdPct: 0 },
  { label: '下落', thresholdPct: -10 },
  { label: '暴落', thresholdPct: -20 },
  { label: '大暴落', thresholdPct: -30 },
  { label: '歴史的暴落', thresholdPct: -50 },
];

/**
 * 現在のDD（%、0または負の値）から、到達している最も深い節目のバケットを返す。
 * 例: currentDD=-1.6 -> 調整。currentDD=-22 -> 暴落。
 */
export function classifyDdCategory(currentDD: number): DdCategoryBucket {
  let result = DD_CATEGORY_BUCKETS[0];
  for (const bucket of DD_CATEGORY_BUCKETS) {
    if (currentDD <= bucket.thresholdPct) {
      result = bucket;
    }
  }
  return result;
}

/**
 * trackRecord.finalReach の行の p（%、ある節目まで最終的に到達した条件付き確率）と
 * ddFreqPerYear（DD-3%到達局面が年に何回起こるか）から、「その節目まで到達する」頻度（年あたり回数）を求める。
 * ダッシュボード本体（components/DDDashboard.jsx）の freqPerYearFromP と同じ式。
 */
export function freqPerYearFromP(p: number | null, ddFreqPerYear: number | null): number | null {
  if (p == null || ddFreqPerYear == null || !Number.isFinite(p) || !Number.isFinite(ddFreqPerYear)) return null;
  return ddFreqPerYear * (p / 100);
}

/**
 * freqPerYearFromP の結果を「年に1.7回」「3.0年に1度」のような文字列にする。
 * ダッシュボード本体の freqLabelFromP と同じ考え方の小さな移植版。
 */
export function freqLabelFromP(p: number | null, ddFreqPerYear: number | null): string | null {
  const perYear = freqPerYearFromP(p, ddFreqPerYear);
  if (perYear == null || perYear <= 0) return null;
  if (perYear >= 1) {
    return `年に${perYear.toFixed(1)}回`;
  }
  const years = 1 / perYear;
  return `${years.toFixed(1)}年に1度`;
}

export const DD_CATEGORY_KANA: Record<string, string> = {
  調整: 'ちょうせい',
  下落: 'げらく',
  暴落: 'ぼうらく',
  大暴落: 'だいぼうらく',
  歴史的暴落: 'れきしてき、ぼうらく',
};
