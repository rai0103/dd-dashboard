// [動画連携] 「DD速度センサー」固定場面：ダッシュボードの加速度センサー（lib/accelSensor.ts、
// summarizeAccelForVideo）の実績を、AIを介さずそのまま場面にする（stockIntroScenes.tsと同じ方針＝
// 数値はダッシュボードの実データをそのまま使い、AIには作文させない）。accelが無い（未計算・未対応銘柄）
// 場合や、標本となるエピソードが無い場合はnullを返す（呼び出し側はその場面を単に足さないだけでよい）。
import { newSceneId, minSecFor } from './scriptModel';
import { emptyVisual } from './types';
import type { ExplainerScene, AccelSummary, BranchSpec } from './types';
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
  const reading = `かこ、${integerToKana(yearsInt)}ねんかんで、げらくりつが、まいなす、さんぱーせんとまで、すすんだ、きょくめんは、${integerToKana(accel.episodeCount)}かい。そのうち、まいなす、ごぱーせんとまで、すすんだのは、${integerToKana(accel.judgedCount)}かいです。${bucketReading}。${currentReading}`;

  return {
    id: newSceneId(), title: 'DD速度センサー', caption: `DD速度センサー：到達の速さ別の実績（過去${yearsInt}年・${accel.episodeCount}局面）`,
    narration, reading,
    visual: { ...emptyVisual('bar'), heading: 'DD速度センサー', subheading: `−3%→−5%への到達の速さ別（過去${yearsInt}年・${instrumentLabel}）`, items, unit: '回', source: `${instrumentLabel}の実績データ（過去${yearsInt}年、ダッシュボードの加速度センサーと同一ロジック）` },
    chapter: 0, minSec: minSecFor('bar'), imageId: null,
  };
}


// [Stage E-10] 「DD速度センサー」分岐場面：今回のDD局面が「-3%（分岐の起点）」からどちらに進んだかを、
// 実績の分岐図（kind:'branch'）で見せる。線の形自体は見やすさ優先の模式図だが、パネルの数値はすべて
// accel（summarizeAccelForVideo）由来の実データ。今回の結末がまだ確定していない（status:'over3'）、
// または進行中の局面が無い（status:'normal'）ときは、まだ語れることが無いためnullを返す。
export function buildAccelBranchScene(accel: AccelSummary | null | undefined, instrumentLabel: string): ExplainerScene | null {
  if (!accel || accel.episodeCount < 1 || !accel.current || accel.current.status !== 'reached5') return null;
  const cur = accel.current;
  const yearsInt = Math.max(1, Math.round(accel.periodYears));
  const judgedPct = accel.judgedRate != null ? Math.round(accel.judgedRate * 1000) / 10 : null;
  const recoverPct = judgedPct != null ? Math.round((100 - judgedPct) * 10) / 10 : null;
  const recoverCount = accel.episodeCount - accel.judgedCount;
  const rate = (th: number) => {
    const r = accel.overall.rates.find((x) => Math.abs(x.threshold - th) < 1e-9);
    return r?.p != null ? Math.round(r.p * 1000) / 10 : null;
  };
  const r08 = rate(0.08), r10 = rate(0.10), r15 = rate(0.15), r20 = rate(0.20);

  const leadX = Math.max(1, cur.acc ?? 1);
  const leadN = -(cur.currentDD ?? cur.maxDD ?? 0) * 100;
  const span = leadX * 1.6;
  const downDepth = Math.min(leadN * 1.5, leadN - 3);
  const branch: BranchSpec = {
    lead: [{ x: 0, n: 0 }, { x: leadX, n: leadN }],
    thresholdY: -3, thresholdLabel: '-3%（分岐の起点）',
    outcomes: [
      {
        key: 'recover', label: '新高値を回復', tone: 'up',
        path: [{ x: leadX, n: leadN }, { x: leadX + span, n: 0 }],
        stat: { title: '−5%を超えなかった場合', lines: [
          `過去${yearsInt}年・DD−3%到達${accel.episodeCount}回中 ${recoverCount}回（${recoverPct ?? '―'}%）`,
        ] },
      },
      {
        key: 'deeper', label: 'さらに下落（今回はこちら）', tone: 'down',
        path: [{ x: leadX, n: leadN }, { x: leadX + span, n: downDepth }],
        stat: { title: '−5%を超えた場合（今回はこちら）', lines: [
          `過去${yearsInt}年・DD−3%到達${accel.episodeCount}回中 ${accel.judgedCount}回（${judgedPct ?? '―'}%）`,
          `その後さらに：−8%以上${r08 ?? '―'}%／−10%以上${r10 ?? '―'}%`,
          `−15%以上${r15 ?? '―'}%／−20%以上${r20 ?? '―'}%`,
        ] },
      },
    ],
  };

  const narration = `DD−3%の局面は、その後「−5%を超えて進む」か「−5%の前に新高値を回復する」かに分かれます。過去${yearsInt}年・${accel.episodeCount}回では、回復が${recoverCount}回（${recoverPct ?? '―'}%）、−5%超えが${accel.judgedCount}回（${judgedPct ?? '―'}%）。今回は${cur.acc}営業日で−5%を超えた、−5%超え側に当たります。`;
  const reading = `げらくりつ、まいなす、さんぱーせんとの、きょくめんは、そのあと、まいなす、ごぱーせんとを、こえてすすむか、まいなす、ごぱーせんとのまえに、しんたかねを、かいふくするかに、わかれます。かこ、${integerToKana(yearsInt)}ねん、${integerToKana(accel.episodeCount)}かいでは、かいふくが、${integerToKana(recoverCount)}かい、まいなす、ごぱーせんと、こえが、${integerToKana(accel.judgedCount)}かいです。こんかいは、${integerToKana(cur.acc ?? 0)}えいぎょうびで、まいなす、ごぱーせんとを、こえた、こえがわに、あたります。`;

  return {
    id: newSceneId(), title: 'DD速度センサー（分岐）', caption: `今回のDD−3%、その後はどちら？（過去${yearsInt}年・${accel.episodeCount}局面）`,
    narration, reading,
    visual: { ...emptyVisual('branch'), heading: '今回のDD−3%、その後はどちらに？', subheading: `過去${yearsInt}年・DD−3%到達${accel.episodeCount}回の分岐`, branch, source: `${instrumentLabel}の実績データ（過去${yearsInt}年、ダッシュボードの加速度センサーと同一ロジック）` },
    chapter: 0, minSec: minSecFor('line'), imageId: null,
  };
}

/** [動画連携] 「DD速度センサー」関連の固定場面をまとめて組み立てる（①速度区分の棒グラフ、②今回の分岐図）。
 * ②は今回のDD局面がすでに−5%を超えて確定している時だけ追加される。 */
export function buildAccelScenes(accel: AccelSummary | null | undefined, instrumentLabel: string): ExplainerScene[] {
  return [buildAccelIntroScene(accel, instrumentLabel), buildAccelBranchScene(accel, instrumentLabel)].filter((s): s is ExplainerScene => !!s);
}
