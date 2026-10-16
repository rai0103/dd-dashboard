// DD戦略シミュレーション（VOOガチホに勝てるかの検証機能）。
// 平常時も含め常に、確率（QQQが過去にVOOをどれだけの割合で上回ってきたか＝実績優位確率）だけを根拠に
// ベースのQQQ比率を持ち、それに加えて「最高値比（VOOのATHからの下落率）」「経過日数（直近ATH・DD-3%到達からの
// 営業日数）」「DD加速度アラート（速度区分）」の3指標からDD局面での上乗せ（押し目買い）・縮小（現金化）を
// 日次で機械的に決める。その日のVOO・QQQ終値で約定したと仮定して評価額を都度シミュレーションする。
// 「このDD戦略を忠実に実行していたら、VOO100%保有より良い成績になるか」を検証するための機能であり、投資助言ではない。
// 各日の判断はその日までのデータだけを使う（将来の情報は使わない＝ルックアヘッドバイアス無し。実績優位確率も
// 「その日までに完結した期間」だけの拡大窓＝expanding windowで算出する）。統計値・ルールは一切ハードコードした
// 結果を保持せず、渡された価格系列から毎回算出する。過去のチャートは「現時点のルールを全期間に適用し続けていたら
// どうなっていたか」を表示するものであり、将来ルールを見直しても、見直し後のルールで全履歴を再計算する。
// このファイルは外部importを持たない純粋関数のみで構成し、`node --test` から直接実行できるようにしている。

export type TacticalDayInput = { date: Date; voo: number; qqq: number };

export type SpeedLevel = "normal" | "pending5" | "confirmed5" | "deep8";
export type SpeedCategory = "fast" | "mid" | "slow" | null;

// DD加速度アラートと同じ定義（components/DDDashboard.jsx の classifySpeed35 と揃える）：
// DD-3%→DD-5%到達が5営業日以内なら急落、21営業日以上なら緩慢、それ以外は中間。
export function classifySpeed35(days: number): "fast" | "mid" | "slow" {
  if (days <= 5) return "fast";
  if (days >= 21) return "slow";
  return "mid";
}

// 底値判定（lib/bottomScore.ts）の深度バケットと同じ区切り（上限 < dd <= 下限）。
export const DEPTH_BUCKETS: { key: string; label: string; upper: number; lower: number }[] = [
  { key: "3-5", label: "-3〜-5%", upper: -3, lower: -5 },
  { key: "5-8", label: "-5〜-8%", upper: -5, lower: -8 },
  { key: "8-10", label: "-8〜-10%", upper: -8, lower: -10 },
  { key: "10-15", label: "-10〜-15%", upper: -10, lower: -15 },
  { key: "15-20", label: "-15〜-20%", upper: -15, lower: -20 },
  { key: "20-30", label: "-20〜-30%", upper: -20, lower: -30 },
  { key: "30+", label: "-30%超", upper: -30, lower: -Infinity },
];
export function depthBucketIndex(dd: number): number {
  if (dd > DEPTH_BUCKETS[0].upper) return -1;
  return DEPTH_BUCKETS.findIndex((b) => dd <= b.upper && dd > b.lower);
}

export type TacticalState = {
  idx: number;
  date: Date;
  currentDD: number; // 最高値比：VOOのATHからの下落率（%・0以下）
  daysSinceATH: number; // 経過日数：直近ATHからの営業日数
  speedLevel: SpeedLevel; // DD加速度アラートの段階（normal/pending5/confirmed5/deep8）
  speedCategory: SpeedCategory; // DD-3→5%到達の速度区分（confirmed5以降で確定。fast=急落・警戒、slow=緩慢・安心寄り）
  depthBucketIndex: number; // -1=DD>-3%（バケット対象外）、0〜6=DEPTH_BUCKETSの該当段
  daysSinceDD3?: number | null; // 最高値比-3%到達からの営業日数（pending5時、急落/緩慢の分岐まで残り日数の算出に使う）
};

/* ---------------- 1. 日次状態の追跡（増分計算：全期間を通しても計算量はO(日数)） ---------------- */

