// [動画連携][Stage E-12] 「保有期間で変わる勝率」固定場面：ダッシュボードが書き出すrollingReturns
// （lib/rollingReturn.ts、summarizeRollingReturnsForVideo）の実績を、AIを介さずそのまま場面にする
// （athPaceScene.tsと同じ方針＝数値はダッシュボードの実データをそのまま使い、AIには作文させない）。
// rollingReturnsが無い、または標本が十分な区分が無い場合はnullを返す。
import { newSceneId, minSecFor } from './scriptModel';
import { emptyVisual } from './types';
import type { ExplainerScene, RollingReturnSummary, DistributionSpec } from './types';
import { integerToKana, numberStringToKana } from '../videoReading';

// 標本1件あたりの「勝ち（プラス）」を読み上げやすい形にする
function pctJp(v: number | null): string {
  if (v == null) return '―';
  return `${v >= 0 ? '+' : ''}${v}%`;
}
function pctReadable(v: number): string {
  const sign = v < 0 ? 'まいなす、' : '';
  return `${sign}${numberStringToKana(String(Math.abs(v)))}ぱーせんと`;
}

export function buildRollingReturnScene(rr: RollingReturnSummary | null | undefined, instrumentLabel: string): ExplainerScene | null {
  if (!rr) return null;
  const groups = rr.groups.filter((g) => g.n >= 5); // 標本が極端に少ない区分は信頼できないため場面に出さない
  if (!groups.length) return null;
  const yearsInt = Math.max(1, Math.round(rr.periodYears));

  const distribution: DistributionSpec = {
    unit: '%',
    groups: groups.map((g) => ({ label: g.label, samples: g.samples, mean: g.mean ?? undefined })),
  };

  const lines = groups.map((g) => {
    const winPct = g.winRate != null ? Math.round(g.winRate * 1000) / 10 : null;
    return { g, winPct };
  });
  const narrBody = lines
    .map(({ g, winPct }) => `${g.label}保有では、プラスで終えた割合が${winPct ?? '―'}%（${g.n}標本中）、平均は${pctJp(g.mean)}`)
    .join('。');
  const readBody = lines
    .map(({ g, winPct }) => `${g.label}の、ほゆうでは、ぷらすで、おえた、わりあいが、${winPct != null ? numberStringToKana(String(winPct)) : 'さんこうちなし'}ぱーせんと、${integerToKana(g.n)}ひょうほんちゅう、へいきんは、${g.mean != null ? pctReadable(g.mean) : 'さんこうちなし'}`)
    .join('。');

  const narration = `保有期間が長くなるほど、勝率（プラスで終える割合）がどう変わるかを、過去${yearsInt}年・各年始点からの実績で見ます。${narrBody}。`;
  const reading = `ほゆうきかんが、ながくなるほど、しょうりつ、ぷらすで、おえる、わりあいが、どうかわるかを、かこ、${integerToKana(yearsInt)}ねん、かくねんしじてんからの、じっせきでみます。${readBody}。`;

  return {
    id: newSceneId(), title: '保有期間で変わる勝率', caption: `保有期間別の勝率・個別結果（過去${yearsInt}年・各年始点基準）`,
    narration, reading,
    visual: {
      ...emptyVisual('distribution'), heading: '保有期間で変わる「勝率」', subheading: `過去${yearsInt}年・個別結果（1点＝1標本）`,
      unit: '%', distribution, source: `${instrumentLabel}の実績データ（過去${yearsInt}年、各年最初の営業日を基準に算出）`,
    },
    chapter: 0, minSec: minSecFor('bar'), imageId: null,
  };
}
