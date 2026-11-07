// [動画連携][Stage E-13] 「1日◯%超下落のその後」固定場面：ダッシュボードが書き出すdailyMoveDown
// （lib/dailyMoveBuckets.ts、summarizeDailyMoveBucketsForVideo）の実績を、AIを介さずそのまま場面にする
// （athPaceScene.ts・rollingReturnScene.tsと同じ方針＝数値はダッシュボードの実データをそのまま使い、
// AIには作文させない）。dailyMoveDownが無い、または標本が十分な区分が無い場合はnullを返す。
import { newSceneId, minSecFor } from './scriptModel';
import { emptyVisual } from './types';
import type { ExplainerScene, DailyMoveBucketSummary, VisualItem } from './types';
import { integerToKana, numberStringToKana } from '../videoReading';

function pctJp(v: number | null): string {
  if (v == null) return '―';
  return `${v >= 0 ? '+' : ''}${v}%`;
}
function pctReadable(v: number): string {
  const sign = v < 0 ? 'まいなす、' : '';
  return `${sign}${numberStringToKana(String(Math.abs(v)))}ぱーせんと`;
}

/** 比較に使う2つのホライズン（営業日）。既定は「翌営業日」と「20営業日後」。 */
const SHORT_HORIZON = 1;
const LONG_HORIZON = 20;

export function buildDailyMoveScene(dm: DailyMoveBucketSummary | null | undefined, instrumentLabel: string): ExplainerScene | null {
  if (!dm || dm.direction !== 'down') return null;
  const buckets = dm.buckets.filter((b) => b.n >= 5);
  if (!buckets.length) return null;
  const yearsInt = Math.max(1, Math.round(dm.periodYears));

  const shortLabel = `翌営業日`;
  const longLabel = `${LONG_HORIZON}営業日後`;
  const items: VisualItem[] = [];
  for (const b of buckets) {
    const sh = b.horizons.find((h) => h.horizonDays === SHORT_HORIZON);
    const lo = b.horizons.find((h) => h.horizonDays === LONG_HORIZON);
    if (sh?.mean != null) items.push({ label: b.label, value: String(sh.mean), text: '', icon: 'chartDown', seriesKey: 'short', seriesLabel: shortLabel });
    if (lo?.mean != null) items.push({ label: b.label, value: String(lo.mean), text: '', icon: 'chartUp', seriesKey: 'long', seriesLabel: longLabel });
  }
  if (!items.length) return null;

  const lines = buckets.map((b) => {
    const sh = b.horizons.find((h) => h.horizonDays === SHORT_HORIZON);
    const lo = b.horizons.find((h) => h.horizonDays === LONG_HORIZON);
    return { b, shMean: sh?.mean ?? null, loMean: lo?.mean ?? null };
  });
  const narrBody = lines
    .map(({ b, shMean, loMean }) => `${b.label}の下落（年${b.perYear}回）では、${shortLabel}が${pctJp(shMean)}、${longLabel}には${pctJp(loMean)}`)
    .join('。');
  const readBody = lines
    .map(({ b, shMean, loMean }) => `${b.label}の、げらくでは、${shortLabel}が、${shMean != null ? pctReadable(shMean) : 'さんこうちなし'}、${longLabel}には、${loMean != null ? pctReadable(loMean) : 'さんこうちなし'}`)
    .join('。');

  const narration = `1日で大きく下落した日の「その後」を、下落幅の区分ごとに見ます。過去${yearsInt}年の実績です。${narrBody}。`;
  const reading = `いちにちで、おおきく、げらくした、ひの、「そのご」を、げらくはばの、くぶんごとに、みます。かこ、${integerToKana(yearsInt)}ねんの、じっせきです。${readBody}。`;

  return {
    id: newSceneId(), title: '1日下落のその後', caption: `1日◯%超下落のその後（過去${yearsInt}年・${shortLabel}／${longLabel}）`,
    narration, reading,
    visual: {
      ...emptyVisual('groupedBar'), heading: '1日の大幅下落、その後は？', subheading: `下落幅の区分別：${shortLabel} vs ${longLabel}（過去${yearsInt}年）`,
      items, unit: '%', source: `${instrumentLabel}の実績データ（過去${yearsInt}年、1日の騰落率を区分別に集計）`,
    },
    chapter: 0, minSec: minSecFor('bar'), imageId: null,
  };
}
