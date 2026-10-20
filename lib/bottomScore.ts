// 底値判定：SP500日次終値の全履歴から下落エピソードを検出して各種統計テーブルを都度算出し、
// 現局面のMDD（底値）が確定してATH更新に至る確率を過去の似た状況から算出する。
// 統計値は一切ハードコードせず、渡された価格系列から毎回再計算する（日次データが追加されれば自動的に反映される）。
// このファイルは外部importを持たない純粋関数のみで構成し、`node --test` から直接実行できるようにしている。

export type Episode = {
  pre_ath_idx: number; // 直前ATHのインデックス（dd<0区間の直前日）
  start_idx: number; // dd<0 になった初日
  trough_idx: number; // エピソード内の最安値（min_dd発生日）
  resolve_idx: number | null; // 次のATH到達日。データ終端まで未到達なら null（未解消）
  min_dd: number; // 最大下落率（%、負値）
  pre_ath_date: Date | null;
  trough_date: Date | null;
  resolve_date: Date | null;
};

export const MIN_EPISODE_DD = -3;
export const LOW_SAMPLE_N = 15;

/* ---------------- 1. エピソード検出 ---------------- */

export function computeDrawdowns(prices: number[]): { ath: number[]; dd: number[] } {
  const ath: number[] = [], dd: number[] = [];
  let m = -Infinity;
  for (const p of prices) { m = Math.max(m, p); ath.push(m); dd.push((p - m) / m * 100); }
  return { ath, dd };
}

function toDate(v: Date | string | undefined | null): Date | null {
  if (v == null) return null;
  return v instanceof Date ? v : new Date(v);
}

// dd<0 が連続する区間を1エピソードとし（dd>=0で終了）、min_dd<=minDD のもののみ返す。
export function detectEpisodes(prices: number[], dates?: (Date | string)[], minDD: number = MIN_EPISODE_DD): Episode[] {
  const { dd } = computeDrawdowns(prices);
  const out: Episode[] = [];
  const n = prices.length;
  let i = 1;
  while (i < n) {
    if (dd[i] >= 0) { i++; continue; }
    const start = i;
    let trough = i;
    while (i < n && dd[i] < 0) { if (prices[i] < prices[trough]) trough = i; i++; }
    const resolve = i < n ? i : null;
    if (dd[trough] <= minDD) {
      out.push({
        pre_ath_idx: start - 1, start_idx: start, trough_idx: trough, resolve_idx: resolve, min_dd: dd[trough],
        pre_ath_date: toDate(dates?.[start - 1]), trough_date: toDate(dates?.[trough]), resolve_date: resolve !== null ? toDate(dates?.[resolve]) : null,
      });
    }
  }
  return out;
}

/* ---------------- 2. 統計テーブル ---------------- */

export type DepthBucket = { key: string; label: string; upper: number; lower: number }; // lower < dd <= upper
export const DEPTH_BUCKETS: DepthBucket[] = [
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

// 2-2. 区間[start,end]内で、直近安値から+threshold%以上反発した後、その反発前の安値を再度下回った回数。
export function countFakeRalliesInRange(prices: number[], start: number, end: number, threshold = 3.0): number {
  if (end <= start) return 0;
  let curMin = prices[start], inBounce = false, bounceLow = prices[start], count = 0;
  for (let k = start; k <= end; k++) {
    const p = prices[k];
    if (!inBounce) {
      if (p < curMin) curMin = p;
      else if ((p / curMin - 1) * 100 >= threshold) { inBounce = true; bounceLow = curMin; }
    } else if (p < bounceLow) { count++; curMin = p; inBounce = false; }
  }
  return count;
}

export function countFakeRallies(episode: Episode, prices: number[], threshold = 3.0): number {
  return countFakeRalliesInRange(prices, episode.pre_ath_idx, episode.trough_idx, threshold);
}

// 2-3. 回復局面（trough〜resolve）内で、区間内ローカルATHに対するローカルDDが-threshold%以下になれば二次押し目あり。
// 未解消エピソードは判定対象外（null）。
export function isCleanRecovery(episode: Episode, prices: number[], threshold = 3.0): boolean | null {
  if (episode.resolve_idx === null) return null;
  let localAth = prices[episode.trough_idx];
  for (let k = episode.trough_idx; k <= episode.resolve_idx; k++) {
    localAth = Math.max(localAth, prices[k]);
    if ((prices[k] / localAth - 1) * 100 <= -threshold) return false;
  }
  return true;
}

const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
const round1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);