// VOOの価格系列から、各日の最高値比・経過日数・DD加速度アラート状態を1回のパスで算出する。
export function deriveTacticalStates(days: { date: Date; voo: number }[]): TacticalState[] {
  const out: TacticalState[] = [];
  let athPrice = -Infinity, athIdx = -1;
  let idx3 = -1, idx5 = -1; // 現在のエピソード内でDD-3%・DD-5%に初めて到達した日のインデックス
  for (let i = 0; i < days.length; i++) {
    const price = days[i].voo;
    if (price >= athPrice) {
      athPrice = price; athIdx = i; idx3 = -1; idx5 = -1; // 新しいATH＝エピソードをリセット
    }
    const currentDD = athPrice > 0 ? ((price / athPrice) - 1) * 100 : 0;
    if (currentDD <= -3 && idx3 === -1) idx3 = i;
    if (currentDD <= -5 && idx5 === -1) idx5 = i;
    const daysSinceATH = i - athIdx;
    const bi = depthBucketIndex(currentDD);
    let speedLevel: SpeedLevel = "normal";
    let speedCategory: SpeedCategory = null;
    if (currentDD <= -8) {
      speedLevel = "deep8";
      if (idx3 !== -1 && idx5 !== -1) speedCategory = classifySpeed35(idx5 - idx3);
    } else if (currentDD <= -5) {
      speedLevel = "confirmed5";
      if (idx3 !== -1 && idx5 !== -1) speedCategory = classifySpeed35(idx5 - idx3);
    } else if (currentDD <= -3) {
      speedLevel = "pending5";
    }
    const daysSinceDD3 = idx3 === -1 ? null : i - idx3;
    out.push({ idx: i, date: days[i].date, currentDD, daysSinceATH, speedLevel, speedCategory, depthBucketIndex: bi, daysSinceDD3 });
  }
  return out;
}

/* ---------------- 2. ルール（v2）：確率ベースのベースQQQ比率 + DD局面での上乗せ/縮小 ---------------- */
// 平常時にVOO100%だけでは、QQQがVOOを上回ってきた分の上昇を一切取りに行けず消極的すぎる。そこで平常時も含め
// 常に、「QQQがVOOをどれだけの割合で上回ってきたか」という実績優位確率pだけを根拠に、確率に応じたベースの
// QQQ比率を持つ（p=50%＝互角ならQQQ0%、p=100%＝常にQQQが勝っていたならQQQ上限まで＝確率に比例したリスクを取る）。
// pは「その日までに完結した保有期間（PROB_WINDOW_DAYS営業日）」だけを使う拡大窓統計で、ハードコードせず価格系列
// から毎回算出し、将来の情報は使わない（ルックアヘッド無し）。
// DD局面（最高値比-3%以降）では、このベースに対してDD加速度アラートで上乗せ・縮小する：
// 「急落・警戒（fast）」ならベースのQQQもいったん解消して守りを固め現金比率を上げる（近い将来の下落リスクを
// 優先）。「それ以外（緩慢・安心寄り／速度未確定）」ならベースに押し目買い分を上乗せする（優位確率が高いほど
// 元々ベースが大きいため、合計のQQQ比率もその分大きくなる＝確率に応じたリスクを取る）。
export const PROB_WINDOW_DAYS = 252; // 実績優位確率の算出に使う保有期間（営業日、約1年）
export const BASE_QQQ_CAP = 0.3; // 確率ベースのベースQQQ比率の上限（p=100%のときの比率）
export const DIP_QQQ_TOTAL_CAP = 0.5; // ベース＋押し目買いを合わせたQQQ比率の総上限（リスク管理のための頭打ち）

// 各日時点で、「その日までに完結したPROB_WINDOW_DAYS保有期間のうち、QQQがVOOのトータルリターンを上回った割合」
// を拡大窓（expanding window）で算出する。将来のデータは一切使わない。まだ1期分も完結していない期間はp=0.5
// （優位性データ不足＝ベース比率0%）として扱う。
export function computeQqqEdgeProbabilities(mergedDays: { voo: number; qqq: number }[]): number[] {
  const n = mergedDays.length;
  const probs: number[] = new Array(n).fill(0.5);
  let wins = 0, total = 0;
  for (let i = 0; i < n; i++) {
    const startIdx = i - PROB_WINDOW_DAYS;
    if (startIdx >= 0) {
      const a = mergedDays[startIdx], b = mergedDays[i];
      total++;
      if (b.qqq / a.qqq > b.voo / a.voo) wins++;
    }
    probs[i] = total > 0 ? wins / total : 0.5;
  }
  return probs;
}

