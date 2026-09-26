// 底値判定スコア：SP500日次終値の全履歴から下落エピソードを検出し、各種統計テーブルを都度算出して
// 現在の下落局面の「底値確信度」を0-100でスコアリングする。
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

export type LevelProgressionRow = { from: number; to: number; reached: number; progressed: number; p: number | null; lowSample: boolean };

// 2-4. 節目間進行確率。L(i)到達エピソードを分母、同一局面内でL(i+1)まで到達した数を分子とする。
// 進行中のエピソードは、L(i+1)到達済みなら成功として数え、未到達なら結果未確定のため分母から除外する。
export function computeLevelProgression(prices: number[], levels = [-5, -10, -15, -20, -25, -30, -35, -40, -45], episodes?: Episode[]): LevelProgressionRow[] {
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
    depthBucket: (dd) => { const i = depthBucketIndex(dd); return i === -1 ? null : depthStats[i]; },
  };
}

/* ---------------- 3. 底値確信度スコア ---------------- */

export type CurrentState = {
  current_dd: number; // スコア算出に使う深度（現局面のこれまでの最大DDを渡す想定）
  days_at_current_level: number; // 直前ATHからの経過営業日数
  fake_rally_count: number;
  bounce_from_low_pct: number;
  bounce_from_anchor_pct?: number; // アンカー水準価格からの反発率（省略時は bounce_from_low_pct で代用）
};

export const CONFIRM_THRESHOLD = 3; // ConfirmScoreを算出する最小反発率（%）
export const CONFIRM_TARGET_UP = 10; // 「底値確定」とみなす、アンカー価格からの上昇幅（%）

// 現局面が到達済みの最も深いアンカー行について、「現在の反発幅（以下で最も近い節目k）まで達したケースのうち、
// アンカー価格を割らずに+CONFIRM_TARGET_UP%まで到達した割合」＝ P(target | k) を返す（0-100）。
export function lookupConfirmWeight(currentDD: number, reboundTable: ReboundRow[], bouncePct = CONFIRM_THRESHOLD): { weight: number | null; anchor: number | null; fromUp: number | null; n: number } {
  const rows = reboundTable.filter((r) => currentDD <= r.anchor);
  const row = rows.length ? rows[rows.length - 1] : reboundTable[0];
  if (!row) return { weight: null, anchor: null, fromUp: null, n: 0 };
  const target = row.rungs.find((r) => r.up === CONFIRM_TARGET_UP) ?? row.rungs[row.rungs.length - 1];
  if (bouncePct >= target.up) return { weight: 100, anchor: row.anchor, fromUp: target.up, n: target.n };
  const base = [...row.rungs].reverse().find((r) => r.up <= bouncePct);
  if (!base || !base.p || target.p === null) return { weight: target.p, anchor: row.anchor, fromUp: null, n: target.n };
  return { weight: Math.min(100, round1(target.p / base.p * 100)!), anchor: row.anchor, fromUp: base.up, n: base.n };
}

export const SCORE_WEIGHTS = { depth: 0.3, duration: 0.25, fakeRally: 0.2, confirm: 0.25 };
export const SCORE_BANDS = [
  { min: 85, label: "積極買い増し目安" },
  { min: 60, label: "部分買い増し目安" },
  { min: 30, label: "様子見" },
  { min: 0, label: "継続警戒" },
];
export function scoreBand(score: number) { return SCORE_BANDS.find((b) => score >= b.min)!; }

export type ScoreComponent = { key: string; label: string; value: number; weight: number; n: number; lowSample: boolean; detail: string };
export type BottomScore = { applicable: false; reason: string } | {
  applicable: true; score: number; band: string; bucket: DepthStat; bucketFallback: boolean; components: ScoreComponent[];
};

// 母数が0件のバケットは、より浅い側で直近のデータがあるバケットにフォールバックする（深い局面ほど実績が少ないため）。
function bucketWithData(stats: StatsTable, dd: number): { bucket: DepthStat | null; fallback: boolean } {
  let i = depthBucketIndex(dd);
  if (i === -1) return { bucket: null, fallback: false };
  const orig = i;
  while (i > 0 && stats.depthStats[i].n === 0) i--;
  return { bucket: stats.depthStats[i], fallback: i !== orig };
}

const clamp100 = (v: number) => Math.max(0, Math.min(100, v));