export type DepthStat = {
  key: string; label: string; upper: number; lower: number;
  n: number; // 解消済みエピソード件数（下落日数・だまし上げ・クリーン回復率すべての母数）
  avgDurationDays: number | null; avgFakeRallyCount: number | null;
  cleanCount: number; cleanRecoveryRate: number | null; lowSample: boolean;
};

// 2-1. 深度バケット別基礎統計。未解消（進行中）のエピソードは底値・深度が確定していないため除外する。
export function computeDepthStats(episodes: Episode[], prices: number[]): DepthStat[] {
  const resolved = episodes.filter((e) => e.resolve_idx !== null);
  return DEPTH_BUCKETS.map((b, bi) => {
    const eps = resolved.filter((e) => depthBucketIndex(e.min_dd) === bi);
    const clean = eps.filter((e) => isCleanRecovery(e, prices) === true).length;
    return {
      ...b, n: eps.length,
      avgDurationDays: round1(mean(eps.map((e) => e.trough_idx - e.pre_ath_idx))),
      avgFakeRallyCount: round1(mean(eps.map((e) => countFakeRallies(e, prices)))),
      cleanCount: clean, cleanRecoveryRate: eps.length ? round1(clean / eps.length * 100) : null,
      lowSample: eps.length < LOW_SAMPLE_N,
    };
  });
}

export const PROGRESSION_LEVELS = [-5, -10, -15, -20, -25, -30, -35, -40, -45];

export type LevelProgressionRow = { from: number; to: number; reached: number; progressed: number; p: number | null; lowSample: boolean };

// 2-4. 節目間進行確率。L(i)到達エピソードを分母、同一局面内でL(i+1)まで到達した数を分子とする。
// 進行中のエピソードは、L(i+1)到達済みなら成功として数え、未到達なら結果未確定のため分母から除外する。
export function computeLevelProgression(prices: number[], levels: number[] = PROGRESSION_LEVELS, episodes?: Episode[]): LevelProgressionRow[] {
  const eps = episodes ?? detectEpisodes(prices);
  const rows: LevelProgressionRow[] = [];
  for (let i = 0; i < levels.length - 1; i++) {
    const from = levels[i], to = levels[i + 1];
    let reached = 0, progressed = 0;
    for (const e of eps) {
      if (e.min_dd > from) continue;
      const hit = e.min_dd <= to;
      if (!hit && e.resolve_idx === null) continue;
      reached++; if (hit) progressed++;
    }
    rows.push({ from, to, reached, progressed, p: reached ? round1(progressed / reached * 100) : null, lowSample: reached < LOW_SAMPLE_N });
  }
  return rows;
}

export type ReboundRow = { anchor: number; nAnchor: number; rungs: { up: number; n: number; hits: number; p: number | null; lowSample: boolean }[] };

// 2-5. 反発確認テーブル。各エピソードでアンカー水準に初到達した日の終値を基準価格とし、
// 以後 rp=(price/anchor_price-1)*100 が rp<0 になる前に各上昇節目まで到達したかを判定する（新ATH更新後も追跡を継続）。
// データ終端までに到達もrp<0も起きなかったケースは結果未確定として、その節目の分母から除外する。
export function computeReboundProgression(prices: number[], anchorLevels = [-5, -8, -10, -15, -20, -25], upLadder = [3, 5, 8, 10, 15, 20, 25, 30], episodes?: Episode[]): ReboundRow[] {
  const eps = episodes ?? detectEpisodes(prices);
  const { dd } = computeDrawdowns(prices);
  const n = prices.length;
  return anchorLevels.map((anchor) => {
    const hits = upLadder.map(() => 0), fails = upLadder.map(() => 0);
    let nAnchor = 0;
    for (const e of eps) {
      if (e.min_dd > anchor) continue;
      let aIdx = e.start_idx;
      while (dd[aIdx] > anchor) aIdx++;
      nAnchor++;
      const ap = prices[aIdx];
      let maxRp = 0, broke = false;
      for (let k = aIdx + 1; k < n; k++) {
        const rp = (prices[k] / ap - 1) * 100;
        if (rp < 0) { broke = true; break; }
        if (rp > maxRp) { maxRp = rp; if (maxRp >= upLadder[upLadder.length - 1]) break; }
      }
      upLadder.forEach((u, j) => { if (maxRp >= u) hits[j]++; else if (broke) fails[j]++; });
    }
    return {
      anchor, nAnchor,
      rungs: upLadder.map((up, j) => { const m = hits[j] + fails[j]; return { up, n: m, hits: hits[j], p: m ? round1(hits[j] / m * 100) : null, lowSample: m < LOW_SAMPLE_N }; }),
    };
  });
}