// 実績優位確率pから、確率に比例したベースQQQ比率を算出する（p<=50%は優位性なしとしてQQQ0%）。
export function baseQqqWeightFromProbability(p: number): number {
  const edge = Math.max(0, Math.min(1, (p - 0.5) * 2)); // p=0.5→0、p=1.0→1に線形写像
  return Number((edge * BASE_QQQ_CAP).toFixed(4));
}

export const RULE_VERSION = "v2";
export type TargetWeights = { qqq: number; voo: number; cash: number }; // 合計1

// baseProbは当日時点の実績優位確率p（未指定時は0.5＝優位性なし扱いでベースQQQ0%、v1相当の挙動に一致）。
export function decideTargetWeights(state: TacticalState, baseProb: number = 0.5): { weights: TargetWeights; reason: string } {
  const baseQqq = baseQqqWeightFromProbability(baseProb);
  const baseLabel = baseQqq > 0.0001 ? `ベースQQQ${Math.round(baseQqq * 100)}%（QQQ実績優位確率${Math.round(baseProb * 100)}%）` : "優位性データ不足/互角のためベースQQQ0%";
  if (state.depthBucketIndex === -1) {
    return { weights: { qqq: baseQqq, voo: 1 - baseQqq, cash: 0 }, reason: `平常時（最高値比-3%未満）：${baseLabel}` };
  }
  const bi = state.depthBucketIndex;
  const label = DEPTH_BUCKETS[bi].label;
  if (state.speedLevel === "pending5") {
    const qqq = Math.min(DIP_QQQ_TOTAL_CAP, baseQqq + 0.04);
    return { weights: { qqq, voo: 1 - qqq, cash: 0 }, reason: `最高値比${label}・速度未確定：${baseLabel}+試し玉4%＝QQQ${Math.round(qqq * 100)}%` };
  }
  if (state.speedCategory === "fast") {
    const cash = Math.min(0.2, bi * 0.04);
    return { weights: { qqq: 0, voo: 1 - cash, cash }, reason: `最高値比${label}・DD加速度アラート「急落・警戒」：ベースQQQもいったん解消し守りを固め現金${Math.round(cash * 100)}%` };
  }
  const dip = Math.min(0.24, (bi + 1) * 0.04);
  const qqq = Math.min(DIP_QQQ_TOTAL_CAP, baseQqq + dip);
  const speedNote = state.speedCategory === "slow" ? "緩慢・安心寄り" : "速度中間/未確定（緩慢寄りとして扱う）";
  return { weights: { qqq, voo: 1 - qqq, cash: 0 }, reason: `最高値比${label}・DD加速度アラート「${speedNote}」：${baseLabel}+押し目買い${Math.round(dip * 100)}%＝QQQ${Math.round(qqq * 100)}%` };
}

/* ---------------- 3. バックテスト・シミュレーション ---------------- */

export type TacticalTrade = { idx: number; date: Date; from: TargetWeights; to: TargetWeights; reason: string };
export type TacticalDayResult = {
  idx: number; date: Date; voo: number; qqq: number;
  state: TacticalState; weights: TargetWeights; reason: string;
  equity: number; vooHoldEquity: number;
};
export type TacticalBacktestResult = {
  ruleVersion: string;
  days: TacticalDayResult[];
  trades: TacticalTrade[];
  startDate: Date; endDate: Date; startCapital: number;
  finalEquity: number; finalVooHoldEquity: number;
  outperformancePct: number; // 戦略評価額がVOO100%保有に対して何%上（＋）か下（−）か
  outperformanceAmount: number;
  strategyMaxDD: number; vooMaxDD: number; // 比較用の評価額ベース最大下落率（%、負値）
};

// VOO・QQQの両方に値がある日だけを対象にする（date文字列=YYYY-MM-DDで突き合わせ）。
export function mergeVooQqqForTactical(vooSeries: { date: Date; price: number }[], qqqSeries: { date: Date; price: number }[]): TacticalDayInput[] {
  const qByDate = new Map(qqqSeries.map((p) => [p.date.toISOString().slice(0, 10), p.price]));
  const out: TacticalDayInput[] = [];
  for (const v of vooSeries) {
    const q = qByDate.get(v.date.toISOString().slice(0, 10));
    if (q != null) out.push({ date: v.date, voo: v.price, qqq: q });
  }
  out.sort((a, b) => a.date.getTime() - b.date.getTime());
  return out;
}

