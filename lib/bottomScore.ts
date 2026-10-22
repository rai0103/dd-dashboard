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
  crashFrequency: CrashFrequencyRow[];
  descentPaceProgression: LevelProgressionPaceRow[];
  recoveryMatrixByPace: RecoveryMatrixPaceCell[];
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
    crashFrequency: computeCrashFrequency(prices, dates ?? [], undefined, episodes),
    descentPaceProgression: computeLevelProgressionByPace(prices, undefined, episodes),
    recoveryMatrixByPace: computeRecoveryMatrixByPace(prices, undefined, episodes),
    depthBucket: (dd) => { const i = depthBucketIndex(dd); return i === -1 ? null : depthStats[i]; },
  };
}

/* ---------------- 3. 底値（MDD）確定確率 ---------------- */
// 底値＝DD-3%を越えた下落局面における、その時点までの最大下落（MDD）の日。
// 「現在のMDDがこの局面の底値として確定し、それを割らずにATHを更新する」確率を、過去の似た状況から算出する。

export type CurrentState = {
  pre_ath_idx: number; trough_idx: number;
  start_idx: number; // 下落開始日（dd<0になった初日。pre_ath_idx+1）
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
    pre_ath_idx: pre, trough_idx: trough, start_idx: pre + 1, mdd: dd[trough], latest_dd: dd[last],
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

/* ---------------- 5. 下落・回復の「速度」による条件付け ---------------- */
// 各節目まで進むのにかかった営業日数（下落側はエピソード開始から、回復側はトラフから）を、過去の
// 同じ節目到達事例の日数分布（p25〜p75）と比べて速い(fast)／普通(normal)／遅い(slow)の3段階に分類し、
// 「進むスピードが速い/遅いと、その先の確率がどう変わるか」を見るための統計を追加する。

export type PaceTier = "fast" | "normal" | "slow";
export const PACE_TIER_LABEL: Record<PaceTier, string> = { fast: "速い", normal: "普通", slow: "遅い" };

// days<=p25なら速い、days>=p75なら遅い、それ以外は普通。p25/p75が無ければ常にnormal。
export function paceTierOf(days: number, p25: number | null, p75: number | null): PaceTier {
  if (p25 !== null && days <= p25) return "fast";
  if (p75 !== null && days >= p75) return "slow";
  return "normal";
}

// 下落側の速度分類に使う節目（DEPTH_BUCKETSの上側境界と同じ並び）。既存のTRANSITION_PAIRSは変更しない。
export const DESCENT_PACE_LEVELS = [-3, -5, -8, -10, -15, -20, -30];

export type LevelProgressionPaceRow = {
  from: number; to: number; paceTier: PaceTier;
  cutP25: number | null; cutP75: number | null; cutMedian: number | null; // 速度分類の境界（fromへの到達日数のp25/p75/中央値、エピソード開始起点）
  reached: number; progressed: number; p: number | null; lowSample: boolean;
};

// 節目fromへの到達が（過去の実績に比べて）速かった/遅かったかで、次の節目toへの到達確率がどう変わるかを見る。
// fromへの到達日数（エピソード開始からの営業日数）は、既存computeLevelTransitionDays(prices, 0, from, ...)を
// そのまま再利用して求める（fromLevel=0を渡すとstart_idxが常に起点側にヒットするため）。
export function computeLevelProgressionByPace(prices: number[], levels: number[] = DESCENT_PACE_LEVELS, episodes?: Episode[]): LevelProgressionPaceRow[] {
  const eps = episodes ?? detectEpisodes(prices);
  const { dd } = computeDrawdowns(prices);
  const rows: LevelProgressionPaceRow[] = [];
  for (let i = 0; i < levels.length - 1; i++) {
    const from = levels[i], to = levels[i + 1];
    const reaching = eps.filter((e) => e.min_dd <= from);
    const fromDays = computeLevelTransitionDays(prices, 0, from, reaching);
    const p25 = fromDays.p25, p75 = fromDays.p75;
    const buckets: Record<PaceTier, { reached: number; progressed: number }> = {
      fast: { reached: 0, progressed: 0 }, normal: { reached: 0, progressed: 0 }, slow: { reached: 0, progressed: 0 },
    };
    for (const e of reaching) {
      let fi = -1;
      for (let k = e.start_idx; k <= e.trough_idx; k++) { if (dd[k] <= from) { fi = k; break; } }
      if (fi === -1) continue;
      const hit = e.min_dd <= to;
      if (!hit && e.resolve_idx === null) continue; // 未解消かつ未到達は結果未確定のため除外（既存computeLevelProgressionと同じ扱い）
      const tier = paceTierOf(fi - e.start_idx, p25, p75);
      buckets[tier].reached++;
      if (hit) buckets[tier].progressed++;
    }
    (["fast", "normal", "slow"] as PaceTier[]).forEach((paceTier) => {
      const b = buckets[paceTier];
      rows.push({ from, to, paceTier, cutP25: p25, cutP75: p75, cutMedian: fromDays.median, reached: b.reached, progressed: b.progressed, p: b.reached ? round1(b.progressed / b.reached * 100) : null, lowSample: b.reached < LOW_SAMPLE_N });
    });
  }
  return rows;
}

export type RecoveryPaceSample = HoldSample & { fromLevel: number; steps: number; daysToStep: number };

// collectRecoverySamplesと同じ走査（トラフごとに底割れ前の最大回復段階を追う）に加え、各段階に初到達した日
// （トラフからの営業日数）も記録する。1つのトラフから、到達段階数分（steps=1..stepsReached）のレコードを生成する。
export function collectRecoveryPaceSamples(prices: number[], levels: number[] = PROGRESSION_LEVELS, episodes?: Episode[]): RecoveryPaceSample[] {
  const eps = (episodes ?? detectEpisodes(prices)).filter((e) => e.resolve_idx !== null);
  const { dd } = computeDrawdowns(prices);
  const out: RecoveryPaceSample[] = [];
  for (const e of eps) {
    const end = e.resolve_idx!;
    let tr = e.start_idx, lastUsed = -1;
    for (let k = e.start_idx; k < end; k++) {
      if (prices[k] < prices[tr]) tr = k;
      if (tr === lastUsed) continue;
      lastUsed = tr;
      const idx = levelIndexReached(dd[tr], levels);
      if (idx === -1) continue; // 最も浅い節目にも届いていない
      let brk = -1;
      const stepDay: number[] = []; // stepDay[s-1] = levels[idx-s]に初到達したインデックス
      let nextS = 1;
      for (let j = tr + 1; j <= end; j++) {
        if (prices[j] < prices[tr]) { brk = j; break; }
        while (nextS <= idx && dd[j] >= levels[idx - nextS]) { stepDay.push(j); nextS++; }
      }
      const held = brk === -1;
      for (let s = 1; s <= stepDay.length; s++) {
        out.push({
          pre_ath_idx: e.pre_ath_idx, trough_idx: tr, sample_idx: tr, resolve_idx: end,
          mdd: dd[tr], held, days_to_ath: held ? end - tr : null, days_to_break: held ? null : brk - tr,
          final_mdd: e.min_dd, fromLevel: levels[idx], steps: s, daysToStep: stepDay[s - 1] - tr,
        });
      }
    }
  }
  return out;
}

// RecoveryMatrixCellとはoccurrences／pの意味が異なる点に注意：ベースのRecoveryMatrixCellは
// 「fromLevelに到達した全件（occurrences）のうち、steps段階回復かつ底値確定した件数（bottomHeld）」という
// 結合確率だが、速度版はすでに「steps段階回復した」ことが分かっている状況（＝その速度で到達した）を前提に
// 「その中で底値確定した割合」を見る条件付き確率（occurrences＝そのマス目・その速度帯への到達件数）。
export type RecoveryMatrixPaceCell = RecoveryMatrixCell & { paceTier: PaceTier; cutP25: number | null; cutP75: number | null; cutMedian: number | null };

export function computeRecoveryMatrixByPace(prices: number[], levels: number[] = PROGRESSION_LEVELS, episodes?: Episode[]): RecoveryMatrixPaceCell[] {
  const eps = episodes ?? detectEpisodes(prices);
  const samples = collectRecoveryPaceSamples(prices, levels, eps);
  const out: RecoveryMatrixPaceCell[] = [];
  for (let idx = 1; idx < levels.length; idx++) {
    const fromLevel = levels[idx];
    for (let steps = 1; steps <= idx; steps++) {
      const toLevel = levels[idx - steps];
      const atCell = samples.filter((s) => s.fromLevel === fromLevel && s.steps === steps);
      const sorted = atCell.map((s) => s.daysToStep).sort((a, b) => a - b);
      const p25 = percentile(sorted, 0.25), p75 = percentile(sorted, 0.75), cutMedian = percentile(sorted, 0.5);
      (["fast", "normal", "slow"] as PaceTier[]).forEach((paceTier) => {
        const matched = atCell.filter((s) => paceTierOf(s.daysToStep, p25, p75) === paceTier);
        const occurrences = matched.length;
        const bottomHeldSamples = matched.filter((s) => s.held);
        out.push({
          fromLevel, steps, toLevel, occurrences, reached: occurrences, bottomHeld: bottomHeldSamples.length,
          p: occurrences ? round1(bottomHeldSamples.length / occurrences * 100) : null,
          lowSample: occurrences < LOW_SAMPLE_N, samples: matched, paceTier, cutP25: p25, cutP75: p75, cutMedian,
        });
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
  // 下落速度：次の節目（to）への到達確率の参考値。底値確定/底割れの判定（tiers）には混ぜない独立値。
  nextLevelProgression: { from: number; to: number; daysElapsed: number; paceTier: PaceTier; p: number | null; n: number; lowSample: boolean; cutMedian: number | null } | null;
  // 回復速度：現在の回復段階（rec）に、過去実績に比べてどの速さで到達したか。該当tierはtiersに追加済み。
  recoveryPaceInfo: { fromLevel: number; steps: number; daysElapsed: number; paceTier: PaceTier; cutMedian: number | null } | null;
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
  const { dd } = computeDrawdowns(prices);
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
  // 下落速度：現在のMDDがDESCENT_PACE_LEVELS上のどの節目に対応するかを求め、その節目への到達が
  // 過去実績に比べて速い/普通/遅いかで、次の節目への到達確率（nextLevelProgression）を参考値として出す。
  // 底値確定/底割れの判定（tiers）には混ぜず、独立した値として返す。
  let nextLevelProgression: Extract<MddHoldResult, { applicable: true }>["nextLevelProgression"] = null;
  const liDesc = levelIndexReached(state.mdd, DESCENT_PACE_LEVELS);
  if (liDesc !== -1 && liDesc < DESCENT_PACE_LEVELS.length - 1) {
    const from = DESCENT_PACE_LEVELS[liDesc], to = DESCENT_PACE_LEVELS[liDesc + 1];
    let fi = -1;
    for (let k = state.start_idx; k <= state.trough_idx; k++) { if (dd[k] <= from) { fi = k; break; } }
    if (fi !== -1) {
      const daysElapsed = fi - state.start_idx;
      const rowsForPair = stats.descentPaceProgression.filter((rw) => rw.from === from && rw.to === to);
      const anyRow = rowsForPair[0];
      if (anyRow) {
        const paceTier = paceTierOf(daysElapsed, anyRow.cutP25, anyRow.cutP75);
        const row = rowsForPair.find((rw) => rw.paceTier === paceTier);
        if (row) nextLevelProgression = { from, to, daysElapsed, paceTier, p: row.p, n: row.reached, lowSample: row.lowSample, cutMedian: row.cutMedian };
      }
    }
  }
  // 回復速度：現在、節目からstepsReached段階回復している場合、その段階に初到達した日数（トラフ起点）の
  // 速さに応じたセルをrecoveryMatrixByPaceから探し、既存のrecCell由来tierより手前（より具体的）に追加する。
  let recoveryPaceInfo: Extract<MddHoldResult, { applicable: true }>["recoveryPaceInfo"] = null;
  if (rec && recCell) {
    const cellRows = stats.recoveryMatrixByPace.filter((c) => c.fromLevel === rec!.fromLevel && c.steps === rec!.steps);
    const anyCell = cellRows[0];
    if (anyCell) {
      let dayIdx = -1;
      for (let k = state.trough_idx; k < prices.length; k++) { if (dd[k] >= recCell.toLevel) { dayIdx = k; break; } }
      if (dayIdx !== -1) {
        const daysElapsed = dayIdx - state.trough_idx;
        const paceTier = paceTierOf(daysElapsed, anyCell.cutP25, anyCell.cutP75);
        const cell = cellRows.find((c) => c.paceTier === paceTier);
        if (cell) {
          recoveryPaceInfo = { fromLevel: rec!.fromLevel, steps: rec!.steps, daysElapsed, paceTier, cutMedian: cell.cutMedian };
          tiers.unshift({
            label: `節目 ${rec!.fromLevel}%・${rec!.steps}段階回復（${cell.toLevel}%）・回復${daysElapsed}日（${PACE_TIER_LABEL[paceTier]}）`,
            cond: { mddUpper: rec!.fromLevel, mddLower: rec!.fromLevel - 5, minRecovery: NaN, minDaysSinceTrough: 0 },
            n: cell.occurrences, held: cell.bottomHeld, broke: cell.occurrences - cell.bottomHeld,
            pHold: cell.p, pBreak: cell.p === null ? null : round1(100 - cell.p),
            lowSample: cell.lowSample, samples: cell.samples,
          });
        }
      }
    }
  }
  const tier = tiers.find((t) => !t.lowSample) ?? tiers.reduce((a, t) => (t.n > a.n ? t : a));
  const med = (xs: number[]) => percentile([...xs].sort((x, y) => x - y), 0.5);
  const broken = tier.samples.filter((s) => !s.held);
  return {
    applicable: true, state, tier, tiers,
    medianDaysToAth: med(tier.samples.filter((s) => s.held).map((s) => s.days_to_ath!)),
    medianDaysToBreak: med(broken.map((s) => s.days_to_break!)),
    breakDistribution: DEPTH_BUCKETS.map((bk, i) => ({ label: bk.label, count: broken.filter((s) => depthBucketIndex(s.final_mdd) === i).length })),
    nextLevelProgression, recoveryPaceInfo,
  };
}

/* ---------------- 6. 暴落発生確率（カレンダー年ベース、頻度分析） ---------------- */
// 暴落＝下落エピソード（Episode）のmin_ddが閾値以下に達したもの。発生日は、そのエピソード内で閾値に
// 最初に到達した日（最終的な底値＝troughの日ではなく、その深さまで下落が進んだ最初の時点）とする。
// 同一エピソードは複数の閾値（浅い方から深い方まですべて）に対して1件ずつカウントされる
// （例：最終MDD-35%の局面は、-10%〜-35%のすべての閾値で1件とカウントされる）。
// 発生頻度は「データ期間（年）÷発生件数＝平均X年に1度」、今後1年以内の発生確率は年あたり発生率λ＝件数/期間年数を
// 使ったポアソン過程の近似（1-e^-λ、どれだけλが大きくても100%を超えない）で算出する。「前年の傾向」は、
// 各発生年の前年（暦年）の騰落率を集計したもの。ハードコードは一切せず、価格・日付系列から毎回再計算する。

export const CRASH_RISK_THRESHOLDS = PROGRESSION_LEVELS.slice(1); // -10%〜-45%（-5%は「暴落」と呼ぶには浅すぎるため除外。RECOVERY_LEVELSと同じ切り出し方）

export type CrashOccurrence = { threshold: number; year: number; date: Date | null; min_dd: number; episode: Episode };

// エピソード内で dd が threshold に最初に到達したインデックス（到達しなければnull）。
function reachIndex(dd: number[], e: Episode, threshold: number): number | null {
  for (let k = e.start_idx; k <= e.trough_idx; k++) if (dd[k] <= threshold) return k;
  return null;
}

// 価格・日付系列全体から、min_dd<=thresholdのエピソードについて「発生日（閾値到達日）」を集めたもの（古い順）。
export function collectCrashOccurrences(prices: number[], dates: (Date | string)[], threshold: number, episodes?: Episode[]): CrashOccurrence[] {
  const eps = (episodes ?? detectEpisodes(prices, dates)).filter((e) => e.min_dd <= threshold);
  const { dd } = computeDrawdowns(prices);
  const out: CrashOccurrence[] = [];
  for (const e of eps) {
    const idx = reachIndex(dd, e, threshold);
    if (idx === null) continue;
    const date = toDate(dates[idx]);
    out.push({ threshold, year: date ? date.getFullYear() : NaN, date, min_dd: e.min_dd, episode: e });
  }
  return out;
}

// 年末（その年最後の取引日）の価格を年ごとに引けるルックアップ表。datesは日付昇順前提（既存の全関数と同じ前提）。
function yearEndPriceMap(prices: number[], dates: (Date | string)[]): Map<number, number> {
  const out = new Map<number, number>();
  for (let i = 0; i < prices.length; i++) {
    const d = toDate(dates[i]);
    if (!d) continue;
    out.set(d.getFullYear(), prices[i]); // 同じ年内で後に出てきた値で上書き＝その年の最終営業日が残る
  }
  return out;
}

// year年の年間騰落率（%）。year年末価格 / (year-1)年末価格 - 1。どちらかが無ければnull。
function annualReturnForYear(yearEnd: Map<number, number>, year: number): number | null {
  const cur = yearEnd.get(year), prev = yearEnd.get(year - 1);
  return cur != null && prev != null ? (cur / prev - 1) * 100 : null;
}

const CRASH_LOW_SAMPLE_N = 5; // 暴落のように稀な事象では、他の統計のLOW_SAMPLE_N=15基準だとほぼ全閾値が低サンプル扱いになるため専用の閾値を使う

export type CrashFrequencyRow = {
  threshold: number;
  occurrences: CrashOccurrence[]; // 古い順
  count: number;
  coverageYears: number; // データ期間（年、小数）
  avgIntervalYears: number | null; // coverageYears / count ＝「平均X年に1度」
  lastOccurrence: CrashOccurrence | null;
  yearsSinceLast: number | null; // データ終端時点からの経過年数
  nextYearProbability: number | null; // 今後1年以内に発生する確率の目安（%）。ポアソン過程近似：1-e^-λ（λ=count/coverageYears）
  priorYearReturns: { year: number; return: number }[]; // 各発生年の前年（暦年）騰落率（データがある分のみ）
  priorYearAvg: number | null;
  priorYearPositiveShare: number | null; // 前年がプラスだった発生の割合（%）
  lowSample: boolean;
};

// 閾値ごとの暴落発生頻度・前年傾向を一括算出する。thresholds省略時はCRASH_RISK_THRESHOLDS（-10%〜-45%）全件。
export function computeCrashFrequency(prices: number[], dates: (Date | string)[], thresholds: number[] = CRASH_RISK_THRESHOLDS, episodes?: Episode[]): CrashFrequencyRow[] {
  if (!dates.length || !prices.length) return [];
  const eps = episodes ?? detectEpisodes(prices, dates);
  const firstDate = toDate(dates[0]), lastDate = toDate(dates[dates.length - 1]);
  const coverageYears = firstDate && lastDate ? (lastDate.getTime() - firstDate.getTime()) / (365.25 * 86400000) : 0;
  const yearEnd = yearEndPriceMap(prices, dates);
  return thresholds.map((threshold) => {
    const occurrences = collectCrashOccurrences(prices, dates, threshold, eps);
    const count = occurrences.length;
    const last = count ? occurrences[occurrences.length - 1] : null;
    const yearsSinceLast = last?.date && lastDate ? (lastDate.getTime() - last.date.getTime()) / (365.25 * 86400000) : null;
    const lambda = coverageYears > 0 ? count / coverageYears : null;
    const priorYearReturns = occurrences
      .map((o) => ({ year: o.year - 1, return: annualReturnForYear(yearEnd, o.year - 1) }))
      .filter((r): r is { year: number; return: number } => r.return !== null);
    const priorRets = priorYearReturns.map((r) => r.return);
    return {
      threshold, occurrences, count, coverageYears: round1(coverageYears),
      avgIntervalYears: count > 0 && coverageYears > 0 ? round1(coverageYears / count) : null,
      lastOccurrence: last,
      yearsSinceLast: yearsSinceLast !== null ? round1(yearsSinceLast) : null,
      nextYearProbability: lambda !== null ? round1((1 - Math.exp(-lambda)) * 100) : null,
      priorYearReturns, priorYearAvg: priorRets.length ? round1(mean(priorRets)) : null,
      priorYearPositiveShare: priorRets.length ? round1((priorRets.filter((r) => r > 0).length / priorRets.length) * 100) : null,
      lowSample: count < CRASH_LOW_SAMPLE_N,
    };
  });
}