export type TransitionDays = { from: number; to: number; days: number[]; n: number; median: number | null; mean: number | null; p25: number | null; p75: number | null; lowSample: boolean };

export function percentile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

// 2-6. 節目間所要日数（営業日）。fromLevelとtoLevelの両方に到達したエピソードについて、初到達日の差を集計する。
export function computeLevelTransitionDays(prices: number[], fromLevel = -3, toLevel = -5, episodes?: Episode[]): TransitionDays {
  const eps = episodes ?? detectEpisodes(prices, undefined, Math.max(fromLevel, toLevel, MIN_EPISODE_DD));
  const { dd } = computeDrawdowns(prices);
  const days: number[] = [];
  for (const e of eps) {
    if (e.min_dd > toLevel || e.min_dd > fromLevel) continue;
    const end = e.resolve_idx ?? prices.length;
    let fi = -1, ti = -1;
    for (let k = e.start_idx; k < end && (fi === -1 || ti === -1); k++) {
      if (fi === -1 && dd[k] <= fromLevel) fi = k;
      if (ti === -1 && dd[k] <= toLevel) ti = k;
    }
    days.push(ti - fi);
  }
  const s = [...days].sort((a, b) => a - b);
  return { from: fromLevel, to: toLevel, days, n: days.length, median: percentile(s, 0.5), mean: round1(mean(days)), p25: percentile(s, 0.25), p75: percentile(s, 0.75), lowSample: days.length < LOW_SAMPLE_N };
}

/* ---------------- 統計テーブル一括生成 ---------------- */

export type StatsTable = {
  n: number; // 価格データ件数
  episodes: Episode[];
  depthStats: DepthStat[];
  levelProgression: LevelProgressionRow[];
  reboundTable: ReboundRow[];
  transitionDays: TransitionDays[];
  recoveryMatrix: RecoveryMatrixCell[];
  depthBucket: (dd: number) => DepthStat | null;
};

export const TRANSITION_PAIRS: [number, number][] = [[-3, -5], [-5, -8], [-8, -10], [-10, -15], [-15, -20]];

export function buildStatsTable(prices: number[], dates?: (Date | string)[]): StatsTable {
  const episodes = detectEpisodes(prices, dates);
  const depthStats = computeDepthStats(episodes, prices);
  return {
    n: prices.length, episodes, depthStats,
    levelProgression: computeLevelProgression(prices, undefined, episodes),
    reboundTable: computeReboundProgression(prices, undefined, undefined, episodes),
    transitionDays: TRANSITION_PAIRS.map(([f, t]) => computeLevelTransitionDays(prices, f, t, episodes)),
    recoveryMatrix: computeRecoveryMatrix(prices, undefined, episodes),
    depthBucket: (dd) => { const i = depthBucketIndex(dd); return i === -1 ? null : depthStats[i]; },
  };
}

/* ---------------- 3. 底値（MDD）確定確率 ---------------- */
// 底値＝DD-3%を越えた下落局面における、その時点までの最大下落（MDD）の日。
// 「現在のMDDがこの局面の底値として確定し、それを割らずにATHを更新する」確率を、過去の似た状況から算出する。

export type CurrentState = {
  pre_ath_idx: number; trough_idx: number;
  mdd: number; // 現局面のこれまでのMDD（%、負値）
  latest_dd: number;
  days_since_ath: number; days_since_trough: number;
  recovery_ratio: number; // 底値から直前ATHまでの下落幅のうち、現在までに戻した割合（0=底値、1=ATH）
  bounce_from_low_pct: number;
};