function maxDrawdown(values: number[]): number {
  let peak = -Infinity, mdd = 0;
  for (const v of values) { peak = Math.max(peak, v); mdd = Math.min(mdd, (v / peak - 1) * 100); }
  return mdd;
}

// QQQの取り込み開始日（＝VOO・QQQ両方のデータが揃う最初の日）からの全期間バックテスト。
// 新しい日次データが追加されるたびに呼び出し側が再実行すれば、1日ずつ自動的に延長される。
export function simulateTacticalStrategy(mergedDays: TacticalDayInput[], startCapital = 10000): TacticalBacktestResult | null {
  if (mergedDays.length < 2) return null;
  const states = deriveTacticalStates(mergedDays.map((d) => ({ date: d.date, voo: d.voo })));
  const probs = computeQqqEdgeProbabilities(mergedDays);
  const days: TacticalDayResult[] = [];
  const trades: TacticalTrade[] = [];
  let qqqShares = 0, vooShares = 0, cash = 0;
  let prevWeights: TargetWeights | null = null;
  const voo0 = mergedDays[0].voo;
  for (let i = 0; i < mergedDays.length; i++) {
    const { voo, qqq, date } = mergedDays[i];
    const state = states[i];
    const equityMarked = i === 0 ? startCapital : qqqShares * qqq + vooShares * voo + cash;
    const { weights, reason } = decideTargetWeights(state, probs[i]);
    if (!prevWeights || prevWeights.qqq !== weights.qqq || prevWeights.cash !== weights.cash) {
      trades.push({ idx: i, date, from: prevWeights ?? weights, to: weights, reason });
    }
    qqqShares = (equityMarked * weights.qqq) / qqq;
    vooShares = (equityMarked * weights.voo) / voo;
    cash = equityMarked * weights.cash;
    prevWeights = weights;
    const vooHoldEquity = startCapital * (voo / voo0);
    days.push({ idx: i, date, voo, qqq, state, weights, reason, equity: equityMarked, vooHoldEquity });
  }
  const last = days[days.length - 1];
  const finalEquity = last.equity, finalVooHoldEquity = last.vooHoldEquity;
  return {
    ruleVersion: RULE_VERSION, days, trades,
    startDate: days[0].date, endDate: last.date, startCapital,
    finalEquity, finalVooHoldEquity,
    outperformancePct: Number(((finalEquity / finalVooHoldEquity - 1) * 100).toFixed(2)),
    outperformanceAmount: Number((finalEquity - finalVooHoldEquity).toFixed(2)),
    strategyMaxDD: Number(maxDrawdown(days.map((d) => d.equity)).toFixed(2)),
    vooMaxDD: Number(maxDrawdown(days.map((d) => d.vooHoldEquity)).toFixed(2)),
  };
}

/* ---------------- 4. 表示用：次に取るべき具体的なアクション（指値・逆指値の目安） ---------------- */
// DD加速度アラート（速度区分）と底値判定（深度バケット）を組み合わせ、「次に何をするか」を具体的な
// アクション（一時避難の現金化 / QQQへのナンピン買い / ポジション解消）と、その目安価格（指値・逆指値）として
// 提示する。速度未確定（pending5）の間は、同じ-5%到達価格が、到達までの営業日数次第で現金化・押し目買いの
// どちらにも転びうるため、両方の分岐を並べて見せる。

export type TacticalActionKind =
  | "watch" // 平常時：次に-3%へ到達しDD戦略が作動し始める監視ライン
  | "pending_fast" // 速度未確定：急落判定（現金化）側の分岐
  | "pending_slow" // 速度未確定：緩慢判定（押し目買い）側の分岐
  | "cash_up" // 急落・警戒：次に現金比率を積み増す節目（一時避難）
  | "qqq_buy" // 緩慢・安心寄り：次にQQQを買い増す節目（ナンピン買い）
  | "capped" // 現金20%／QQQ24%の上限に到達済み：これ以上は深掘りしても増やさない
  | "exit_voo100"; // 直近ATH更新でVOO100%に復帰（ポジション解消）

