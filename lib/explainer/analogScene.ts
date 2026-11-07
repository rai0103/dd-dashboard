// [動画連携][Stage E-14] 「類似局面サーチ」固定場面：ダッシュボードが書き出すanalogFinder
// （lib/analogFinder.ts、findHistoricalAnalogs）の結果を、AIを介さずそのまま場面にする
// （athPaceScene.ts・rollingReturnScene.ts・dailyMoveScene.tsと同じ方針＝数値はダッシュボードの
// 実データをそのまま使い、AIには作文させない）。既存の「年比較」場面と同じ'yearCompare'ビジュアル
// （drawOverlay、lib/explainer/visuals.ts）を再利用し、横軸を「年初からの経過日数」ではなく
// 「一致局面からの経過営業日（マイナス＝一致局面までの軌跡、0＝一致局面・現在）」に変える。
import { newSceneId, minSecFor } from './scriptModel';
import { emptyVisual } from './types';
import type { ExplainerScene, AnalogFinderSummary, VisualItem } from './types';
import { integerToKana, numberStringToKana } from '../videoReading';

// 動画では線が多すぎると見づらいため、誤差の小さい上位何件までを重ねて描くか。
const MAX_SCENE_MATCHES = 6;
// 「その後」の目安として読み上げるホライズン（営業日）。
const SUMMARY_HORIZON = 60;

function pctJp(v: number | null): string {
  if (v == null) return '―';
  return `${v >= 0 ? '+' : ''}${v}%`;
}
function pctReadable(v: number): string {
  const sign = v < 0 ? 'まいなす、' : '';
  return `${sign}${numberStringToKana(String(Math.abs(v)))}ぱーせんと`;
}

export function buildAnalogScene(af: AnalogFinderSummary | null | undefined, instrumentLabel: string): ExplainerScene | null {
  if (!af || !af.matches.length) return null;
  const matches = af.matches.slice(0, MAX_SCENE_MATCHES);

  const items: VisualItem[] = [];
  af.currentPath.forEach((p) => {
    items.push({ label: '現在まで', value: String(p.pct), text: '', icon: 'chartUp', x: p.x, seriesKey: 'current', seriesLabel: '現在までの軌跡', seriesEmphasis: true });
  });
  matches.forEach((m, i) => {
    if (m.forward.length < 2) return;
    m.forward.forEach((f, k) => {
      items.push({ label: m.date, value: String(f.pct), text: '', icon: 'chartDown', x: k, seriesKey: `analog${i}`, seriesLabel: m.date });
    });
  });
  if (!items.length) return null;

  // 読み上げ用の要約統計：一致した各局面の、SUMMARY_HORIZON営業日後の値動きの平均（データがある局面のみ）。
  const atHorizon = matches.map((m) => m.forward[SUMMARY_HORIZON]?.pct).filter((v): v is number => v != null);
  const meanAtHorizon = atHorizon.length ? Math.round((atHorizon.reduce((a, b) => a + b, 0) / atHorizon.length) * 10) / 10 : null;
  const upCount = atHorizon.filter((v) => v > 0).length;

  const checkpointsLabel = af.checkpointTargets.map((t) => `${t.label}${pctJp(t.targetPct)}`).join('・');
  const narration = `直近の値動き（${checkpointsLabel}）が、前後0.5%の範囲で似ている過去の局面を探すと、${af.matches.length}件見つかりました。それらの局面の${SUMMARY_HORIZON}営業日後を見ると、${atHorizon.length}件中${upCount}件が上昇し、平均は${pctJp(meanAtHorizon)}でした。`;
  const reading = `ちょっきんの、ねあがねさがり、が、まえご、ぜろてんごぱーせんとの、はんいで、にている、かこの、きょくめんを、さがすと、${integerToKana(af.matches.length)}けん、みつかりました。それらの、きょくめんの、${integerToKana(SUMMARY_HORIZON)}えいぎょうびごを、みると、${integerToKana(atHorizon.length)}けんちゅう、${integerToKana(upCount)}けんが、じょうしょうし、へいきんは、${meanAtHorizon != null ? pctReadable(meanAtHorizon) : 'さんこうちなし'}でした。`;

  return {
    id: newSceneId(), title: '類似局面サーチ', caption: `過去の似た値動きとその後（一致${af.matches.length}件・直近${af.checkpointTargets.length}基準点）`,
    narration, reading,
    visual: {
      ...emptyVisual('yearCompare'), heading: '似た値動きの局面を探すと？', subheading: `一致局面（${af.matches.length}件）とその後の値動き`,
      unit: '%', source: `${instrumentLabel}の実績データ（基準点：${checkpointsLabel}、一致幅±0.5%）`,
      items,
    },
    chapter: 0, minSec: minSecFor('bar'), imageId: null,
  };
}