// 価格系列の末尾（最新日）を現在として CurrentState を組み立てる。現局面が dd<0 でなければ null。
export function deriveCurrentState(prices: number[]): CurrentState | null {
  const { dd } = computeDrawdowns(prices);
  const last = prices.length - 1;
  if (last < 1 || dd[last] >= 0) return null;
  let pre = last;
  while (pre > 0 && dd[pre] < 0) pre--;
  let trough = pre + 1;
  for (let k = pre + 1; k <= last; k++) if (prices[k] < prices[trough]) trough = k;
  return {
    pre_ath_idx: pre, trough_idx: trough, mdd: dd[trough], latest_dd: dd[last],
    days_since_ath: last - pre, days_since_trough: last - trough,
    recovery_ratio: (prices[last] - prices[trough]) / (prices[pre] - prices[trough]),
    bounce_from_low_pct: (prices[last] / prices[trough] - 1) * 100,
  };
}

export type HoldCondition = { mddUpper: number; mddLower: number; minRecovery: number; minDaysSinceTrough: number };
export type HoldSample = {
  pre_ath_idx: number; trough_idx: number; sample_idx: number; resolve_idx: number;
  mdd: number; // サンプル時点のMDD
  held: boolean; // true=その底値を割らずにATH更新 / false=底値を割って更に下落
  days_to_ath: number | null; days_to_break: number | null; // サンプル日からの営業日数
  final_mdd: number; // その局面の最終MDD
};

// 解消済みの各局面を日次で走査し、「その時点のMDDが条件レンジ内」かつ「底値から minRecovery 以上戻している」かつ
// 「底値から minDaysSinceTrough 営業日以上経過」を満たした最初の日を、その底値（MDD日）ごとに1サンプルとして採る。
// 結果は、その底値を終値で割るのが先か（底割れ）、ATH更新が先か（底値確定）で判定する。
export function collectHoldSamples(prices: number[], cond: HoldCondition, episodes?: Episode[]): HoldSample[] {
  const eps = (episodes ?? detectEpisodes(prices)).filter((e) => e.resolve_idx !== null);
  const out: HoldSample[] = [];
  for (const e of eps) {
    const athP = prices[e.pre_ath_idx], end = e.resolve_idx!;
    let tr = e.start_idx, lastUsed = -1;
    for (let k = e.start_idx; k < end; k++) {
      if (prices[k] < prices[tr]) tr = k;
      if (tr === lastUsed) continue;
      const mdd = (prices[tr] / athP - 1) * 100;
      if (mdd > cond.mddUpper || mdd <= cond.mddLower) continue;
      if (k - tr < cond.minDaysSinceTrough) continue;
      if ((prices[k] - prices[tr]) / (athP - prices[tr]) < cond.minRecovery) continue;
      lastUsed = tr;
      let brk = -1;
      for (let j = k + 1; j < end; j++) if (prices[j] < prices[tr]) { brk = j; break; }
      out.push({ pre_ath_idx: e.pre_ath_idx, trough_idx: tr, sample_idx: k, resolve_idx: end, mdd, held: brk === -1, days_to_ath: brk === -1 ? end - k : null, days_to_break: brk === -1 ? null : brk - k, final_mdd: e.min_dd });
    }
  }
  return out;
}

/* ---------------- 4. 節目回復統計（反発段階） ---------------- */
// 節目回復：下落エピソード内の各ローカルトラフが、5%刻みの節目(PROGRESSION_LEVELS)を再び下回る前に
// 何段階回復できたか（浅い節目まで戻せたか）を追跡する。computeLevelProgression（深くなる方向の進行確率）
// の鏡写しの指標で、底値判定（computeMddHoldProbability）にも判定材料として組み込む。

function levelIndexReached(dd: number, levels: number[]): number {
  let idx = -1;
  for (let i = 0; i < levels.length; i++) if (dd <= levels[i]) idx = i;
  return idx;
}

export type RecoverySample = HoldSample & {
  fromLevel: number; // 到達した節目（例: -25）
  stepsReached: number; // fromLevelを再び下回る前に到達できた最大の回復段階数（5%刻み、0以上）
};

