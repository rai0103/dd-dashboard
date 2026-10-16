// SP500とQQQ（Nasdaq-100）の相関関係：SP500の下落エピソードごとに、同じ期間でQQQ自身がどこまで
// 下がったかを測り、SP500の深度バケット別に「QQQの下落率 ÷ SP500の下落率」の増幅率を集計する。
// 「SP500がこの深さまで落ちた時、過去はQQQが何倍下がる傾向があったか」を深度バケット別に示す統計であり、
// DD戦略（lib/ddTacticalStrategy.ts）のQQQ配分判断に、この相関関係を反映させるために使う。
// bottomScore.tsのEpisode・DEPTH_BUCKETSと同じ区切りを使う。このファイルもbottomScore.ts以外に外部importを
// 持たない純粋関数のみで構成し、`node --test` から直接実行できるようにしている。
import { type Episode, DEPTH_BUCKETS, depthBucketIndex, computeDrawdowns, LOW_SAMPLE_N } from "./bottomScore.ts";

export type AmpBucketStat = {
  key: string; label: string;
  n: number; // 集計に使ったSP500エピソード件数
  medianRatio: number | null; // QQQの最大DD ÷ SP500の最大DD（1.0=同程度、2.0=QQQが2倍下がる傾向）
  lowSample: boolean;
};

function median(a: number[]): number | null {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

function emptyResult(): AmpBucketStat[] {
  return DEPTH_BUCKETS.map((b) => ({ key: b.key, label: b.label, n: 0, medianRatio: null, lowSample: true }));
}

// spEpisodes: SP500価格系列から検出済みのエピソード（bottomScore.detectEpisodes、resolve_idx===nullの
// 未解消エピソードは深度が確定していないため自動的に除外される）。
// qqqDates・qqqPrices: 同じ通貨・同じ粒度のQQQ日次終値（date昇順、price配列と添字が対応）。
// SP500エピソードのATH日〜底値日のウィンドウが丸ごとQQQのデータ範囲に収まるものだけを対象にする
// （既存のcomputeQqqAmplificationStats＝components/DDDashboard.jsxと同じ判定条件）。
export function computeDepthConditionalQqqAmplification(spEpisodes: Episode[], qqqDates: Date[], qqqPrices: number[]): AmpBucketStat[] {
  if (!qqqPrices.length || !qqqDates.length) return emptyResult();
  const { dd } = computeDrawdowns(qqqPrices);
  const idxByDate = new Map<string, number>();
  for (let i = 0; i < qqqDates.length; i++) idxByDate.set(qqqDates[i].toISOString().slice(0, 10), i);
  const qStart = qqqDates[0], qEnd = qqqDates[qqqDates.length - 1];
  const byBucket: number[][] = DEPTH_BUCKETS.map(() => []);
  for (const ep of spEpisodes) {
    if (ep.resolve_idx === null || !ep.pre_ath_date || !ep.trough_date) continue;
    if (ep.pre_ath_date < qStart || ep.trough_date > qEnd) continue;
    const si = idxByDate.get(ep.pre_ath_date.toISOString().slice(0, 10));
    const ei = idxByDate.get(ep.trough_date.toISOString().slice(0, 10));
    if (si === undefined || ei === undefined || ei < si) continue;
    let qMinDD = 0;
    for (let i = si; i <= ei; i++) if (dd[i] < qMinDD) qMinDD = dd[i];
    if (qMinDD >= 0) continue;
    const ratio = qMinDD / ep.min_dd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    const bi = depthBucketIndex(ep.min_dd);
    if (bi !== -1) byBucket[bi].push(ratio);
  }
  return DEPTH_BUCKETS.map((b, i) => ({
    key: b.key, label: b.label, n: byBucket[i].length,
    medianRatio: byBucket[i].length ? Number(median(byBucket[i])!.toFixed(2)) : null,
    lowSample: byBucket[i].length < LOW_SAMPLE_N,
  }));
}
