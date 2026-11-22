// DD（最高値からの下落率）の呼び名の分類ロジック。ダッシュボード（詳細サマリー・局面の名前など）・長尺動画・解説動画で使う単一の定義。
// 呼び名は次のとおりに統一する（境界はDDの深さ、%・負の値。その節目以上に深ければ該当）：
//   −3%未満: 小幅な下落 / −3%〜: 軽い調整 / −5%〜: 小幅調整 / −10%〜: 調整 / −20%〜: 弱気相場 / −30%〜: 暴落 / −40%〜: 歴史的暴落

export interface DdCategoryBucket {
  label: string;
  thresholdPct: number; // 0, -3, -5, -10, -20, -30, -40 (この節目以上に深い場合に該当)
}

export const DD_CATEGORY_BUCKETS: DdCategoryBucket[] = [
  { label: '小幅な下落', thresholdPct: 0 },
  { label: '軽い調整', thresholdPct: -3 },
  { label: '小幅調整', thresholdPct: -5 },
  { label: '調整', thresholdPct: -10 },
  { label: '弱気相場', thresholdPct: -20 },
  { label: '暴落', thresholdPct: -30 },
  { label: '歴史的暴落', thresholdPct: -40 },
];

/** 呼び名の一覧（AIへの指示・表示用の説明文） */
export const DD_CATEGORY_GUIDE = '−3%未満＝小幅な下落、−3%〜＝軽い調整、−5%〜＝小幅調整、−10%〜＝調整、−20%〜＝弱気相場、−30%〜＝暴落、−40%〜＝歴史的暴落';

/**
 * 現在のDD（%、0または負の値）から、到達している最も深い節目のバケットを返す。
 * 例: currentDD=-1.6 -> 小幅な下落。currentDD=-22 -> 弱気相場。currentDD=-45 -> 歴史的暴落。
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
  小幅な下落: 'こはばな、げらく',
  軽い調整: 'かるい、ちょうせい',
  小幅調整: 'こはば、ちょうせい',
  調整: 'ちょうせい',
  弱気相場: 'よわき、そうば',
  暴落: 'ぼうらく',
  歴史的暴落: 'れきしてき、ぼうらく',
};