// 解消済みの各局面を日次で走査し、各ローカルトラフについて、再び同じ安値を下回る（底割れ）前に
// 何段階分浅い節目まで戻せたか（stepsReached）を記録する。最浅の節目（levels[0]）にも届かないトラフは対象外。
export function collectRecoverySamples(prices: number[], levels: number[] = PROGRESSION_LEVELS, episodes?: Episode[]): RecoverySample[] {
  const eps = (episodes ?? detectEpisodes(prices)).filter((e) => e.resolve_idx !== null);
  const { dd } = computeDrawdowns(prices);
  const out: RecoverySample[] = [];
  for (const e of eps) {
    const end = e.resolve_idx!;
    let tr = e.start_idx, lastUsed = -1;
    for (let k = e.start_idx; k < end; k++) {
      if (prices[k] < prices[tr]) tr = k;
      if (tr === lastUsed) continue;
      lastUsed = tr;
      const idx = levelIndexReached(dd[tr], levels);
      if (idx === -1) continue; // 最も浅い節目にも届いていない
      let brk = -1, maxDdSeen = dd[tr];
      for (let j = tr + 1; j <= end; j++) {
        if (prices[j] < prices[tr]) { brk = j; break; }
        if (dd[j] > maxDdSeen) maxDdSeen = dd[j];
      }
      let stepsReached = 0;
      for (let s = idx - 1; s >= 0; s--) { if (maxDdSeen >= levels[s]) stepsReached++; else break; }
      const held = brk === -1;
      out.push({
        pre_ath_idx: e.pre_ath_idx, trough_idx: tr, sample_idx: tr, resolve_idx: end,
        mdd: dd[tr], held, days_to_ath: held ? end - tr : null, days_to_break: held ? null : brk - tr,
        final_mdd: e.min_dd, fromLevel: levels[idx], stepsReached,
      });
    }
  }
  return out;
}

export type RecoveryMatrixCell = {
  fromLevel: number; steps: number; toLevel: number;
  occurrences: number; // fromLevel到達回数
  reached: number; // そのうちsteps段階回復した回数（held不問）
  bottomHeld: number; // そのうちfromLevelを最後まで割らず、かつsteps段階回復した回数
  p: number | null; // 確率 = bottomHeld / occurrences（%）
  lowSample: boolean;
  samples: HoldSample[]; // steps段階回復した事例（held/broke両方。底値判定tierへの転用にそのまま使える）
};

// fromLevel（levelsのうちlevels[1]以降）× steps（1〜そのfromLevelの段位index）の全マス目を生成する。
export function computeRecoveryMatrix(prices: number[], levels: number[] = PROGRESSION_LEVELS, episodes?: Episode[]): RecoveryMatrixCell[] {
  const eps = episodes ?? detectEpisodes(prices);
  const samples = collectRecoverySamples(prices, levels, eps);
  const out: RecoveryMatrixCell[] = [];
  for (let idx = 1; idx < levels.length; idx++) {
    const fromLevel = levels[idx];
    const atLevel = samples.filter((s) => s.fromLevel === fromLevel);
    const occurrences = atLevel.length;
    for (let steps = 1; steps <= idx; steps++) {
      const toLevel = levels[idx - steps];
      const matched = atLevel.filter((s) => s.stepsReached >= steps);
      const bottomHeldSamples = matched.filter((s) => s.held);
      out.push({
        fromLevel, steps, toLevel, occurrences, reached: matched.length, bottomHeld: bottomHeldSamples.length,
        p: occurrences ? round1(bottomHeldSamples.length / occurrences * 100) : null,
        lowSample: occurrences < LOW_SAMPLE_N, samples: matched,
      });
    }
  }
  return out;
}

export type HoldTier = {
  label: string; cond: HoldCondition; n: number; held: number; broke: number;
  pHold: number | null; pBreak: number | null; lowSample: boolean; samples: HoldSample[];
};
export type MddHoldResult = { applicable: false; reason: string } | {
  applicable: true; state: CurrentState; tier: HoldTier; tiers: HoldTier[];
  medianDaysToAth: number | null; medianDaysToBreak: number | null;
  breakDistribution: { label: string; count: number }[]; // 底割れしたケースの最終MDD内訳（深度バケット別）
};

function tierOf(label: string, cond: HoldCondition, prices: number[], episodes: Episode[]): HoldTier {
  const samples = collectHoldSamples(prices, cond, episodes);
  const held = samples.filter((s) => s.held).length, n = samples.length;
  return { label, cond, n, held, broke: n - held, pHold: n ? round1(held / n * 100) : null, pBreak: n ? round1((n - held) / n * 100) : null, lowSample: n < LOW_SAMPLE_N, samples };
}

