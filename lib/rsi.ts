// RSI（相対力指数）：直近N日の値上がり幅と値下がり幅の比から、買われすぎ（70以上）・売られすぎ（30以下）の目安を0〜100で表す。
// 計算はワイルダー方式（J. Welles Wilder の原典。証券会社のチャートで一般的な方式）：
//   最初のN日分の上げ幅・下げ幅の単純平均から始め、以降は 平均 = (前日の平均 ×(N−1) ＋ 当日の値) ÷ N で平滑化する。
//   RSI = 100 − 100 ÷ (1 ＋ 平均上げ幅 ÷ 平均下げ幅)。下げが一度も無ければ100。
// 最初のN日はRSIを計算できないため null。テスト：lib/rsi.test.ts
export function computeRsi(closes: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = closes[i] - closes[i - 1];
    if (ch > 0) gain += ch; else loss -= ch;
  }
  gain /= period; loss /= period;
  const rsiOf = (g: number, l: number) => (l === 0 ? (g === 0 ? 50 : 100) : 100 - 100 / (1 + g / l));
  out[period] = Number(rsiOf(gain, loss).toFixed(1));
  for (let i = period + 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    gain = (gain * (period - 1) + Math.max(0, ch)) / period;
    loss = (loss * (period - 1) + Math.max(0, -ch)) / period;
    out[i] = Number(rsiOf(gain, loss).toFixed(1));
  }
  return out;
}
