// [Stage G-3] 「株式情報」動画の冒頭に入れる、AIを介さず作る固定の3場面：
// ①前提条件・DDの定義、②過去の下落の深さと回数の分布、③「谷間」の概念図。
// いずれも lib/explainer/scriptModel.ts の sourcesScene() と同じパターン（AIに作らせず、コードで直接
// ExplainerScene を組み立てる）。②の数値はダッシュボードが書き出す finalReach（trackRecord.finalReach、
// DD-3%到達局面からの最終到達確率と発生回数）をそのまま使い、AIには一切生成させない。③は実データではなく、
// 「谷間」という考え方を示すためのイメージ図（合成した数値）であり、本文・テロップにその旨を明記する。
import { newSceneId, minSecFor } from './scriptModel';
import { emptyVisual } from './types';
import type { ExplainerScene } from './types';
import { integerToKana } from '../videoReading';

/** components/DDDashboard.jsxがstock-catalog:*へ書き出すfinalReach（lib/videoLongMd.tsのLongMd['finalReach']と同じ形） */
export interface StockFinalReach {
  totalYears: number;
  n: number;
  currentLabel: string | null;
  rows: { label: string; p: number | null; hits: number }[];
}

// 「発生回数と深さの分布」で表示する代表的な5段階（lib/videoLongMd.tsのcrashFreqビルダーと同じ節目）
const BUCKET_LABELS = ['-5%', '-10%', '-20%', '-30%', '-50%以上'];
const BUCKET_READING: Record<string, string> = {
  '-5%': 'まいなす、ごぱーせんと',
  '-10%': 'まいなす、じゅっぱーせんと',
  '-20%': 'まいなす、にじゅっぱーせんと',
  '-30%': 'まいなす、さんじゅっぱーせんと',
  '-50%以上': 'まいなす、ごじゅっぱーせんと、いじょう',
};

/** ①前提条件・DDの定義 */
function introScene(totalYearsInt: number): ExplainerScene {
  const yearsPhrase = totalYearsInt > 0 ? `過去${totalYearsInt}年間の` : '過去の';
  const yearsReading = totalYearsInt > 0 ? `かこ、${integerToKana(totalYearsInt)}ねんかんの、` : 'かこの、';
  const narration = `この動画は、${yearsPhrase}実績にもとづく確率を紹介するものであり、将来の結果を保証するものではありません。ここでのDD（ドローダウン）とは、それまでの最高値（ATH）からの下落率のことです。`;
  const reading = `このどうがは、${yearsReading}じっせきに、もとづく、かくりつを、しょうかいするものであり、しょうらいの、けっかを、ほしょうするものでは、ありません。ここでの、どろーだうんとは、それまでの、さいたかねから、どれだけ、げらくしたかを、しめす、りつのことです。`;
  const items = [
    { label: `${yearsPhrase}実績にもとづく確率です`, value: '', text: '', icon: 'document' as const },
    { label: '将来の保証ではありません', value: '', text: '今後も同じ結果になるとは限りません', icon: 'warning' as const },
    { label: 'DD（ドローダウン）とは', value: '', text: 'それまでの最高値（ATH）からの下落率のことです', icon: 'chartDown' as const },
  ];
  return {
    id: newSceneId(), title: '前提条件', caption: '過去の実績に基づく確率・将来の保証ではない',
    narration, reading,
    visual: { ...emptyVisual('points'), heading: 'ご覧になる前に', subheading: 'この動画の前提', items },
    chapter: 0, minSec: minSecFor('points'), imageId: null,
  };
}