export type TacticalNextAction = {
  kind: TacticalActionKind;
  orderType: string | null; // 表示用ラベル（例："指値（押し目買い）"「逆指値（現金化）」）
  label: string;
  price: number | null;
};

export type TacticalProposal = {
  state: TacticalState; weights: TargetWeights; reason: string;
  actions: TacticalNextAction[]; // 次に取るべき具体的なアクション（状況により複数件になる）
  nextBuyTrigger: { depthLabel: string; price: number } | null; // 互換用：次の節目の深度ラベルと価格
  exitTrigger: { label: string; price: number } | null; // 互換用：ポジション解消（VOO100%に戻る）の目安
};

// athPriceは渡さず、最終日のVOO終値と最高値比（currentDD）から直近ATH価格を逆算する
// （シミュレーションに使った系列自身のATHと必ず一致させるため。VOO単体の系列と日付がずれる余地をなくす）。
export function describeTacticalProposal(result: TacticalBacktestResult): TacticalProposal {
  const last = result.days[result.days.length - 1];
  const state = last.state;
  const athPrice = last.voo / (1 + state.currentDD / 100);
  const { weights, reason } = last; // 当日のシミュレーション計算（実績優位確率を反映済み）をそのまま使う
  const bi = state.depthBucketIndex;
  const nextBucket = bi === -1 ? DEPTH_BUCKETS[0] : DEPTH_BUCKETS[bi + 1];
  const nextPrice = nextBucket ? Number((athPrice * (1 + nextBucket.upper / 100)).toFixed(2)) : null;
  const exitTrigger = bi === -1 ? null : { label: "直近ATH更新で平常時のベース比率に復帰", price: Number(athPrice.toFixed(2)) };
  const atCap = bi >= 5; // 現金20%・QQQ24%の上限に到達済み（depthBucketIndex=5以降は深掘りしても増えない）

  const actions: TacticalNextAction[] = [];

  if (bi === -1) {
    if (nextPrice != null) {
      actions.push({ kind: "watch", orderType: "警戒ライン", label: "最高値比-3%（押し目買い/現金化の判定が始まるライン）", price: nextPrice });
    }
  } else if (state.speedLevel === "pending5") {
    const remainDays = state.daysSinceDD3 != null ? Math.max(0, 5 - state.daysSinceDD3) : null;
    const remainNote = remainDays != null ? `（-3%到達から、あと${remainDays}営業日以内の到達で急落判定）` : "";
    if (nextPrice != null) {
      actions.push({ kind: "pending_fast", orderType: "逆指値（現金化）", label: `最高値比-5%に急落到達${remainNote} → 一時避難で現金化`, price: nextPrice });
      actions.push({ kind: "pending_slow", orderType: "指値（押し目買い）", label: "最高値比-5%に緩やかに到達（6営業日目以降） → QQQ押し目買い（ナンピン）", price: nextPrice });
    }
  } else if (state.speedCategory === "fast") {
    if (atCap) {
      actions.push({ kind: "capped", orderType: null, label: "現金比率はすでに上限20%。これ以上深掘りしても増やしません", price: null });
    } else if (nextPrice != null && nextBucket) {
      actions.push({ kind: "cash_up", orderType: "逆指値（現金積み増し）", label: `次の節目 最高値比${nextBucket.label}で現金比率を追加（一時避難を強化）`, price: nextPrice });
    }
  } else {
    if (atCap) {
      actions.push({ kind: "capped", orderType: null, label: "押し目買い分（ベースQQQを除く）はすでに上限24%。これ以上深掘りしても増やしません", price: null });
    } else if (nextPrice != null && nextBucket) {
      actions.push({ kind: "qqq_buy", orderType: "指値（ナンピン買い）", label: `次の節目 最高値比${nextBucket.label}でQQQを買い増し`, price: nextPrice });
    }
  }

  if (exitTrigger) {
    actions.push({ kind: "exit_voo100", orderType: "逆指値（ポジション解消）", label: exitTrigger.label, price: exitTrigger.price });
  }

  return {
    state, weights, reason, actions,
    nextBuyTrigger: nextBucket && nextPrice != null ? { depthLabel: nextBucket.label, price: nextPrice } : null,
    exitTrigger,
  };
}