// 現在の節目(fromLevel)と、そこから何段階回復済みか(steps)を返す。節目(levels[1]以降)に届いていない、
// または回復0段階（まだfromLevelから戻っていない）場合はnull。
function currentRecoveryStep(state: CurrentState, levels: number[]): { fromLevel: number; steps: number } | null {
  const idx = levelIndexReached(state.mdd, levels);
  if (idx <= 0) return null;
  let steps = 0;
  for (let s = idx - 1; s >= 0; s--) { if (state.latest_dd >= levels[s]) steps++; else break; }
  return steps > 0 ? { fromLevel: levels[idx], steps } : null;
}

// 条件を厳しい順に並べ、サンプル数がLOW_SAMPLE_N以上になる最初の段を採用する（どれも満たさなければ最も緩い段）。
export function computeMddHoldProbability(prices: number[], stats: StatsTable, state: CurrentState | null = deriveCurrentState(prices)): MddHoldResult {
  if (!state) return { applicable: false, reason: "現在は最高値圏（DD 0%）のため判定対象外です" };
  if (state.mdd > MIN_EPISODE_DD) return { applicable: false, reason: `現局面のMDD（${state.mdd.toFixed(2)}%）が${MIN_EPISODE_DD}%に達していないため判定対象外です` };
  const bi = depthBucketIndex(state.mdd), b = DEPTH_BUCKETS[bi];
  const wide = { upper: DEPTH_BUCKETS[Math.max(0, bi - 1)].upper, lower: DEPTH_BUCKETS[Math.min(DEPTH_BUCKETS.length - 1, bi + 1)].lower };
  const r = Math.max(0, Math.min(1, state.recovery_ratio)), dts = state.days_since_trough;
  const rl = `${Math.round(r * 100)}%`;
  const tiers = [
    tierOf(`MDD ${b.label}・戻し${rl}以上・底値から${dts}日以上`, { mddUpper: b.upper, mddLower: b.lower, minRecovery: r, minDaysSinceTrough: dts }, prices, stats.episodes),
    tierOf(`MDD ${b.label}・戻し${rl}以上`, { mddUpper: b.upper, mddLower: b.lower, minRecovery: r, minDaysSinceTrough: 0 }, prices, stats.episodes),
    tierOf(`MDD ${wide.upper}〜${wide.lower === -Infinity ? "" : wide.lower}%（隣接バケット含む）・戻し${rl}以上`, { mddUpper: wide.upper, mddLower: wide.lower, minRecovery: r, minDaysSinceTrough: 0 }, prices, stats.episodes),
  ];
  const rec = currentRecoveryStep(state, PROGRESSION_LEVELS);
  const recCell = rec ? stats.recoveryMatrix.find((c) => c.fromLevel === rec.fromLevel && c.steps === rec.steps) : undefined;
  if (recCell) {
    tiers.unshift({
      label: `節目 ${rec!.fromLevel}%・${rec!.steps}段階回復（${recCell.toLevel}%）`,
      cond: { mddUpper: rec!.fromLevel, mddLower: rec!.fromLevel - 5, minRecovery: NaN, minDaysSinceTrough: 0 },
      n: recCell.occurrences, held: recCell.bottomHeld, broke: recCell.occurrences - recCell.bottomHeld,
      pHold: recCell.p, pBreak: recCell.p === null ? null : round1(100 - recCell.p),
      lowSample: recCell.lowSample, samples: recCell.samples,
    });
  }
  const tier = tiers.find((t) => !t.lowSample) ?? tiers.reduce((a, t) => (t.n > a.n ? t : a));
  const med = (xs: number[]) => percentile([...xs].sort((x, y) => x - y), 0.5);
  const broken = tier.samples.filter((s) => !s.held);
  return {
    applicable: true, state, tier, tiers,
    medianDaysToAth: med(tier.samples.filter((s) => s.held).map((s) => s.days_to_ath!)),
    medianDaysToBreak: med(broken.map((s) => s.days_to_break!)),
    breakDistribution: DEPTH_BUCKETS.map((bk, i) => ({ label: bk.label, count: broken.filter((s) => depthBucketIndex(s.final_mdd) === i).length })),
  };
}