/** ②過去の下落の深さと回数の分布（finalReachが無ければnull＝この場面はスキップ） */
function distributionScene(fr: StockFinalReach, totalYearsInt: number, instrumentLabel: string): ExplainerScene | null {
  const picked = BUCKET_LABELS
    .map((label) => ({ label, row: fr.rows.find((x) => x.label === label) ?? null }))
    .filter((x): x is { label: string; row: { label: string; p: number | null; hits: number } } => !!x.row);
  if (!picked.length) return null;
  const items = picked.map(({ label, row }) => ({ label, value: String(row.hits), text: '', icon: 'chartDown' as const }));
  const narration = `過去${totalYearsInt}年間で、${instrumentLabel}のドローダウンがマイナス3%に到達した局面は${fr.n}回ありました。そのうち、${picked.map(({ label, row }) => `${label}まで深まったのが${row.hits}回`).join('、')}です。`;
  const reading = `かこ、${integerToKana(totalYearsInt)}ねんかんで、どろーだうんが、まいなす、さんぱーせんとに、とうたつした、きょくめんは、${integerToKana(fr.n)}かい、ありました。そのうち、${picked.map(({ label, row }) => `${BUCKET_READING[label]}まで、ふかまったのが、${integerToKana(row.hits)}かい`).join('、')}です。`;
  return {
    id: newSceneId(), title: '発生回数と深さの分布', caption: `発生回数と深さの分布（過去${totalYearsInt}年・${fr.n}局面）`,
    narration, reading,
    visual: { ...emptyVisual('bar'), heading: '過去の下落の深さと回数', subheading: `過去${totalYearsInt}年・${fr.n}局面（ドローダウン マイナス3%到達後）`, items, unit: '回', source: `${instrumentLabel}の実績データ（過去${totalYearsInt}年）` },
    chapter: 0, minSec: minSecFor('bar'), imageId: null,
  };
}

/** ③「谷間」の概念図（実データではなく考え方を示すイメージ図。合成した数値を使う） */
function valleyScene(): ExplainerScene {
  const items = [
    { label: '最高値（ATH）', value: '100', text: '', icon: 'chartUp' as const },
    { label: 'マイナス3%到達', value: '97', text: '', icon: 'chartDown' as const },
    { label: '谷（底）', value: '85', text: '', icon: 'chartDown' as const },
    { label: 'ATH回復', value: '100', text: '', icon: 'chartUp' as const },
  ];
  const narration = 'ここでの「谷間」とは、最高値（ATH）からマイナス3%以上下落してから、再びATHまで回復するまでの期間のことです。この図は考え方を示すイメージであり、実際の値動きではありません。';
  const reading = 'ここでの、たにまとは、さいたかねから、まいなす、さんぱーせんと、いじょう、げらくしてから、ふたたび、さいたかねまで、かいふくするまでの、きかんのことです。このずは、かんがえかたを、しめす、いめーじであり、じっさいの、ねあたりでは、ありません。';
  return {
    id: newSceneId(), title: '「谷間」の考え方', caption: '「谷間」の概念図（イメージ）',
    narration, reading,
    visual: { ...emptyVisual('line'), heading: '「谷間」の考え方', subheading: 'ATHから-3%以上下落してATHに戻るまで（イメージ図）', items, unit: '（指数、ATH＝100）', source: 'イメージ図（実際のデータではありません）' },
    chapter: 0, minSec: minSecFor('line'), imageId: null,
  };
}

/**
 * 「株式情報」動画の冒頭に入れる固定場面（最大3件）を組み立てる。
 * finalReachがnull（未取得・銘柄未対応等）のときは、②の分布グラフのみスキップする（①③は生成する）。
 */
export function buildStockIntroScenes(finalReach: StockFinalReach | null, instrumentLabel: string = 'S&P500'): ExplainerScene[] {
  const totalYearsInt = finalReach && Number.isFinite(finalReach.totalYears) ? Math.max(1, Math.round(finalReach.totalYears)) : 0;
  const out: ExplainerScene[] = [introScene(totalYearsInt)];
  if (finalReach) {
    const dist = distributionScene(finalReach, totalYearsInt, instrumentLabel);
    if (dist) out.push(dist);
  }
  out.push(valleyScene());
  return out;
}
