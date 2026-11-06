// [動画連携][Stage E-11] 「最高値更新ペース」固定場面：ダッシュボードが書き出すathPace
// （lib/accelSensor.ts、summarizeAthPaceForVideo）の実績を、AIを介さずそのまま場面にする
// （accelIntroScene.tsと同じ方針＝数値はダッシュボードの実データをそのまま使い、AIには作文させない）。
// athPaceが無い（未計算・未対応銘柄）場合や、更新回数が0（標本が無い）場合はnullを返す。
import { newSceneId, minSecFor } from './scriptModel';
import { emptyVisual } from './types';
import type { ExplainerScene, AthPaceSummary } from './types';
import { integerToKana, numberStringToKana } from '../videoReading';

export function buildAthPaceScene(athPace: AthPaceSummary | null | undefined, instrumentLabel: string): ExplainerScene | null {
  if (!athPace || athPace.updateCount < 1) return null;
  const yearsInt = Math.max(1, Math.round(athPace.periodYears));
  const avg = athPace.avgIntervalDays;
  const median = athPace.medianIntervalDays;
  const curBin = athPace.currentBinIndex != null ? athPace.bins[athPace.currentBinIndex] : null;

  const items = athPace.bins.map((b, i) => ({
    label: b.label, value: String(b.count), text: '', icon: 'chartUp' as const,
    seriesEmphasis: i === athPace.currentBinIndex,
  }));

  const curNarr = athPace.currentElapsedDays > 0
    ? (curBin
      ? `今回は直近の更新から${athPace.currentElapsedDays}営業日が経過中で、「${curBin.label}」の区分に入ります。`
      : `今回は直近の更新から${athPace.currentElapsedDays}営業日が経過中です。`)
    : '直近の営業日は、新高値を更新した日です。';
  const curReading = athPace.currentElapsedDays > 0
    ? (curBin
      ? `こんかいは、ちょっきんの、こうしんから、${integerToKana(athPace.currentElapsedDays)}えいぎょうびが、けいかちゅうで、「${curBin.label}」の、くぶんに、はいります。`
      : `こんかいは、ちょっきんの、こうしんから、${integerToKana(athPace.currentElapsedDays)}えいぎょうびが、けいかちゅうです。`)
    : 'ちょっきんの、えいぎょうびは、しんたかねを、こうしんした、ひです。';

  const narration = `過去${yearsInt}年間で、${instrumentLabel}が新高値を更新したのは${athPace.updateCount}回。更新から次の更新までの間隔は、平均${avg ?? '―'}営業日、中央値${median ?? '―'}営業日でした。${curNarr}`;
  const reading = `かこ、${integerToKana(yearsInt)}ねんかんで、しんたかねを、こうしんしたのは、${integerToKana(athPace.updateCount)}かい。こうしんから、つぎのこうしんまでの、かんかくは、へいきん、${avg != null ? numberStringToKana(String(avg)) : 'さんこうちなし'}、えいぎょうび、ちゅうおうち、${median != null ? numberStringToKana(String(median)) : 'さんこうちなし'}、えいぎょうびでした。${curReading}`;

  return {
    id: newSceneId(), title: '最高値更新ペース', caption: `最高値更新のペース（過去${yearsInt}年・${athPace.updateCount}回）`,
    narration, reading,
    visual: {
      ...emptyVisual('histogram'), heading: '最高値更新のペース', subheading: `更新間隔の分布（過去${yearsInt}年・現在${athPace.currentElapsedDays}営業日経過）`,
      items, unit: '回', source: `${instrumentLabel}の実績データ（過去${yearsInt}年、ダッシュボードと同一ロジック）`,
    },
    chapter: 0, minSec: minSecFor('bar'), imageId: null,
  };
}
