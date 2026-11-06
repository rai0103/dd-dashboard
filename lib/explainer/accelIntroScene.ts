// [動画連携] 「DD速度センサー」固定場面：ダッシュボードの加速度センサー（lib/accelSensor.ts、
// summarizeAccelForVideo）の実績を、AIを介さずそのまま場面にする（stockIntroScenes.tsと同じ方針＝
// 数値はダッシュボードの実データをそのまま使い、AIには作文させない）。accelが無い（未計算・未対応銘柄）
// 場合や、標本となるエピソードが無い場合はnullを返す（呼び出し側はその場面を単に足さないだけでよい）。
import { newSceneId, minSecFor } from './scriptModel';
import { emptyVisual } from './types';
import type { ExplainerScene, AccelSummary } from './types';
import { integerToKana } from '../videoReading';
import { pctKana, monthDayKana } from '../videoMarketUpdate';

function rateAt(rates: AccelSummary['overall']['rates'], threshold: number) {
  return rates.find((r) => Math.abs(r.threshold - threshold) < 1e-9) ?? null;
}

export function buildAccelIntroScene(accel: AccelSummary | null | undefined, instrumentLabel: string): ExplainerScene | null {
  if (!accel || accel.episodeCount < 1) return null;
  const yearsInt = Math.max(1, Math.round(accel.periodYears));
  const judgedPct = accel.judgedRate != null ? Math.round(accel.judgedRate * 1000) / 10 : null;

  const bucketLines = accel.buckets.map((b) => {
    const r10 = rateAt(b.rates, 0.10);
    const r10Pct = r10?.p != null ? Math.round(r10.p * 1000) / 10 : null;
    return { bucket: b, r10Pct };
  });

  const items = [
    { label: '全体', value: String(accel.judgedCount), text: `−5%まで到達（全${accel.episodeCount}回中）`, icon: 'chartDown' as const },
    ...bucketLines.map(({ bucket, r10Pct }) => ({
      label: bucket.label, value: String(bucket.n),
      text: r10Pct != null ? `さらに−10%以上：${r10Pct}%` : 'さらに−10%以上：参考値なし（標本不足）',
      icon: 'chartDown' as const,
    })),
  ];

  const bucketNarr = bucketLines
    .map(({ bucket, r10Pct }) => `${bucket.label}だった${bucket.n}回では、その後さらにマイナス10%まで進んだのが${r10Pct != null ? `${r10Pct}%` : '参考値なし（標本不足）'}`)
    .join('。');
  const bucketReading = bucketLines
    .map(({ bucket, r10Pct }) => `${bucket.label}だった、${integerToKana(bucket.n)}かいでは、そのあと、さらに、まいなす、じゅっぱーせんとまで、すすんだのが、${r10Pct != null ? pctKana(r10Pct, false) : 'さんこうちなし'}`)
    .join('。');

  let currentNarr = '';
  let currentReading = '';
  if (accel.current) {
    const c = accel.current;
    const [, m, d] = (c.startDate ?? '').split('-').map(Number);
    const dateJp = m && d ? `${m}月${d}日` : '直近';
    const dateReading = m && d ? monthDayKana(m, d) : 'ちょっきん';
    if (c.status === 'reached5' && c.acc != null) {
      currentNarr = `今回は${dateJp}にマイナス3%へ到達し、${c.acc}営業日でマイナス5%まで進みました（${c.bucketLabel ?? ''}区分）。`;
      currentReading = `こんかいは、${dateReading}に、まいなす、さんぱーせんとへ、とうたつし、${integerToKana(c.acc)}えいぎょうびで、まいなす、ごぱーせんとまで、すすみました。`;
    } else if (c.status === 'over3' && c.elapsedDays != null) {
      currentNarr = `今回は${dateJp}にマイナス3%へ到達し、${c.elapsedDays}営業日が経過しています（まだマイナス5%には届いていません）。`;
      currentReading = `こんかいは、${dateReading}に、まいなす、さんぱーせんとへ、とうたつし、${integerToKana(c.elapsedDays)}えいぎょうびが、けいかしています。まだ、まいなす、ごぱーせんとには、とどいていません。`;
    }
  }

  const narration = `過去${yearsInt}年間で、${instrumentLabel}のDD（ドローダウン）がマイナス3%まで進んだ局面は${accel.episodeCount}回。そのうちマイナス5%まで進んだのは${accel.judgedCount}回（${judgedPct ?? '―'}%）でした。${bucketNarr}。${currentNarr}`;
  const reading = `かこ、${integerToKana(yearsInt)}ねんかんで、どろーだうんが、まいなす、さんぱーせんとまで、すすんだ、きょくめんは、${integerToKana(accel.episodeCount)}かい。そのうち、まいなす、ごぱーせんとまで、すすんだのは、${integerToKana(accel.judgedCount)}かいです。${bucketReading}。${currentReading}`;

  return {
    id: newSceneId(), title: 'DD速度センサー', caption: `DD速度センサー：到達の速さ別の実績（過去${yearsInt}年・${accel.episodeCount}局面）`,
    narration, reading,
    visual: { ...emptyVisual('bar'), heading: 'DD速度センサー', subheading: `−3%→−5%への到達の速さ別（過去${yearsInt}年・${instrumentLabel}）`, items, unit: '回', source: `${instrumentLabel}の実績データ（過去${yearsInt}年、ダッシュボードの加速度センサーと同一ロジック）` },
    chapter: 0, minSec: minSecFor('bar'), imageId: null,
  };
}