export function computeBottomScore(s: CurrentState, stats: StatsTable): BottomScore {
  if (s.current_dd > MIN_EPISODE_DD) return { applicable: false, reason: `DDが${MIN_EPISODE_DD}%に達していないため判定対象外です` };
  const { bucket, fallback } = bucketWithData(stats, s.current_dd);
  if (!bucket || bucket.n === 0) return { applicable: false, reason: "比較可能な過去エピソードがありません" };

  const depth = bucket.cleanRecoveryRate ?? 0;
  const duration = bucket.avgDurationDays ? clamp100(s.days_at_current_level / bucket.avgDurationDays * 100) : 100;
  const fake = bucket.avgFakeRallyCount ? clamp100(s.fake_rally_count / bucket.avgFakeRallyCount * 100) : 100;
  const cw = lookupConfirmWeight(s.current_dd, stats.reboundTable, s.bounce_from_anchor_pct ?? s.bounce_from_low_pct);
  const confirm = s.bounce_from_low_pct >= CONFIRM_THRESHOLD ? (cw.weight ?? 0) : 0;

  const components: ScoreComponent[] = [
    { key: "depth", label: "深度（クリーン回復率）", value: depth, weight: SCORE_WEIGHTS.depth, n: bucket.n, lowSample: bucket.lowSample, detail: `${bucket.label}の解消済み${bucket.n}件中${bucket.cleanCount}件がクリーン回復` },
    { key: "duration", label: "経過日数", value: duration, weight: SCORE_WEIGHTS.duration, n: bucket.n, lowSample: bucket.lowSample, detail: `ATHから${s.days_at_current_level}日 / 平均下落日数${bucket.avgDurationDays ?? "—"}日` },
    { key: "fakeRally", label: "だまし上げ回数", value: fake, weight: SCORE_WEIGHTS.fakeRally, n: bucket.n, lowSample: bucket.lowSample, detail: `${s.fake_rally_count}回 / 平均${bucket.avgFakeRallyCount ?? "—"}回` },
    { key: "confirm", label: "反発確認", value: confirm, weight: SCORE_WEIGHTS.confirm, n: cw.n, lowSample: cw.n < LOW_SAMPLE_N,
      detail: s.bounce_from_low_pct < CONFIRM_THRESHOLD ? `安値からの反発${s.bounce_from_low_pct.toFixed(1)}%（+${CONFIRM_THRESHOLD}%未満のため0点）`
        : `アンカー${cw.anchor}%基準：+${cw.fromUp ?? 0}%到達後に+${CONFIRM_TARGET_UP}%まで割れずに進んだ割合` },
  ];
  const score = round1(components.reduce((sum, c) => sum + c.value * c.weight, 0))!;
  return { applicable: true, score, band: scoreBand(score).label, bucket, bucketFallback: fallback, components };
}

/* ---------------- 類似ケース ---------------- */

export type SimilarCase = { episode: Episode; distance: number; durationDays: number; fakeRallyCount: number; clean: boolean; bucketLabel: string };

// (深度バケット, 経過日数, だまし上げ回数) の3次元で、解消済みの過去エピソードとのユークリッド距離が近い順に返す。
// 各軸は単位が大きく異なるため、過去エピソード全体の標準偏差で割って正規化してから距離を測る。
export function findSimilarEpisodes(s: CurrentState, stats: StatsTable, prices: number[], k = 3): SimilarCase[] {
  const cands = stats.episodes.filter((e) => e.resolve_idx !== null).map((e) => ({
    episode: e, b: depthBucketIndex(e.min_dd), durationDays: e.trough_idx - e.pre_ath_idx, fakeRallyCount: countFakeRallies(e, prices), clean: isCleanRecovery(e, prices) === true,
  }));
  if (!cands.length) return [];
  const sd = (xs: number[]) => { const m = mean(xs)!; return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))!) || 1; };
  const sb = sd(cands.map((c) => c.b)), sdur = sd(cands.map((c) => c.durationDays)), sf = sd(cands.map((c) => c.fakeRallyCount));
  const cb = depthBucketIndex(s.current_dd);
  return cands
    .map((c) => ({ ...c, distance: Math.hypot((c.b - cb) / sb, (c.durationDays - s.days_at_current_level) / sdur, (c.fakeRallyCount - s.fake_rally_count) / sf) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, k)
    .map((c) => ({ episode: c.episode, distance: round1(c.distance)!, durationDays: c.durationDays, fakeRallyCount: c.fakeRallyCount, clean: c.clean, bucketLabel: DEPTH_BUCKETS[c.b]?.label ?? "—" }));
}

/* ---------------- 現在状態の導出 ---------------- */

// 価格系列の末尾（最新日）を現在として CurrentState を組み立てる。現局面が dd<0 でなければ null。
export function deriveCurrentState(prices: number[]): (CurrentState & { pre_ath_idx: number; trough_idx: number; latest_dd: number }) | null {
  const { dd } = computeDrawdowns(prices);
  const last = prices.length - 1;
  if (last < 1 || dd[last] >= 0) return null;
  let pre = last;
  while (pre > 0 && dd[pre] < 0) pre--;
  let trough = pre + 1;
  for (let k = pre + 1; k <= last; k++) if (prices[k] < prices[trough]) trough = k;
  const minDD = dd[trough];
  let bounceFromAnchor: number | undefined;
  const anchors = [-5, -8, -10, -15, -20, -25].filter((a) => minDD <= a);
  if (anchors.length) {
    const a = anchors[anchors.length - 1];
    let ai = pre + 1; while (dd[ai] > a) ai++;
    bounceFromAnchor = (prices[last] / prices[ai] - 1) * 100;
  }
  return {
    current_dd: minDD, latest_dd: dd[last], pre_ath_idx: pre, trough_idx: trough,
    days_at_current_level: last - pre,
    fake_rally_count: countFakeRalliesInRange(prices, pre, last),
    bounce_from_low_pct: (prices[last] / prices[trough] - 1) * 100,
    bounce_from_anchor_pct: bounceFromAnchor,
  };
}
