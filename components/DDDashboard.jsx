"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ComposedChart, LineChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ReferenceDot, ResponsiveContainer, PieChart, Pie, Cell, Brush, Customized,
} from "recharts";
import { TrendingDown, TrendingUp, AlertTriangle, Info, ChevronRight, Clock, X, Upload, Database, Trash2 } from "lucide-react";
import { storage } from "@/lib/storage";

/* ---------------- design tokens ---------------- */
const C = {
  bg: "#0A0F1C", panel: "#111A2C", panel2: "#0D1424",
  border: "#22304C", borderSoft: "#1A2540",
  text: "#E7ECF3", textMuted: "#8592AC", textDim: "#56637F",
  teal: "#45C4B0", amber: "#D9A24B", rust: "#C0654B", rustSoft: "rgba(192,101,75,0.16)",
  violet: "#8B7FC7", blue: "#5B90C7",
};
function depthColor(v) { if (v >= -3) return C.teal; if (v >= -18) return C.amber; return C.rust; }
function hexToRgb(hex) { const h = hex.replace("#", ""); return { r: parseInt(h.substring(0, 2), 16), g: parseInt(h.substring(2, 4), 16), b: parseInt(h.substring(4, 6), 16) }; }
function lerpColor(a, b, t) { const pa = hexToRgb(a), pb = hexToRgb(b); return `rgb(${Math.round(pa.r + (pb.r - pa.r) * t)},${Math.round(pa.g + (pb.g - pa.g) * t)},${Math.round(pa.b + (pb.b - pa.b) * t)})`; }
function rankColor(rank) { const order = ["A", "B", "C", "D", "E"]; const idx = order.indexOf(rank); const t = idx / (order.length - 1); return t <= 0.5 ? lerpColor(C.teal, C.amber, t / 0.5) : lerpColor(C.amber, C.rust, (t - 0.5) / 0.5); }

const MILESTONES = [-3, -5, -8, -10, -12, -15, -18, -20, -25, -30, -35, -40, -45, -50];
// 表示期間内の最大DD%（最も深い下落）に応じてDD%軸の目盛りを動的に切り替える。
// 浅い局面ではDD3%等の初期リバランスポイントが見やすいよう細かく、深い局面では10%刻みに広げる。
function ddAxisTicksForMaxDrawdown(maxDrawdownPct) {
  const abs = Math.abs(maxDrawdownPct);
  if (abs <= 5) return [0, -3, -5];
  if (abs <= 10) return [0, -3, -5, -8, -10];
  if (abs <= 20) return [0, -5, -10, -15, -20];
  const top = Math.ceil(abs / 10) * 10;
  const ticks = [0];
  for (let t = -10; t >= -top; t -= 10) ticks.push(t);
  return ticks;
}

/* ---------------- bundled seed data (~31y), used until real data is imported ---------------- */
function mulberry32(a) { return function () { let t = (a += 0x6d588f5); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function addTradingDay(d) { const nd = new Date(d); nd.setDate(nd.getDate() + 1); while (nd.getDay() === 0 || nd.getDay() === 6) nd.setDate(nd.getDate() + 1); return nd; }
function buildSeedSeries() {
  const rnd = mulberry32(11);
  const regimes = [[900, 0.34, 1.5], [230, -1.05, 2.3], [650, 0.32, 1.4], [420, -0.85, 2.5], [900, 0.30, 1.3], [110, -1.7, 3.3], [70, 1.9, 2.0], [1500, 0.27, 1.3], [260, -0.6, 2.1], [1600, 0.30, 1.4], [340, -0.95, 2.4], [1450, 0.28, 1.3], [330, -0.75, 2.0]];
  let price = 55; let date = new Date("1995-09-01"); const pts = [];
  for (const [len, drift, vol] of regimes) { for (let k = 0; k < len; k++) { price = Math.max(8, price + drift + (rnd() - 0.5) * vol); pts.push({ date, price: Number(price.toFixed(2)) }); date = addTradingDay(date); } }
  return pts;
}
const SEED_SERIES = buildSeedSeries();

/* ---------------- CSV parsing (Stooq: Date,Open,High,Low,Close,Volume) ---------------- */
const BOM_RE = new RegExp("^" + String.fromCharCode(0xfeff)); // Excel等で保存されたUTF-8 CSV先頭のBOMを除去するため（コードポイント指定で明示、ソース上に不可視文字を埋め込まない）
function findCol(header, candidates) { for (const c of candidates) { const idx = header.indexOf(c); if (idx !== -1) return idx; } return -1; }
// 引用符で囲まれたフィールド内のカンマ（例: "5,480.22" のような桁区切り）を誤って列区切りとして分割しないCSV行パーサー。
// 単純な line.split(",") だと桁区切りカンマ入りの値で列がずれ、Close列に別の値が混入する不具合があったため導入。
function parseCSVLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false; }
      else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
function parseStooqCSV(text) {
  const normalized = text.replace(BOM_RE, "").trim(); // 先頭BOM・前後の空白を除去
  const lines = normalized.split(/\r?\n/).filter((l) => l.trim() !== ""); // \r\n(Windows)・\n(Unix)いずれも対応し、空行は除外
  if (!lines.length) return [];
  const header = parseCSVLine(lines[0]).map((h) => h.trim().toLowerCase());
  const dateIdx = findCol(header, ["date", "日付"]);
  const closeIdx = findCol(header, ["close", "終値"]);
  if (dateIdx === -1 || closeIdx === -1) return [];
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (cols.length <= Math.max(dateIdx, closeIdx)) continue;
    const d = new Date(cols[dateIdx].trim());
    const c = parseFloat(String(cols[closeIdx]).replace(/,/g, "").trim());
    if (!isNaN(d.getTime()) && !isNaN(c)) rows.push({ date: d, price: c });
  }
  rows.sort((a, b) => a.date - b.date);
  return rows;
}
const SPY_LISTING_DATE = new Date("1993-01-22"); // SPYの実際の設定日（この日以前はSPYの実データが存在しない）
function backfillFromIndex(vooSeries, indexSeries) {
  if (!vooSeries.length || !indexSeries.length) return { merged: vooSeries, added: 0, scale: null };
  const vooFirst = vooSeries[0];
  // scale = SPYの最初の終値 ÷ 同日(または直前)のインデックス水準
  const candidates = indexSeries.filter((p) => p.date <= vooFirst.date);
  const matched = candidates.length ? candidates[candidates.length - 1] : indexSeries[0];
  const scale = vooFirst.price / matched.price;
  const synthetic = indexSeries.filter((p) => p.date < vooFirst.date).map((p) => ({ date: p.date, price: Number((p.price * scale).toFixed(2)), synthetic: true }));
  const merged = [...synthetic, ...vooSeries].sort((a, b) => a.date - b.date);
  return { merged, added: synthetic.length, scale };
}

/* ---------------- derived analytics (recomputed whenever the price series changes) ---------------- */
function analyzeEpisode(series) {
  const n = series.length; let athIdx = n - 1;
  for (let k = n - 1; k >= 0; k--) { if (series[k].dd === 0) { athIdx = k; break; } }
  const crossIdx = {};
  for (const t of MILESTONES) { let idx = -1; for (let k = athIdx; k < n; k++) { if (series[k].dd <= t) { idx = k; break; } } crossIdx[t] = idx; }
  let currentT = null, currentIdx = -1, prevT = null, prevIdx = -1;
  for (const t of MILESTONES) { if (crossIdx[t] !== -1) { prevT = currentT; prevIdx = currentIdx; currentT = t; currentIdx = crossIdx[t]; } }
  return { athIdx, crossIdx, currentT, currentIdx, prevT, prevIdx };
}
// 現在のDD%が到達済みの節目のうち最も深いものを選ぶ（例：DD-2%はまだ-3%未到達なのでATH、DD-6%は-5%到達済み・-8%未到達なのでDD-5%）。
function nearestModelRow(dd) { const reached = MODEL_ROWS.filter((r) => r.v <= 0 && dd <= r.v); return reached.length ? reached.reduce((deepest, r) => (r.v < deepest.v ? r : deepest)) : MODEL_ROWS.find((r) => r.v === 0); }
// 全期間から「ATH→底値→回復（新ATH）」の下落局面を全て抽出する（DD%がminDD以下に達したもののみ、ノイズ除去）。
// 最後の局面が未回復（現在も下落中/回復モード）の場合は isOngoing:true として含める。
function findDDEpisodes(FULL, minDD) {
  const raw = [];
  let athIdx = 0;
  for (let i = 1; i < FULL.length; i++) {
    if (FULL[i].dd === 0) {
      let troughIdx = athIdx;
      for (let k = athIdx; k <= i; k++) { if (FULL[k].price < FULL[troughIdx].price) troughIdx = k; }
      if (FULL[troughIdx].dd <= minDD) raw.push({ athIdx, troughIdx, recoveryIdx: i, isOngoing: false });
      athIdx = i;
    }
  }
  const lastIdx = FULL.length - 1;
  if (athIdx < lastIdx) {
    let troughIdx = athIdx;
    for (let k = athIdx; k <= lastIdx; k++) { if (FULL[k].price < FULL[troughIdx].price) troughIdx = k; }
    if (FULL[troughIdx].dd <= minDD) raw.push({ athIdx, troughIdx, recoveryIdx: null, isOngoing: true });
  }
  return raw.map((e) => ({
    athIdx: e.athIdx, athDate: FULL[e.athIdx].date, athPrice: FULL[e.athIdx].price,
    troughIdx: e.troughIdx, troughDate: FULL[e.troughIdx].date, troughPrice: FULL[e.troughIdx].price, troughDD: FULL[e.troughIdx].dd,
    recoveryIdx: e.recoveryIdx, recoveryDate: e.recoveryIdx != null ? FULL[e.recoveryIdx].date : null, recoveryPrice: e.recoveryIdx != null ? FULL[e.recoveryIdx].price : null,
    isOngoing: e.isOngoing,
  }));
}
const DD3_FREQ_PER_YEAR = 3.5; // 過去傾向として、DD3%級の押し目は年に約3.5回発生する前提(目安値)
function freqLabelFromP(p) { const perYear = DD3_FREQ_PER_YEAR * (p / 100); if (perYear >= 1) return `年に${perYear.toFixed(1)}回`; const years = 1 / perYear; return `${years < 10 ? years.toFixed(1) : Math.round(years)}年に1度`; }
function freqPerYearFromP(p) { return DD3_FREQ_PER_YEAR * (p / 100); }
function freqPerYearForLabel(label) { const row = FINAL_REACH_DATA.find((r) => r.label === label); return row ? freqPerYearFromP(row.p) : null; }
function correctionType(dd) { const abs = Math.abs(dd); if (abs < 10) return "浅い調整"; if (abs < 20) return "中程度の調整"; return "深い調整"; }
// 「現状分析」パネルの自動生成テキスト（毎日データ更新の都度、最新の状況から再計算される）。
function buildAnalysisText(d, currentHoldingPct, totalValue) {
  const athStr = fmtYMD(d.athDate);
  const ddStr = `${d.currentDD.toFixed(1)}%`;
  const perYear = d.currentLevelP !== null ? freqPerYearFromP(d.currentLevelP) : null;
  const freqStr = perYear !== null ? `${perYear.toFixed(1)}回` : "算出不可の水準（過去データの範囲外）";
  const typeStr = correctionType(d.currentDD);

  let maxCat = "A", maxDiff = 0;
  for (const cat of CATS) {
    const diff = Number((currentHoldingPct[cat] - d.modelRow[cat]).toFixed(1));
    if (Math.abs(diff) > Math.abs(maxDiff)) { maxDiff = diff; maxCat = cat; }
  }
  const maxDiffAmount = Math.round((totalValue * maxDiff) / 100);
  const direction = maxDiff >= 0 ? "過多" : "不足";
  const verdict = Math.abs(maxDiff) >= 4 ? "リバランスを推奨します" : "現状のバランスは良好です";
  const rebalanceSentence = `${d.modelRow.label}の推奨ポートフォリオと比較して、${maxCat}クラスが${Math.abs(maxDiff).toFixed(1)}%（${maxDiffAmount >= 0 ? "+" : "-"}¥${Math.abs(maxDiffAmount).toLocaleString()}）${direction}しており、${verdict}。`;

  if (d.isDrawdown && d.nextProg) {
    const nextFreqPerYear = freqPerYearForLabel(`${d.nextProg.to}%`);
    const nextFreqStr = nextFreqPerYear !== null ? `${nextFreqPerYear.toFixed(1)}回` : "算出不可";
    return `ATHが${athStr}で現在は${ddStr}です。${ddStr}は${perYear !== null ? `年に${freqStr}程度発生する` : `${freqStr}`}${typeStr}です。ATHから${d.daysSinceATH}日間経過しており、次の節目である${d.nextProg.to}%まで下落する確率は${d.nextProg.p}%で、発生した場合は年に${nextFreqStr}程度の下落相場となります。${rebalanceSentence}`;
  }
  if (d.isDrawdown) {
    return `ATHが${athStr}で現在は${ddStr}です。${ddStr}は${perYear !== null ? `年に${freqStr}程度発生する` : `${freqStr}`}${typeStr}です。ATHから${d.daysSinceATH}日間経過しています。${rebalanceSentence}`;
  }
  return `ATHが${athStr}で、現在は前回のATHから${d.daysSinceATH}日で新高値圏（${ddStr}）にあります。${rebalanceSentence}`;
}

function computeAll(rawSeries) {
  let ath = 0;
  const FULL = rawSeries.map((p, i) => { ath = Math.max(ath, p.price); return { i, date: p.date, price: p.price, ath, dd: Number((((p.price / ath) - 1) * 100).toFixed(2)) }; });
  const last = FULL[FULL.length - 1];
  const currentDD = last.dd, currentPrice = last.price, currentATH = last.ath;
  const isDrawdown = currentDD <= -3;
  const mode = isDrawdown ? "下落モード" : "最高値更新モード";
  const episode = analyzeEpisode(FULL);
  const ddStartIdx = episode.crossIdx[-3];
  const daysSinceDDStart = ddStartIdx !== -1 ? last.i - FULL[ddStartIdx].i : null;
  const daysSinceCurrentThreshold = episode.currentIdx !== -1 ? last.i - FULL[episode.currentIdx].i : null;
  const legDays = (episode.prevIdx !== -1 && episode.currentIdx !== -1) ? FULL[episode.currentIdx].i - FULL[episode.prevIdx].i : null;
  const isEntryLeg = episode.prevT === -3 && episode.currentT === -5;
  const currentTLabel = currentDD <= -50 ? "-50%以上" : (episode.currentT !== null ? `${episode.currentT}%` : "—");
  const currentEpisodeCurve = ddStartIdx !== -1 ? FULL.slice(ddStartIdx, last.i + 1).map((p, idx) => ({ day: idx, dd: p.dd })) : [];
  const speedCategory = legDays !== null ? (legDays <= 5 ? "急落" : "緩慢") : null;
  const nextProg = episode.currentT !== null ? PROGRESSION_DATA.find((r) => r.from === episode.currentT) : null;
  const modelRow = nearestModelRow(currentDD);
  const currentLevelP = currentTLabel === "-3%" ? 100 : (FINAL_REACH_DATA.find((r) => r.label === currentTLabel)?.p ?? null);
  const currentFreqLabel = currentLevelP !== null ? freqLabelFromP(currentLevelP) : null;
  const athDate = FULL[episode.athIdx].date; // 直近の下落局面の起点となった最高値更新日
  const daysSinceATH = last.i - FULL[episode.athIdx].i; // 前回最高値（DD3%後）からの経過日数
  let troughIdx = episode.athIdx; // 前回ATHから現在までの局面における底値（最安値）
  for (let k = episode.athIdx; k <= last.i; k++) { if (FULL[k].price < FULL[troughIdx].price) troughIdx = k; }
  const trough = FULL[troughIdx];
  const episodes = findDDEpisodes(FULL, -3); // 過去も含む全DD局面（チャートの重要ポイント表示用）
  const nextMilestone = MILESTONES.find((t) => currentDD > t) ?? null; // 現在のDD%からまだ到達していない直近の節目
  const distanceToNextMilestone = nextMilestone !== null ? Number((nextMilestone - currentDD).toFixed(1)) : null;
  const nextMilestonePrice = nextMilestone !== null ? currentATH * (1 + nextMilestone / 100) : null;
  const lastCompletedEpisode = [...episodes].reverse().find((e) => !e.isOngoing) ?? null; // 前回DD3%到達から回復した日（＝前回最高値）
  const prevATHRatio = lastCompletedEpisode ? Number((((currentPrice / lastCompletedEpisode.recoveryPrice) - 1) * 100).toFixed(1)) : null;
  return { FULL, last, currentDD, currentPrice, currentATH, isDrawdown, mode, episode, ddStartIdx, daysSinceDDStart, daysSinceCurrentThreshold, legDays, isEntryLeg, currentTLabel, currentEpisodeCurve, speedCategory, nextProg, modelRow, currentLevelP, currentFreqLabel, athDate, daysSinceATH, trough, episodes, nextMilestone, distanceToNextMilestone, nextMilestonePrice, lastCompletedEpisode, prevATHRatio };
}

const PROGRESSION_DATA = [
  { from: -3, to: -5, p: 55, real: true }, { from: -5, to: -8, p: 52, real: true }, { from: -8, to: -10, p: 72, real: true, watershed: true },
  { from: -10, to: -12, p: 82, real: false }, { from: -12, to: -15, p: 79, real: false }, { from: -15, to: -18, p: 80, real: false },
  { from: -18, to: -20, p: 85, real: false }, { from: -20, to: -25, p: 72, real: false }, { from: -25, to: -30, p: 76, real: false },
  { from: -30, to: -35, p: 70, real: false }, { from: -35, to: -40, p: 68, real: false }, { from: -40, to: -45, p: 65, real: false }, { from: -45, to: -50, p: 60, real: false },
];
const FINAL_REACH_DATA = [
  { label: "-5%", p: 55, real: true }, { label: "-8%", p: 28, real: true }, { label: "-10%", p: 20, real: true }, { label: "-12%", p: 17, real: false },
  { label: "-15%", p: 13, real: true }, { label: "-18%", p: 11, real: false }, { label: "-20%", p: 10, real: true }, { label: "-25%", p: 7, real: false },
  { label: "-30%", p: 5, real: true }, { label: "-35%", p: 3, real: false }, { label: "-40%", p: 2, real: false }, { label: "-45%", p: 1.3, real: false },
  { label: "-50%", p: 0.8, real: false }, { label: "-50%以上", p: 0.4, real: false },
];
const SPEED_TABLE = { fast: { "-8": 56, "-10": 44, "-15": 34, "-20": 25 }, slow: { "-8": 47, "-10": 30, "-15": 13, "-20": 10 } };

/* ---------------- allocation model ---------------- */
const MODEL_ROWS = [
  { label: "+15%", v: 15, A: 12, B: 12, C: 36, D: 22, E: 18 }, { label: "+10%", v: 10, A: 13, B: 12, C: 37, D: 22, E: 16 },
  { label: "+5%", v: 5, A: 14, B: 13, C: 38, D: 20, E: 15 }, { label: "ATH", v: 0, A: 15, B: 13, C: 40, D: 20, E: 12 },
  { label: "DD-3%", v: -3, A: 14, B: 13, C: 41, D: 20, E: 12 }, { label: "DD-5%", v: -5, A: 15, B: 14, C: 42, D: 19, E: 10 },
  { label: "DD-8%", v: -8, A: 16, B: 15, C: 42, D: 18, E: 9 }, { label: "DD-10%", v: -10, A: 17, B: 16, C: 42, D: 17, E: 8 },
  { label: "DD-15%", v: -15, A: 16, B: 16, C: 42, D: 18, E: 8 }, { label: "DD-20%", v: -20, A: 14, B: 15, C: 40, D: 19, E: 12 },
  { label: "DD-30%", v: -30, A: 10, B: 12, C: 38, D: 22, E: 18 }, { label: "DD-50%", v: -50, A: 6, B: 9, C: 33, D: 25, E: 27 },
];
const CATS = ["A", "B", "C", "D", "E"];
// 表示スペース節約用のカテゴリー短縮名（A〜Eランクの説明文生成に使用）。
const CATEGORY_SHORT_LABEL = {
  "SP500": "SP500", "Nasdaq": "Nasdaq", "日本（N225・Topix）": "日本株",
  "個別（米）": "個別（米）", "個別（日）": "個別（日）", "ゴールド": "ゴールド", "現金": "現金",
  "テックETF・投信（米）": "テック投信（米）", "テックETF・投信（日）": "テック投信（日）",
  "高配当ETF・投信（米）": "高配当投信（米）", "高配当ETF・投信（日）": "高配当投信（日）",
  "その他ETF・投信（米）": "その他投信（米）", "その他ETF・投信（日）": "その他投信（日）",
  "レバレッジETF（米）": "レバ（米）", "レバレッジETF（日）": "レバ（日）", "その他": "その他",
};
// 保有銘柄を実際に走査し、A〜E各ランクに含まれるカテゴリー（評価額の大きい順・重複排除）から説明文を動的に生成する。
function rankCategoryLabels(holdings) {
  const sums = { A: {}, B: {}, C: {}, D: {}, E: {} };
  for (const h of holdings) {
    if (!sums[h.rank]) continue;
    sums[h.rank][h.category] = (sums[h.rank][h.category] || 0) + h.amount;
  }
  const result = {};
  for (const rank of CATS) {
    const catSums = sums[rank];
    const cats = Object.keys(catSums).sort((a, b) => catSums[b] - catSums[a]);
    result[rank] = cats.length ? cats.map((c) => CATEGORY_SHORT_LABEL[c] ?? c).join("・") : "該当なし";
  }
  return result;
}

/* ---------------- category taxonomy (fixed list) ---------------- */
const CATEGORIES = [
  "SP500", "Nasdaq", "日本（N225・Topix）", "個別（米）", "個別（日）", "ゴールド", "現金",
  "テックETF・投信（米）", "テックETF・投信（日）", "高配当ETF・投信（米）", "高配当ETF・投信（日）",
  "その他ETF・投信（米）", "その他ETF・投信（日）", "レバレッジETF（米）", "レバレッジETF（日）", "その他",
];
const CATEGORY_COLORS = {
  "SP500": C.teal, "Nasdaq": C.blue, "日本（N225・Topix）": "#BE7A63",
  "個別（米）": "#7C8DB0", "個別（日）": "#C9A06A", "ゴールド": C.amber, "現金": "#7FA37A",
  "テックETF・投信（米）": C.violet, "テックETF・投信（日）": "#C77FB0",
  "高配当ETF・投信（米）": "#4FA0A6", "高配当ETF・投信（日）": "#A3A24B",
  "その他ETF・投信（米）": "#7B9BC7", "その他ETF・投信（日）": "#B98F6A",
  "レバレッジETF（米）": C.rust, "レバレッジETF（日）": "#D98F7A", "その他": C.textDim,
};
// カテゴリー別のデフォルトA〜Eランク（自動推定・分割時に使用。ユーザーは行ごとに自由に上書き可能。
// データ入力画面の「カテゴリー別ランク設定」で変更でき、その場合はここでの値より優先される）
const CATEGORY_DEFAULT_RANK = {
  "SP500": "C", "Nasdaq": "D", "日本（N225・Topix）": "A", "個別（米）": "D", "個別（日）": "D",
  "ゴールド": "B", "現金": "A", "テックETF・投信（米）": "D", "テックETF・投信（日）": "D",
  "高配当ETF・投信（米）": "A", "高配当ETF・投信（日）": "A",
  "その他ETF・投信（米）": "D", "その他ETF・投信（日）": "D",
  "レバレッジETF（米）": "E", "レバレッジETF（日）": "E", "その他": "D",
};

/* ---------------- checkpoints (DD戦略とは別に、ユーザーが任意に設定する保有比率の基準。最大5件) ---------------- */
const CHECKPOINT_SLOTS = 5;
function emptyCheckpoint() { return { enabled: false, label: "", targetType: "category", targetValues: [], direction: "max", thresholdPct: 5 }; }
const DEFAULT_CHECKPOINTS = [
  { enabled: true, label: "レバレッジETF", targetType: "category", targetValues: ["レバレッジETF（米）", "レバレッジETF（日）"], direction: "max", thresholdPct: 5 },
  emptyCheckpoint(), emptyCheckpoint(), emptyCheckpoint(), emptyCheckpoint(),
];
// チェックポイント1件を実際の保有銘柄に対して評価し、判定文を生成する（基準を満たしていればnullではなく「基準内」の文を返す）。
function evaluateCheckpoint(cp, holdings, totalValue) {
  if (!cp || !cp.enabled || !cp.targetValues || cp.targetValues.length === 0 || !totalValue) return null;
  const field = cp.targetType === "rank" ? "rank" : "category";
  const matchSum = holdings.reduce((s, h) => (cp.targetValues.includes(h[field]) ? s + h.amount : s), 0);
  const actualPct = (matchSum / totalValue) * 100;
  const threshold = Number(cp.thresholdPct) || 0;
  const isMax = cp.direction === "max";
  const overBy = isMax ? actualPct - threshold : threshold - actualPct;
  const label = cp.label?.trim() || cp.targetValues.join("+");
  const directionLabel = isMax ? "以内" : "以上";
  if (overBy <= 0) {
    return { ok: true, text: `${label}は全体の${threshold}%${directionLabel}で、現在${actualPct.toFixed(1)}%です（基準内）。` };
  }
  const diffAmountMan = Math.round((totalValue * overBy) / 100 / 10000);
  const verb = isMax ? "超過" : "不足";
  return { ok: false, text: `${label}は全体の${threshold}%${directionLabel}：現在${actualPct.toFixed(1)}%なので${overBy.toFixed(1)}%（約${diffAmountMan.toLocaleString()}万円）${verb}しています。` };
}

/* ---------------- portfolio holdings (default/seed — replaced once real data is imported) ---------------- */
const HOLDINGS_DEFAULT = [
  { id: "seed-1", name: "eMAXIS Slim 米国株式(S&P500)", category: "SP500", currency: "円", rank: "C", account: "特定", owner: "shin", amount: 8200000 },
  { id: "seed-2", name: "SPY", category: "SP500", currency: "ドル", rank: "C", account: "特定", owner: "saki", amount: 6400000 },
  { id: "seed-3", name: "楽天SP500", category: "SP500", currency: "円", rank: "C", account: "NISA成長", owner: "shin", amount: 3100000 },
  { id: "seed-4", name: "2521 円ヘッジSP500", category: "SP500", currency: "円", rank: "B", account: "特定", owner: "saki", amount: 1400000 },
  { id: "seed-5", name: "QQQ", category: "Nasdaq", currency: "ドル", rank: "D", account: "特定", owner: "shin", amount: 4200000 },
  { id: "seed-6", name: "eMAXIS NASDAQ100", category: "Nasdaq", currency: "円", rank: "D", account: "NISA成長", owner: "saki", amount: 2600000 },
  { id: "seed-7", name: "FANG+", category: "テックETF・投信（米）", currency: "円", rank: "D", account: "特定", owner: "shin", amount: 1800000 },
  { id: "seed-8", name: "金プラス(株分)", category: "テックETF・投信（米）", currency: "円", rank: "D", account: "特定", owner: "shin", amount: 700000 },
  { id: "seed-9", name: "SPXL", category: "SP500", currency: "ドル", rank: "E", account: "特定", owner: "shin", amount: 1500000 },
  { id: "seed-10", name: "SOXL", category: "テックETF・投信（米）", currency: "ドル", rank: "E", account: "特定", owner: "shin", amount: 900000 },
  { id: "seed-11", name: "GLD", category: "ゴールド", currency: "ドル", rank: "B", account: "特定", owner: "saki", amount: 3300000 },
  { id: "seed-12", name: "金プラス(金分)", category: "ゴールド", currency: "円", rank: "A", account: "特定", owner: "shin", amount: 700000 },
  { id: "seed-13", name: "HDV", category: "高配当ETF・投信（米）", currency: "ドル", rank: "A", account: "特定", owner: "saki", amount: 2100000 },
  { id: "seed-14", name: "日経高配当(399A)", category: "高配当ETF・投信（日）", currency: "円", rank: "A", account: "NISAつみたて", owner: "shin", amount: 1900000 },
  { id: "seed-15", name: "ITA(防衛)", category: "その他ETF・投信（米）", currency: "ドル", rank: "B", account: "特定", owner: "shin", amount: 1600000 },
  { id: "seed-16", name: "現金(円)", category: "現金", currency: "円", rank: "A", account: "—", owner: "shin", amount: 4800000 },
  { id: "seed-17", name: "現金(ドル)", category: "現金", currency: "ドル", rank: "A", account: "—", owner: "saki", amount: 2200000 },
];
function groupByField(holdings, field) { const map = {}; for (const h of holdings) { map[h[field]] = (map[h[field]] || 0) + h.amount; } return Object.entries(map).map(([k, v]) => ({ name: k, value: v })); }
// A〜Eランク別表示は割合に関わらずA→B→C→D→Eの固定順、それ以外の表示は構成比の大きい順（降順）。
function sortGroupedForView(data, view) {
  if (view === "rank") { const order = CATS; return [...data].sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name)); }
  return [...data].sort((a, b) => b.value - a.value);
}
// カテゴリー数が多い円グラフを見やすくするため、構成比上位n件のみ表示しそれ以降は「その他」にまとめる
// （dataは事前に降順ソート済みである前提。既存の「その他」があればそこに合算し重複させない）。
function aggregateTopN(data, n) {
  if (data.length <= n) return data;
  const top = data.slice(0, n).map((g) => ({ ...g }));
  const restSum = data.slice(n).reduce((s, g) => s + g.value, 0);
  const idx = top.findIndex((g) => g.name === "その他");
  if (idx !== -1) top[idx].value += restSum;
  else top.push({ name: "その他", value: restSum });
  return top;
}
function holdingsTotal(holdings) { return holdings.reduce((s, h) => s + h.amount, 0); }
function currentHoldingPctFromHoldings(holdings) {
  const total = holdingsTotal(holdings) || 1;
  const byRank = groupByField(holdings, "rank");
  const pct = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  for (const r of byRank) if (pct[r.name] !== undefined) pct[r.name] = Number(((r.value / total) * 100).toFixed(1));
  return pct;
}
const CURRENCY_COLORS = { "ドル": C.teal, "円": C.amber };
const OWNER_COLORS = { "shin": C.blue, "saki": C.violet };
function colorForView(view, key) { return view === "category" ? (CATEGORY_COLORS[key] || C.textDim) : view === "currency" ? CURRENCY_COLORS[key] : view === "owner" ? (OWNER_COLORS[key] || C.textDim) : rankColor(key); }
function fieldForView(view) { return view === "category" ? "category" : view === "currency" ? "currency" : view === "owner" ? "owner" : "rank"; }

/* ---------------- Rakuten Securities CSV (Shift-JIS) ---------------- */
function decodeShiftJIS(buffer) { try { return new TextDecoder("shift-jis").decode(buffer); } catch (e) { return new TextDecoder("utf-8").decode(buffer); } }
function splitCsvLine(line) {
  const out = []; let cur = ""; let inQ = false;
  for (let i = 0; i < line.length; i++) { const ch = line[i]; if (ch === '"') { inQ = !inQ; continue; } if (ch === "," && !inQ) { out.push(cur); cur = ""; continue; } cur += ch; }
  out.push(cur);
  return out.map((s) => s.trim());
}
function parseYen(s) { if (s == null) return NaN; return parseFloat(String(s).replace(/[,¥\s]/g, "")); }
function toHalfWidth(s) { return String(s ?? "").normalize("NFKC"); }
function genId() { try { return crypto.randomUUID(); } catch (e) { return `id-${Date.now()}-${Math.random().toString(36).slice(2)}`; } }
// ゴールドプラス系の分割銘柄名（末尾の「（ゴールド）」「（テックETF・投信（米）」等）から元の銘柄名を取り出す。
// カテゴリー名自体に括弧を含むもの（例：「テックETF・投信（米）」）があるため、既知のカテゴリー一覧に対する完全一致で末尾を判定する（単純な正規表現では入れ子の括弧を検出できない）。
function baseHoldingName(name) {
  const s = String(name ?? "");
  for (const cat of CATEGORIES) {
    const suffix = `（${cat}）`;
    if (s.endsWith(suffix)) return s.slice(0, -suffix.length);
  }
  return s;
}
// 種別(国内株式/米国株式/投資信託/外貨預り金)とティッカー・銘柄名から、CATEGORIES（固定14分類）のいずれかを推定する。
// 楽天のCSVはティッカーと日本語の銘柄名が別列のため、両方を正規化して突き合わせる。
// テーマ別カテゴリー（高配当/テック/その他ETF）は米国・日本の2種類に分かれるため、名称に「米国」等があるかで判定する。
function guessCategory(rawName, ticker, assetType) {
  if (assetType === "外貨預り金") return "現金";
  const norm = toHalfWidth(`${ticker ?? ""} ${rawName ?? ""}`);
  if (/S&P500|SP500|VOO|SPY|楽天SP500|円ヘッジ|2521/.test(norm)) return "SP500";
  if (/NASDAQ|ナスダック|QQQ/i.test(norm)) return "Nasdaq";
  if (/GLD|ゴールド|金プラス|プラチナ/.test(norm)) return "ゴールド";
  if (/現金|MRF|預り金/.test(norm)) return "現金";
  const mentionsUS = /米国|全世界|グローバル|USA?\b/i.test(norm);
  const mentionsJP = /日経|N225|TOPIX|JPX|日本株|国内株/.test(norm);
  const isJP = mentionsJP || (assetType === "国内株式" && !mentionsUS);
  if (mentionsJP && !/高配当|テック|モメンタム/.test(norm)) return "日本（N225・Topix）";
  if (/高配当|HDV/.test(norm)) return isJP ? "高配当ETF・投信（日）" : "高配当ETF・投信（米）";
  if (/レバレッジ|ブル|SPXL|SPUU|SOXL|MSFU|METU|TQQQ|LABU|TECL|FAS|SSO|UPRO|3倍|2倍/.test(norm)) return isJP ? "レバレッジETF（日）" : "レバレッジETF（米）";
  if (/FANG|テック指数|Zテック/.test(norm)) return isJP ? "テックETF・投信（日）" : "テックETF・投信（米）";
  if (/モメンタム|トレンドランキング|ITA|防衛/.test(norm)) return isJP ? "その他ETF・投信（日）" : "その他ETF・投信（米）";
  if (assetType === "国内株式") return isJP ? "個別（日）" : "個別（米）";
  if (assetType === "米国株式") return "個別（米）";
  return "その他";
}
function guessCategoryRank(rawName, ticker, assetType) {
  const category = guessCategory(rawName, ticker, assetType);
  return { category, rank: CATEGORY_DEFAULT_RANK[category] ?? "D" };
}
// 米国株指数・米国株連動の資産は、円建て（国内上場ETF/投信）でも為替はドルの影響を受けるため「ドル」扱いにする。
// カテゴリーが米国系（SP500/Nasdaq/個別（米）等）であるか、銘柄名に米国関連キーワードが含まれる場合に該当。
const USD_EXPOSURE_CATEGORIES = new Set(["SP500", "Nasdaq", "個別（米）", "テックETF・投信（米）", "高配当ETF・投信（米）", "その他ETF・投信（米）", "レバレッジETF（米）"]);
function isUsdExposure(rawName, ticker, category) {
  if (USD_EXPOSURE_CATEGORIES.has(category)) return true;
  const norm = toHalfWidth(`${ticker ?? ""} ${rawName ?? ""}`);
  return /S&P\s*500|SP500|NASDAQ|ナスダック|米国|アメリカ|USA?\b/i.test(norm);
}
// 「ゴールドプラス」系の複合ファンド（ゴールド＋株価指数）を検出し、判明しているものは自動でペア先カテゴリーを返す。
function detectKnownGoldPlusPair(normName) {
  if (normName.includes("FANG") && normName.includes("ゴールド")) return "テックETF・投信（米）";
  if (/S&P\s*500/i.test(normName) && normName.includes("ゴールド")) return "SP500";
  if ((normName.includes("NASDAQ") || normName.includes("ナスダック")) && normName.includes("ゴールド")) return "Nasdaq";
  if (/日経|N225|TOPIX|JPX/.test(normName) && normName.includes("ゴールド")) return "日本（N225・Topix）";
  return null;
}
function isGoldPlusCandidate(normName) { return /ゴールド/.test(normName) && /プラス|\+/.test(normName); }
// 明細行を「ゴールドプラス」系は自動で2行（ゴールド分＋対象カテゴリー分、評価額50%ずつ）に分割する。
// 判明していない組み合わせは分割せず、splitCandidate フラグを立ててプレビュー画面でユーザーに確認してもらう。
function expandGoldPlusSplits(rows) {
  const out = [];
  for (const r of rows) {
    const norm = toHalfWidth(r.name);
    if (!isGoldPlusCandidate(norm)) { out.push(r); continue; }
    const pair = detectKnownGoldPlusPair(norm);
    if (!pair) { out.push({ ...r, splitCandidate: true, suggestedPairCategory: "その他" }); continue; }
    const half = Math.round(r.amount / 2);
    out.push({ ...r, name: `${r.name}（ゴールド）`, category: "ゴールド", rank: CATEGORY_DEFAULT_RANK["ゴールド"], amount: half });
    const pairCurrency = isUsdExposure(r.name, "", pair) ? "ドル" : r.currency;
    out.push({ ...r, name: `${r.name}（${pair}）`, category: pair, rank: CATEGORY_DEFAULT_RANK[pair], amount: r.amount - half, currency: pairCurrency });
  }
  return out;
}
// 単位列（円/USD）から通貨を判定する。銘柄名の見た目からの推測は実データ（日本語の説明的な名称）では機能しないため使わない。
function pickCurrency(...units) {
  for (const u of units) { if (u === "USD") return "ドル"; if (u === "円") return "円"; }
  return "円";
}
// ファイル名（例: assetbalance(all)_20260831_shin.csv）に含まれる "shin"/"saki" から口座主を判定する。
function detectOwnerFromFileName(name) {
  const lower = String(name ?? "").toLowerCase();
  if (/saki/.test(lower)) return "saki";
  if (/shin/.test(lower)) return "shin";
  return null;
}
function normalizeAccount(a) {
  if (a === "-" || a === "‐" || a === "―") return "—";
  return a.replace(/投資枠$/, "");
}
// ■資産合計欄（サマリー）から「預り金」（円建てのみ）または「外貨預り金」（外貨建てのみ）の合計額[円]を拾う。
// 「預り金合計」は円+外貨の合計なので対象外（二重計上防止のため、その行自体は探さない）。
function findSummaryCashAmount(summaryLines, label) {
  for (const line of summaryLines) {
    const c = splitCsvLine(line);
    if (c[0] === label) { const v = parseYen(c[1]); return isNaN(v) ? 0 : v; }
  }
  return 0;
}
function parseRakutenCSV(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let headerIdx = -1, cols = null;
  for (let i = 0; i < lines.length; i++) {
    const c = splitCsvLine(lines[i]);
    if (c.some((x) => x === "銘柄") && c.some((x) => x === "口座") && c.some((x) => x.includes("評価額"))) { headerIdx = i; cols = c; break; }
  }
  if (headerIdx === -1) return [];
  const typeIdx = cols.findIndex((x) => x === "種別");
  const tickerIdx = cols.findIndex((x) => x.includes("銘柄コード"));
  const nameIdx = cols.findIndex((x) => x === "銘柄");
  const accountIdx = cols.findIndex((x) => x === "口座");
  const qtyIdx = cols.findIndex((x) => x === "保有数量");
  const avgCostIdx = cols.findIndex((x) => x === "平均取得価額");
  const curValIdx = cols.findIndex((x) => x === "現在値");
  const amountIdx = cols.findIndex((x) => x.includes("時価評価額[円]"));
  if (nameIdx === -1 || amountIdx === -1) return [];
  const rows = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const c = splitCsvLine(lines[i]);
    if (c.length <= amountIdx || !c[nameIdx]) continue;
    const rawName = c[nameIdx];
    if (!rawName || rawName.includes("合計")) continue;
    const assetType = typeIdx !== -1 ? c[typeIdx] : "";
    if (assetType === "外貨預り金") continue; // 明細欄のこの行は通貨別の内訳が不完全なため使わず、サマリー欄の合計を別途使う
    const amount = parseYen(c[amountIdx]);
    if (isNaN(amount) || amount === 0) continue;
    const ticker = tickerIdx !== -1 ? c[tickerIdx] : "";
    const name = ticker ? `${ticker} ${rawName}` : rawName;
    const account = normalizeAccount(accountIdx !== -1 && c[accountIdx] ? c[accountIdx] : "特定");
    const rawCurrency = pickCurrency(
      avgCostIdx !== -1 ? c[avgCostIdx + 1] : null,
      curValIdx !== -1 ? c[curValIdx + 1] : null,
      qtyIdx !== -1 ? c[qtyIdx + 1] : null,
    );
    const guess = guessCategoryRank(rawName, ticker, assetType);
    const currency = isUsdExposure(rawName, ticker, guess.category) ? "ドル" : rawCurrency;
    rows.push({ name, account, amount, category: guess.category, rank: guess.rank, currency });
  }
  const summaryLines = lines.slice(0, headerIdx);
  const jpyCash = findSummaryCashAmount(summaryLines, "預り金");
  const fxCash = findSummaryCashAmount(summaryLines, "外貨預り金");
  if (jpyCash > 0) rows.push({ name: "現金(円)", account: "—", amount: jpyCash, category: "現金", rank: "A", currency: "円" });
  if (fxCash > 0) rows.push({ name: "現金(ドル)", account: "—", amount: fxCash, category: "現金", rank: "A", currency: "ドル" });
  return rows;
}

/* ---------------- historical crashes (approximate, for shape comparison) ---------------- */
function buildCrashCurve({ troughDay, recoveryDay, maxDD, seed }) {
  const rnd = mulberry32(seed); const arr = [];
  for (let d = 0; d <= recoveryDay; d++) {
    let dd;
    if (d <= troughDay) { const t = troughDay === 0 ? 1 : d / troughDay; dd = maxDD * Math.pow(t, 1.3); }
    else { const t = (d - troughDay) / Math.max(1, recoveryDay - troughDay); const s = t * t * (3 - 2 * t); dd = maxDD * (1 - s); }
    const noise = (rnd() - 0.5) * Math.abs(maxDD) * 0.04;
    dd = Math.min(0, Math.max(maxDD * 1.05, dd + noise));
    arr.push({ day: d, dd: Number(dd.toFixed(2)) });
  }
  arr[0].dd = 0;
  return arr;
}
function fmtDuration(days) { const months = days / 21; if (months >= 12) return `約${(months / 12).toFixed(1)}年`; return `約${Math.round(months)}ヶ月`; }
const CRASHES_META = [
  { id: "1987", name: "ブラックマンデー", start: "1987-08-25", low: "1987-10-19", athRecovery: "1989年頃", maxDD: -33.2, troughDay: 38, recoveryDay: 520, color: C.violet,
    cause: "プログラム売買の連鎖的な自動売り、ポートフォリオインシュアランスの逆機能、投資家心理の急速な悪化。単一の日(10/19)で市場全体が約20%下落。",
    resolution: "FRB(グリーンスパン議長)による迅速な流動性供給の表明、実体経済への波及が限定的だったこと。",
    lesson: "暴落自体は歴史上最も急激だったが、実体経済が堅調であれば株価の回復も比較的早い。市場構造(プログラム売買)が引き金でもファンダメンタルズが崩れていなければ回復力がある。" },
  { id: "dotcom", name: "ドットコムバブル崩壊", start: "2000-03-24", low: "2002-10-09", athRecovery: "2007年頃", maxDD: -49.1, troughDay: 650, recoveryDay: 1764, color: C.blue,
    cause: "ITバブルの過剰な期待と高PERのハイテク株の急落。2001年の同時多発テロによる景気後退の追い打ち、企業会計不正(エンロン等)による信頼失墜。",
    resolution: "FRBの継続的な利下げ、景気の底打ちと企業収益の回復。",
    lesson: "バブル的な高評価を伴う下落は回復に非常に時間がかかる(今回は約7年)。下落期間中に複数回の戻り相場(ベアマーケットラリー)があり、早期の「底打ち」判断は危険。" },
  { id: "gfc", name: "リーマンショック(世界金融危機)", start: "2007-10-09", low: "2009-03-09", athRecovery: "2013年頃", maxDD: -56.8, troughDay: 356, recoveryDay: 1360, color: C.rust,
    cause: "サブプライムローン危機に端を発する金融システム全体の信用収縮。リーマン・ブラザーズ破綻による連鎖的な金融不安。",
    resolution: "各国中央銀行・政府による大規模な金融緩和と公的資金注入、量的緩和(QE)の開始。",
    lesson: "金融システム自体が毀損すると回復に数年単位を要する。政策対応(流動性供給)のスピードと規模が回復ペースを大きく左右する。" },
  { id: "covid", name: "コロナショック", start: "2020-02-19", low: "2020-03-23", athRecovery: "2020年8月頃", maxDD: -33.9, troughDay: 23, recoveryDay: 125, color: C.amber,
    cause: "新型コロナウイルスの世界的流行による経済活動の急停止(ロックダウン)。",
    resolution: "各国政府・中央銀行による前例のない規模の財政・金融刺激策、ワクチン開発への期待。",
    lesson: "外生的ショック(感染症等)による暴落は、政策対応が迅速であれば歴史的に見て最も回復が早いパターンになりうる(今回は約半年)。深さだけでなく「原因の性質」が回復速度を左右する。" },
];
const CRASHES = CRASHES_META.map((c, i) => ({ ...c, curve: buildCrashCurve({ troughDay: c.troughDay, recoveryDay: c.recoveryDay, maxDD: c.maxDD, seed: 200 + i }) }));
const MAX_CMP_DAY = Math.max(...CRASHES.map((c) => c.recoveryDay));
function buildComparisonData(currentEpisodeCurve) {
  const rows = [];
  for (let d = 0; d <= MAX_CMP_DAY; d++) {
    const row = { day: d };
    for (const c of CRASHES) row[c.id] = d < c.curve.length ? c.curve[d].dd : 0;
    row.current = d < currentEpisodeCurve.length ? currentEpisodeCurve[d].dd : undefined;
    rows.push(row);
  }
  const step = Math.max(1, Math.ceil(rows.length / 320));
  const out = []; for (let k = 0; k < rows.length; k += step) out.push(rows[k]);
  if (out[out.length - 1] !== rows[rows.length - 1]) out.push(rows[rows.length - 1]);
  return out;
}

/* ---------------- period selector ---------------- */
const PERIODS = [{ key: "1M", label: "1ヶ月", days: 21 }, { key: "3M", label: "3ヶ月", days: 63 }, { key: "6M", label: "6ヶ月", days: 126 }, { key: "YTD", label: "年初来" }, { key: "1Y", label: "1年", days: 252 }, { key: "3Y", label: "3年", days: 756 }, { key: "5Y", label: "5年", days: 1260 }, { key: "10Y", label: "10年", days: 2520 }, { key: "20Y", label: "20年", days: 5040 }, { key: "30Y", label: "30年", days: 7560 }, { key: "MAX", label: "最長" }];
function sliceForPeriod(FULL, last, key) {
  let sliced;
  if (key === "MAX") sliced = FULL;
  else if (key === "YTD") { const y = last.date.getFullYear(); sliced = FULL.filter((p) => p.date.getFullYear() === y); }
  else { const days = PERIODS.find((p) => p.key === key).days; sliced = FULL.slice(-days); }
  if (!sliced.length) sliced = FULL;
  const step = Math.max(1, Math.ceil(sliced.length / 260));
  // 単純な等間隔の間引きだと、バケット内で一瞬だけ付けた高値（ATH更新）や急落の底値がサンプル点から漏れ、
  // 長期間表示でDD%が実際の値動きより滑らかに（＝評価額の形をなぞっただけのように）見えてしまう。
  // そのためバケットごとに「評価額のピーク」と「DDの底」を両方残し、実際の高値・安値を欠落させない。
  const out = [];
  for (let k = 0; k < sliced.length; k += step) {
    const end = Math.min(k + step, sliced.length);
    let peak = sliced[k], trough = sliced[k];
    for (let j = k + 1; j < end; j++) { if (sliced[j].price > peak.price) peak = sliced[j]; if (sliced[j].dd < trough.dd) trough = sliced[j]; }
    if (peak === trough) out.push(peak);
    else if (peak.i < trough.i) out.push(peak, trough);
    else out.push(trough, peak);
  }
  if (out[out.length - 1] !== sliced[sliced.length - 1]) out.push(sliced[sliced.length - 1]);
  return out;
}
function fmtAxisDate(d, rangeDays) { if (rangeDays > 900) return `${d.getFullYear()}`; if (rangeDays > 120) return `${d.getFullYear()}/${d.getMonth() + 1}`; return `${d.getMonth() + 1}/${d.getDate()}`; }
function fmtYMD(d) { return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`; }
// チャートのX軸はcategory軸のため、ReferenceDotのxはchartData内の実際の点と一致している必要がある。
// 間引き表示で厳密な日付が省略されている場合があるため、表示中の点のうち最も日付が近いものにスナップする。
function nearestChartPoint(chartData, targetDate) {
  let best = chartData[0], bestDiff = Math.abs(chartData[0].date - targetDate);
  for (const p of chartData) { const diff = Math.abs(p.date - targetDate); if (diff < bestDiff) { best = p; bestDiff = diff; } }
  return best;
}

// Rechartsの<ReferenceDot>はx値がnumber/stringでないと描画されず(Date型のcategory軸では使えない)、
// このアプリの日付軸(dataKey="date"がDateオブジェクト)とは相性が悪い。
// そのためxAxisMap/yAxisMapの実スケール関数を<Customized>経由で直接使い、マーカーを自前のSVGで描画する。
// dotOnly:true の点はラベルを常時表示せず、ホバー時のみ吹き出しツールチップで詳細を表示する（長期チャート向け）。
function ChartMarkers({ xAxisMap, yAxisMap, points, chartWidth }) {
  const [hoverIdx, setHoverIdx] = useState(null);
  const xAxis = xAxisMap && xAxisMap[Object.keys(xAxisMap)[0]];
  const yAxis = yAxisMap && yAxisMap.price;
  if (!xAxis || !yAxis) return null;
  const xScale = xAxis.scale, yScale = yAxis.scale;
  const bandOffset = xScale && xScale.bandwidth ? xScale.bandwidth() / 2 : 0;
  const positioned = points
    .map((pt) => ({ ...pt, cx: xScale(pt.date) + bandOffset, cy: yScale(pt.price) }))
    .filter((pt) => pt.cx != null && pt.cy != null && !Number.isNaN(pt.cx) && !Number.isNaN(pt.cy));
  // ラベル同士が近接して重なる場合は、後の点（x座標が右側）のラベルを上に積んでずらす（常時ラベル表示の点のみ対象）。
  const sorted = [...positioned].sort((a, b) => a.cx - b.cx);
  let labelOffset = 0;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].dotOnly || sorted[i - 1].dotOnly) { labelOffset = 0; continue; }
    if (sorted[i].cx - sorted[i - 1].cx < 70) { labelOffset += 12; sorted[i].labelOffset = labelOffset; } else { labelOffset = 0; }
  }
  const hovered = hoverIdx != null ? sorted[hoverIdx] : null;
  return (
    <g>
      {sorted.map((pt, i) => (
        <g key={i}
          onMouseEnter={pt.dotOnly ? () => setHoverIdx(i) : undefined}
          onMouseLeave={pt.dotOnly ? () => setHoverIdx((h) => (h === i ? null : h)) : undefined}
        >
          <circle cx={pt.cx} cy={pt.cy} r={pt.dotOnly ? 4 : 4} fill={pt.color} stroke={C.bg} strokeWidth={1.5} style={pt.dotOnly ? { cursor: "pointer" } : undefined} />
          {pt.dotOnly && <circle cx={pt.cx} cy={pt.cy} r={9} fill="transparent" style={{ cursor: "pointer" }} />}
          {!pt.dotOnly && (
            <text x={pt.cx} y={pt.cy - 8 - (pt.labelOffset || 0)} textAnchor={pt.anchor || "middle"} fontSize={pt.fontSize} fill={pt.color} className="mono">{pt.label}</text>
          )}
        </g>
      ))}
      {hovered && (() => {
        const w = Math.max(90, hovered.label.length * (hovered.fontSize * 0.62) + 12);
        const cxClamped = Math.min(Math.max(hovered.cx, w / 2 + 2), (chartWidth ?? 100000) - w / 2 - 2);
        return (
          <g style={{ pointerEvents: "none" }}>
            <rect x={cxClamped - w / 2} y={hovered.cy - 32} width={w} height={18} rx={3} fill={C.panel} stroke={C.border} />
            <text x={cxClamped} y={hovered.cy - 19} textAnchor="middle" fontSize={hovered.fontSize} fill={hovered.color} className="mono">{hovered.label}</text>
          </g>
        );
      })()}
    </g>
  );
}

/* ---------------- reusable evaluation/DD composed chart ---------------- */
function EvalDDChartBody({ chartData, rangeDays, d, hidden, withBrush = false, fontSize = 10, width, height }) {
  const chartFirst = chartData[0].date, chartLast = chartData[chartData.length - 1].date;
  const markerFontSize = Math.max(8, fontSize - 1);
  const isShortTerm = rangeDays <= 200; // 1・3・6ヶ月＝ラベル常時表示、1年以上＝点のみ＋ホバーで詳細
  const maxDrawdownInView = Math.min(0, ...chartData.map((p) => p.dd)); // 表示期間内の最大DD%（最も深い下落）
  const ddTicks = ddAxisTicksForMaxDrawdown(maxDrawdownInView);
  const markerPoints = [];
  if (!hidden.price) {
    const seenIdx = new Set();
    const addPt = (idx, date, price, color, label) => {
      if (seenIdx.has(idx) || !(chartFirst <= date && date <= chartLast)) return;
      seenIdx.add(idx);
      const p = nearestChartPoint(chartData, date);
      markerPoints.push({ date: p.date, price: p.price, color, anchor: "middle", fontSize: markerFontSize, label, dotOnly: !isShortTerm });
    };
    // 過去の各DD局面（ATH→底値→回復）
    for (const ep of d.episodes) {
      if (ep.isOngoing) continue;
      addPt(ep.athIdx, ep.athDate, ep.athPrice, C.teal, `$${ep.athPrice.toFixed(2)}（${fmtYMD(ep.athDate)}）`);
      if (ep.troughIdx !== ep.athIdx) addPt(ep.troughIdx, ep.troughDate, ep.troughPrice, C.rust, `$${ep.troughPrice.toFixed(2)}（${fmtYMD(ep.troughDate)}）DD${ep.troughDD.toFixed(1)}%`);
      if (ep.recoveryIdx !== ep.troughIdx) addPt(ep.recoveryIdx, ep.recoveryDate, ep.recoveryPrice, C.blue, `$${ep.recoveryPrice.toFixed(2)}（${fmtYMD(ep.recoveryDate)}）`);
    }
    // 現在進行中の局面（ATH→底値→現在）
    addPt(d.episode.athIdx, d.athDate, d.currentATH, C.teal, `$${d.currentATH.toFixed(2)}（${fmtYMD(d.athDate)}）`);
    const troughIsToday = d.trough.i === d.last.i; // 底値がまだ今日（未回復）の場合は現在値マーカーと重なるため統合する
    if (!troughIsToday && d.trough.i !== d.episode.athIdx) addPt(d.trough.i, d.trough.date, d.trough.price, C.rust, `$${d.trough.price.toFixed(2)}（${fmtYMD(d.trough.date)}）DD${d.trough.dd.toFixed(1)}%`);
    const currentLabel = troughIsToday
      ? `$${d.currentPrice.toFixed(2)}（${fmtYMD(d.last.date)}）DD${d.currentDD.toFixed(1)}%`
      : `$${d.currentPrice.toFixed(2)}（${fmtYMD(d.last.date)}）`;
    markerPoints.push({ date: chartLast, price: d.currentPrice, color: depthColor(d.currentDD), anchor: "end", fontSize: markerFontSize, label: currentLabel, dotOnly: !isShortTerm });
  }
  return (
    <ComposedChart width={width} height={height} data={chartData} margin={{ top: 12, right: 44, left: 0, bottom: withBrush ? 0 : 0 }}>
      <defs>
        <linearGradient id="ddFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.rust} stopOpacity={0} /><stop offset="100%" stopColor={C.rust} stopOpacity={0.32} /></linearGradient>
        <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.teal} stopOpacity={0.22} /><stop offset="100%" stopColor={C.teal} stopOpacity={0} /></linearGradient>
      </defs>
      <CartesianGrid stroke={C.borderSoft} vertical={false} />
      <XAxis dataKey="date" tickFormatter={(dt) => fmtAxisDate(dt, rangeDays)} tick={{ fill: C.textDim, fontSize }} axisLine={{ stroke: C.border }} tickLine={false} minTickGap={40} />
      <YAxis yAxisId="price" domain={["auto", "auto"]} tick={{ fill: C.teal, fontSize }} axisLine={false} tickLine={false} width={48} label={{ value: "評価額", angle: -90, position: "insideLeft", fill: C.teal, fontSize }} />
      <YAxis yAxisId="dd" orientation="right" domain={[ddTicks[ddTicks.length - 1], 0]} ticks={ddTicks} tick={{ fill: C.rust, fontSize }} axisLine={false} tickLine={false} width={46} label={{ value: "DD%", angle: 90, position: "insideRight", fill: C.rust, fontSize }} />
      <Tooltip contentStyle={{ background: C.panel, border: `1px solid ${C.border}`, fontSize: 12 }} labelStyle={{ color: C.textMuted }} labelFormatter={(dt) => dt.toLocaleDateString("ja-JP")} formatter={(v, name) => [name === "dd" ? `${v}%` : `$${v}`, name === "dd" ? "DD" : name === "ath" ? "ATH" : "評価額"]} />
      {MILESTONES.filter((t) => t !== -3).map((t) => (<ReferenceLine key={t} yAxisId="dd" y={t} stroke={C.borderSoft} strokeDasharray="2 3" label={{ value: `${t}%`, position: "left", fill: C.textDim, fontSize: Math.max(8, fontSize - 2) }} />))}
      <ReferenceLine yAxisId="dd" y={-3} stroke={C.rust} strokeDasharray="4 3" strokeWidth={1.3} label={{ value: "-3%", position: "left", fill: C.rust, fontSize: Math.max(8, fontSize - 2) }} />
      {chartData[0].date < SPY_LISTING_DATE && chartData[chartData.length - 1].date > SPY_LISTING_DATE && (<ReferenceLine yAxisId="price" x={SPY_LISTING_DATE} stroke={C.violet} strokeDasharray="3 3" label={{ value: "SPY上場", fill: C.violet, fontSize: Math.max(9, fontSize - 1), position: "top" }} />)}
      <Area yAxisId="dd" type="monotone" dataKey="dd" stroke={C.rust} fill="url(#ddFill)" strokeWidth={1.3} dot={false} isAnimationActive={false} fillOpacity={hidden.dd ? 0 : 1} strokeOpacity={hidden.dd ? 0 : 1} />
      <Area yAxisId="price" type="monotone" dataKey="price" stroke={C.teal} fill="url(#priceFill)" strokeWidth={1.8} dot={false} isAnimationActive={false} fillOpacity={hidden.price ? 0 : 1} strokeOpacity={hidden.price ? 0 : 1} />
      <Line yAxisId="price" type="monotone" dataKey="ath" stroke={C.textDim} strokeDasharray="3 4" strokeWidth={1} dot={false} isAnimationActive={false} strokeOpacity={hidden.price ? 0 : 1} />
      {markerPoints.length > 0 && <Customized component={<ChartMarkers points={markerPoints} chartWidth={width} />} />}
      {withBrush && <Brush dataKey="date" height={26} stroke={C.teal} fill={C.panel2} tickFormatter={(dt) => fmtAxisDate(new Date(dt), rangeDays)} travellerWidth={8} />}
    </ComposedChart>
  );
}
function DDChartModalContent({ chartData, rangeDays, d, hidden, toggle, period, setPeriod }) {
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <ClickLegend items={[{ key: "price", label: "評価額 / ATH", color: C.teal }, { key: "dd", label: "DD%", color: C.rust }]} hidden={hidden} onToggle={toggle} />
        <div className="flex gap-0.5">{PERIODS.map((p) => (<button key={p.key} onClick={() => setPeriod(p.key)} className="text-[11px] px-2 py-1 rounded" style={{ color: period === p.key ? C.bg : C.textMuted, background: period === p.key ? C.teal : "transparent", fontWeight: period === p.key ? 700 : 400 }}>{p.label}</button>))}</div>
      </div>
      <div style={{ height: "min(70vh, 640px)" }}>
        <ResponsiveContainer width="100%" height="100%" key={period}>
          <EvalDDChartBody chartData={chartData} rangeDays={rangeDays} d={d} hidden={hidden} withBrush fontSize={12} />
        </ResponsiveContainer>
      </div>
      <div className="mt-3 text-[10px]" style={{ color: C.textDim }}>下部のスクロールバーをドラッグして期間を絞り込み（ズーム）できます。グラフ上にカーソルを合わせるとツールチップが表示されます。</div>
    </div>
  );
}

/* ---------------- depth gauge ---------------- */
function DepthGauge({ dd }) {
  const marks = [0, ...MILESTONES]; const top = 0, bottom = -55;
  const pct = (v) => ((v - top) / (bottom - top)) * 100;
  const markerPct = Math.min(100, Math.max(0, pct(Math.max(dd, bottom))));
  return (
    <div className="flex flex-col items-center h-full py-4" style={{ width: 64, background: C.panel2, borderRight: `1px solid ${C.border}` }}>
      <div className="text-[10px] tracking-widest" style={{ color: C.textDim, writingMode: "vertical-rl" }}>DEPTH GAUGE</div>
      <div className="relative flex-1 mt-3" style={{ width: 6 }}>
        <div className="absolute inset-0 rounded-full" style={{ background: `linear-gradient(to bottom, ${C.teal} 0%, ${C.amber} 45%, ${C.rust} 100%)`, opacity: 0.35 }} />
        {marks.map((m) => (<div key={m} className="absolute flex items-center" style={{ top: `${pct(m)}%`, left: 10, transform: "translateY(-50%)" }}><div style={{ width: 8, height: 1, background: C.borderSoft }} /><span className="ml-1 text-[8px] font-mono" style={{ color: C.textDim }}>{m === 0 ? "ATH" : `${m}`}</span></div>))}
        <div className="absolute rounded-full" style={{ top: `${markerPct}%`, left: "50%", width: 14, height: 14, transform: "translate(-50%,-50%)", background: depthColor(dd), boxShadow: `0 0 0 4px ${depthColor(dd)}33, 0 0 12px ${depthColor(dd)}88` }} />
      </div>
      <div className="mt-3 font-mono text-sm font-semibold px-2 py-1 rounded" style={{ color: depthColor(dd), background: `${depthColor(dd)}1a` }}>{dd.toFixed(1)}%</div>
    </div>
  );
}

/* ---------------- atoms ---------------- */
function Panel({ title, action, children, className = "", style, hideHeader = false }) {
  return (
    <div className={`rounded-lg flex flex-col ${className}`} style={{ background: C.panel, border: `1px solid ${C.border}`, ...style }}>
      {!hideHeader && (
        <div className="flex items-center justify-between px-4 py-2" style={{ borderBottom: `1px solid ${C.borderSoft}` }}>
          <span className="text-xs font-medium tracking-wide" style={{ color: C.textMuted }}>{title}</span>
          {action}
        </div>
      )}
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}
function DiffBar({ cat, current, target, onClick, label }) {
  const diff = Number((current - target).toFixed(1)); const max = 50; const emphasize = Math.abs(diff) >= 4;
  const catColor = rankColor(cat); // ポートフォリオ構成（A〜Eランク）の円グラフと同じ配色に統一
  return (
    <div onClick={onClick} className="px-3 py-0.5 flex items-center gap-2" style={{ borderBottom: `1px solid ${C.borderSoft}`, cursor: "pointer" }}>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between">
          <div className="flex items-baseline gap-1.5 min-w-0"><span className="text-xs font-semibold shrink-0" style={{ color: catColor }}>{cat}</span><span className="text-[10px] truncate" style={{ color: C.textDim }} title={label}>{label}</span></div>
          <div className="flex items-baseline gap-1 font-mono text-[10px] shrink-0 ml-2"><span style={{ color: C.textMuted }}>実績{current}%</span><span style={{ color: C.textDim }}>モデル{target}%</span><span className="font-semibold px-1 rounded" style={{ color: emphasize ? C.rust : C.textMuted, background: emphasize ? C.rustSoft : "transparent" }}>{diff > 0 ? "+" : ""}{diff}</span></div>
        </div>
        <div className="relative h-1 rounded-full" style={{ background: C.panel2 }}>
          <div className="absolute top-0 h-1 rounded-full" style={{ width: `${(target / max) * 100}%`, background: C.borderSoft }} />
          <div className="absolute top-0 h-1 rounded-full" style={{ width: `${(current / max) * 100}%`, background: catColor, opacity: emphasize ? 1 : 0.75 }} />
          <div className="absolute" style={{ left: `${(target / max) * 100}%`, top: -2.5, width: 2, height: 10, background: C.text, opacity: 0.6 }} />
        </div>
      </div>
      <ChevronRight size={13} style={{ color: C.textDim, flexShrink: 0 }} />
    </div>
  );
}

/* ---------------- sortable table ---------------- */
function SortableTable({ columns, rows, defaultSortKey, defaultDir = "desc", onEditCell, onDeleteRow }) {
  const [sortKey, setSortKey] = useState(defaultSortKey);
  const [dir, setDir] = useState(defaultDir);
  const sorted = useMemo(() => { const copy = [...rows]; copy.sort((a, b) => { const av = a[sortKey], bv = b[sortKey]; if (typeof av === "number") return dir === "asc" ? av - bv : bv - av; return dir === "asc" ? String(av).localeCompare(String(bv), "ja") : String(bv).localeCompare(String(av), "ja"); }); return copy; }, [rows, sortKey, dir]);
  const headerClick = (key) => { if (key === sortKey) setDir((d) => (d === "asc" ? "desc" : "asc")); else { setSortKey(key); setDir("desc"); } };
  return (
    <table className="w-full text-xs mono">
      <thead><tr style={{ color: C.textDim }}>{columns.map((col) => (<th key={col.key} onClick={() => headerClick(col.key)} className={`font-normal py-1 select-none ${col.align === "right" ? "text-right" : "text-left"}`} style={{ cursor: "pointer", color: sortKey === col.key ? C.textMuted : C.textDim }}>{col.label}{sortKey === col.key ? (dir === "asc" ? " ▲" : " ▼") : ""}</th>))}{onDeleteRow && <th style={{ width: 24 }} />}</tr></thead>
      <tbody>{sorted.map((row, i) => (<tr key={row.id ?? i} style={{ borderTop: `1px solid ${C.borderSoft}` }}>{columns.map((col) => (
        <td key={col.key} className={col.align === "right" ? "text-right" : ""} style={{ color: col.emphasize ? C.text : C.textMuted, padding: "4px 4px" }}>
          {col.editable ? (
            <select
              value={row[col.key]}
              onChange={(e) => onEditCell && onEditCell(row, col.key, e.target.value)}
              className="text-xs rounded"
              style={{ background: C.panel2, border: `1px solid ${C.borderSoft}`, color: C.text, padding: "1px 3px" }}
            >
              {col.options.map((o) => (<option key={o} value={o}>{o}</option>))}
            </select>
          ) : (col.format ? col.format(row[col.key], row) : row[col.key])}
        </td>
      ))}{onDeleteRow && (
        <td className="text-right" style={{ padding: "4px 4px" }}>
          <button onClick={() => onDeleteRow(row)} title="この銘柄を削除" style={{ background: "transparent", border: "none", cursor: "pointer", color: C.textDim, display: "inline-flex" }}>
            <Trash2 size={12} />
          </button>
        </td>
      )}</tr>))}</tbody>
    </table>
  );
}

/* ---------------- status panel ---------------- */
function StatusPanel({ d, onOpenTrackRecord }) {
  return (
    <Panel title="現在のステータス" hideHeader className="h-full">
      <div className="flex h-full">
        <div className="flex-1 px-4 py-2 flex flex-col justify-center" style={{ borderRight: `1px solid ${C.borderSoft}` }}>
          <div className="text-[10px] mb-0.5" style={{ color: C.textDim }}>評価額（SPY終値）</div>
          <div className="mono text-xl font-bold">${d.currentPrice.toFixed(2)}</div>
          <div className="text-[9px] mt-0.5 whitespace-nowrap" style={{ color: C.textDim }}>データ日付：{fmtYMD(d.last.date)}（米国時間）</div>
          <div className="text-[9px] mt-0.5 whitespace-nowrap" style={{ color: C.textDim }}>ATH ${d.currentATH.toFixed(2)}（{fmtYMD(d.athDate)}）{d.currentDD.toFixed(1)}%</div>
        </div>
        <div className="flex-1 px-4 py-2 flex flex-col justify-center" style={{ borderRight: `1px solid ${C.borderSoft}` }}>
          <div className="flex items-center gap-1.5 mb-0.5"><TrendingDown size={11} style={{ color: C.rust }} /><span className="text-[10px] font-bold" style={{ color: C.rust }}>最高値比</span></div>
          <div className="mono text-xl font-bold" style={{ color: C.rust }}>{d.currentDD.toFixed(1)}%<span className="mono text-xs font-bold ml-1" style={{ color: C.rust }}>（更新日：{fmtYMD(d.athDate)}）</span></div>
          {d.nextMilestone !== null && (
            <div className="text-[10px] mt-0.5" style={{ color: C.textDim }}>次の基準（{d.nextMilestone}%）まで：<span className="mono font-semibold">{d.distanceToNextMilestone.toFixed(1)}%</span>（<span className="mono">${d.nextMilestonePrice.toFixed(2)}</span>）</div>
          )}
          <div className="mt-1.5 pt-1" style={{ borderTop: `1px solid ${C.borderSoft}` }}>
            <div className="text-[10px]" style={{ color: C.textDim }}>前回最高値比</div>
            {d.lastCompletedEpisode ? (
              <div className="mono text-sm font-semibold" style={{ color: d.prevATHRatio >= 0 ? C.teal : C.rust }}>{d.prevATHRatio >= 0 ? "+" : ""}{d.prevATHRatio.toFixed(1)}%<span className="mono text-[10px] font-normal ml-1" style={{ color: C.textDim }}>（{fmtYMD(d.lastCompletedEpisode.recoveryDate)}）</span></div>
            ) : (
              <div className="text-xs" style={{ color: C.textDim }}>—（DD3%到達履歴なし）</div>
            )}
          </div>
        </div>
        <div className="flex-1 px-4 py-2 flex flex-col justify-center" style={{ borderRight: `1px solid ${C.borderSoft}` }}>
          <div className="flex items-center gap-1.5 mb-1"><Clock size={11} style={{ color: C.textDim }} /><span className="text-[10px]" style={{ color: C.textDim }}>経過日数</span></div>
          <div className="flex items-baseline justify-between text-xs mb-0.5"><span style={{ color: C.textMuted }}>DD開始（-3%）から</span><span className="mono font-semibold">{d.daysSinceDDStart ?? "—"}日</span></div>
          {d.isDrawdown ? (
            <div className="flex items-baseline justify-between text-xs"><span style={{ color: C.textMuted }}>前節目（{d.currentTLabel}）通過から</span><span className="mono font-semibold">{d.daysSinceCurrentThreshold ?? "—"}日</span></div>
          ) : (
            <div className="flex items-baseline justify-between text-xs"><span style={{ color: C.textMuted }}>前回最高値（DD3％後）から</span><span className="mono font-semibold">{d.daysSinceATH}日</span></div>
          )}
        </div>
        <button onClick={onOpenTrackRecord} className="flex-1 px-4 py-2 flex flex-col justify-center text-left cursor-pointer" style={{ background: "transparent", border: "none" }}>
          <div className="flex items-center gap-1.5 mb-1"><AlertTriangle size={11} style={{ color: C.amber }} /><span className="text-[10px]" style={{ color: C.textDim }}>その後の下落確率</span><ChevronRight size={11} style={{ color: C.textDim, marginLeft: "auto" }} /></div>
          {d.isEntryLeg && d.speedCategory ? (<><div className="text-xs mb-0.5" style={{ color: C.textMuted }}>DD3→5%は{d.legDays}日（{d.speedCategory}）</div><div className="mono text-xs" style={{ color: C.text }}>→15%以深 <b style={{ color: C.rust }}>{SPEED_TABLE[d.speedCategory === "急落" ? "fast" : "slow"]["-15"]}%</b>　→20%以深 <b style={{ color: C.rust }}>{SPEED_TABLE[d.speedCategory === "急落" ? "fast" : "slow"]["-20"]}%</b></div></>)
            : d.nextProg ? (<><div className="text-xs mb-0.5" style={{ color: C.textMuted }}>次の節目（{d.nextProg.to}%）への進行</div><div className="mono text-lg font-bold" style={{ color: d.nextProg.watershed ? C.rust : C.text }}>{d.nextProg.p}% {d.nextProg.watershed && <span className="text-[10px] font-normal">分水嶺</span>}</div></>) : (<div className="text-xs" style={{ color: C.textDim }}>下落モード外</div>)}
          <div className="text-[9px] mt-0.5 underline" style={{ color: C.textDim }}>クリックで全トラックレコード表示</div>
        </button>
      </div>
    </Panel>
  );
}

/* ---------------- portfolio pie panel ---------------- */
function PortfolioPie({ view, holdings, onOpen }) {
  const field = fieldForView(view);
  const total = useMemo(() => holdingsTotal(holdings), [holdings]);
  const data = useMemo(() => {
    const grouped = sortGroupedForView(groupByField(holdings, field), view);
    return view === "category" ? aggregateTopN(grouped, 6) : grouped;
  }, [holdings, field, view]);
  return (
    <div onClick={onOpen} className="h-full flex items-center cursor-pointer" style={{ padding: "6px 8px", gap: 6 }}>
      <div className="relative shrink-0" style={{ width: "40%", height: "92%" }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart><Pie data={data} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="88%" paddingAngle={2} stroke={C.panel} strokeWidth={2} isAnimationActive={false}>{data.map((d, i) => (<Cell key={i} fill={colorForView(view, d.name)} />))}</Pie><Tooltip contentStyle={{ background: C.panel, border: `1px solid ${C.border}`, fontSize: 12 }} formatter={(v, n) => [`¥${v.toLocaleString()}`, n]} /></PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none"><span className="text-[9px]" style={{ color: C.textDim }}>合計評価額</span><span className="mono text-xs font-bold">¥{Math.round(total / 10000).toLocaleString()}万</span></div>
      </div>
      <div className="flex-1 min-w-0 flex flex-col justify-center gap-1 overflow-y-auto">
        {data.map((d) => (<div key={d.name} className="flex items-center gap-1 text-[10px]"><span style={{ width: 7, height: 7, borderRadius: 2, background: colorForView(view, d.name), flexShrink: 0 }} /><span style={{ color: C.textMuted }} className="flex-1 truncate">{d.name}</span><span className="mono shrink-0" style={{ color: C.text }}>{((d.value / total) * 100).toFixed(1)}%</span></div>))}
      </div>
    </div>
  );
}

/* ---------------- modal shell ---------------- */
function FullScreenModal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: "rgba(5,8,16,0.82)" }} onClick={onClose}>
      <div className="w-full h-full rounded-lg overflow-hidden flex flex-col" style={{ maxWidth: 1150, background: C.panel, border: `1px solid ${C.border}`, fontFamily: "'Zen Kaku Gothic New',sans-serif", color: C.text }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: `1px solid ${C.borderSoft}` }}>
          <span className="text-sm font-semibold">{title}</span>
          <button onClick={onClose} className="flex items-center gap-1 text-xs px-2 py-1 rounded" style={{ color: C.textMuted, background: "transparent", border: "none", cursor: "pointer" }}><X size={13} /> 閉じる</button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">{children}</div>
      </div>
    </div>
  );
}

function TrackRecordContent({ currentT }) {
  return (
    <div className="grid grid-cols-2 gap-x-8 gap-y-6">
      <div>
        <div className="text-xs mb-3" style={{ color: C.textDim }}>節目間の進行確率</div>
        {PROGRESSION_DATA.map((row) => (<div key={row.from} className="flex items-center gap-2 mb-1.5"><span className="mono text-xs w-20" style={{ color: row.from === currentT ? C.text : C.textMuted }}>{row.from}%→{row.to}%</span><div className="flex-1 h-2 rounded-full" style={{ background: C.panel2 }}><div className="h-2 rounded-full" style={{ width: `${row.p}%`, background: row.watershed ? C.rust : row.real ? C.teal : C.amber }} /></div><span className="mono text-xs w-10 text-right">{row.p}%</span>{!row.real && <span className="text-[9px] shrink-0" style={{ color: C.textDim }}>参考値</span>}</div>))}
      </div>
      <div>
        <div className="text-xs mb-3" style={{ color: C.textDim }}>DD-3%到達からの最終到達確率</div>
        {FINAL_REACH_DATA.map((r) => (<div key={r.label} className="flex items-center gap-2 mb-1.5"><span className="mono text-xs w-16" style={{ color: C.textMuted }}>{r.label}</span><div className="flex-1 h-2 rounded-full" style={{ background: C.panel2 }}><div className="h-2 rounded-full" style={{ width: `${Math.min(100, r.p * 2)}%`, background: C.amber, opacity: r.real ? 1 : 0.6 }} /></div><span className="mono text-xs w-10 text-right">{r.p}%</span><span className="text-[10px] w-20 text-right shrink-0" style={{ color: C.textDim }}>{freqLabelFromP(r.p)}</span>{!r.real && <span className="text-[9px] shrink-0" style={{ color: C.textDim }}>参考値</span>}</div>))}
        <div className="text-[9px] mt-2" style={{ color: C.textDim }}>発生頻度はDD3%級の押し目が年{DD3_FREQ_PER_YEAR}回発生する前提での目安換算値です。</div>
      </div>
      <div className="col-span-2">
        <div className="text-xs mb-3" style={{ color: C.textDim }}>速度条件付き確率（DD3→5%区間の日数別）</div>
        <table className="w-full text-xs mono"><thead><tr style={{ color: C.textDim }}><th className="text-left font-normal py-1">区分</th><th>→8%</th><th>→10%</th><th>→15%</th><th>→20%</th></tr></thead>
          <tbody>
            <tr style={{ borderTop: `1px solid ${C.borderSoft}` }}><td className="py-1" style={{ color: C.textMuted }}>急落（5日以内）</td><td className="text-center">56%</td><td className="text-center">44%</td><td className="text-center">34%</td><td className="text-center">25%</td></tr>
            <tr style={{ borderTop: `1px solid ${C.borderSoft}` }}><td className="py-1" style={{ color: C.textMuted }}>緩慢（6日以上）</td><td className="text-center">47%</td><td className="text-center">30%</td><td className="text-center">13%</td><td className="text-center">10%</td></tr>
          </tbody>
        </table>
      </div>
      <div className="col-span-2 text-[11px] leading-relaxed" style={{ color: C.textDim }}>「参考値」は69年トラックレコードで明示されていない区間の暫定推定値です。過去確率は将来を保証しません。</div>
    </div>
  );
}

const BREAKDOWN_COLLAPSE_LIMIT = 10;
function PortfolioTableContent({ view, holdings, onEditHolding, onDeleteHolding }) {
  const [showAllBreakdown, setShowAllBreakdown] = useState(false);
  useEffect(() => { setShowAllBreakdown(false); }, [view]);
  const field = fieldForView(view);
  const total = holdingsTotal(holdings);
  const grouped = sortGroupedForView(groupByField(holdings, field), view);
  const hasMore = grouped.length > BREAKDOWN_COLLAPSE_LIMIT;
  const visibleGrouped = showAllBreakdown ? grouped : grouped.slice(0, BREAKDOWN_COLLAPSE_LIMIT);
  const viewLabel = view === "category" ? "カテゴリー別" : view === "currency" ? "為替別" : view === "owner" ? "口座別" : "A〜Eランク別";
  const rows = holdings.map((h) => ({ ...h, share: (h.amount / total) * 100 }));
  const columns = [
    { key: "name", label: "銘柄" },
    { key: "category", label: "カテゴリー", editable: true, options: CATEGORIES },
    { key: "currency", label: "為替", editable: true, options: ["円", "ドル"] },
    { key: "rank", label: "ランク", editable: true, options: CATS },
    { key: "account", label: "口座" },
    { key: "owner", label: "口座主", editable: true, options: ["shin", "saki"] },
    { key: "amount", label: "金額", align: "right", format: (v) => `¥${v.toLocaleString()}` },
    { key: "share", label: "構成比", align: "right", format: (v) => `${v.toFixed(1)}%` },
  ];
  return (
    <div>
      <div className="mb-6">
        <div className="text-xs mb-3" style={{ color: C.textDim }}>内訳（{viewLabel}）</div>
        {visibleGrouped.map((g) => (<div key={g.name} className="flex items-center gap-2 mb-1.5"><span style={{ width: 10, height: 10, borderRadius: 2, background: colorForView(view, g.name), flexShrink: 0 }} /><span className="text-xs w-32 truncate" style={{ color: C.textMuted }}>{g.name}</span><div className="flex-1 h-2 rounded-full" style={{ background: C.panel2 }}><div className="h-2 rounded-full" style={{ width: `${(g.value / total) * 100}%`, background: colorForView(view, g.name) }} /></div><span className="mono text-xs w-14 text-right">{((g.value / total) * 100).toFixed(1)}%</span><span className="mono text-xs w-28 text-right" style={{ color: C.textMuted }}>¥{g.value.toLocaleString()}</span></div>))}
        {hasMore && (
          <button onClick={() => setShowAllBreakdown((v) => !v)} className="text-[11px] mt-1 flex items-center gap-1" style={{ color: C.textMuted, background: "transparent", border: "none", cursor: "pointer" }}>
            {showAllBreakdown ? "▲ 閉じる" : `▼ もっと見る（他${grouped.length - BREAKDOWN_COLLAPSE_LIMIT}件）`}
          </button>
        )}
      </div>
      <div className="text-xs mb-2" style={{ color: C.textDim }}>保有銘柄一覧（列見出しクリックでソート・カテゴリー/ランク/口座主は変更可・右端の🗑で削除）</div>
      <SortableTable columns={columns} rows={rows} defaultSortKey="amount" onEditCell={(row, key, value) => onEditHolding && onEditHolding(row.id, key, value)} onDeleteRow={(row) => onDeleteHolding && onDeleteHolding(row.id)} />
    </div>
  );
}

const AXIS_TICKS = [0, 20, 40, 60, 80, 100];
function DDTableContent({ modelRow, holdings }) {
  const rankLabels = useMemo(() => rankCategoryLabels(holdings), [holdings]);
  return (
    <div>
      <div className="flex items-center gap-4 mb-4 flex-wrap">
        {CATS.map((cat) => (
          <div key={cat} className="flex items-center gap-1.5 text-[11px]">
            <span style={{ width: 10, height: 10, borderRadius: 2, background: rankColor(cat), flexShrink: 0 }} />
            <span style={{ color: C.textMuted }}>{cat}（{rankLabels[cat]}）</span>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 mb-1">
        <div style={{ width: 96, flexShrink: 0 }} />
        <div className="flex-1 relative" style={{ height: 14 }}>
          {AXIS_TICKS.map((t) => (
            <span key={t} className="absolute mono text-[9px]" style={{ left: `${t}%`, top: 0, transform: t === 100 ? "translateX(-100%)" : t === 0 ? "translateX(0)" : "translateX(-50%)", color: C.textDim }}>{t}%</span>
          ))}
        </div>
      </div>

      {MODEL_ROWS.map((r) => {
        const isCurrent = r.label === modelRow.label;
        return (
          <div key={r.label} className="flex items-center gap-3 mb-1.5">
            <div className="mono text-xs text-right shrink-0 whitespace-nowrap" style={{ width: 96, color: isCurrent ? C.teal : C.textMuted, fontWeight: isCurrent ? 700 : 400 }}>
              {r.label}{isCurrent && " ←現在"}
            </div>
            <div className="flex-1 relative flex rounded overflow-hidden" style={{ height: 22, background: C.panel2, outline: isCurrent ? `1.5px solid ${C.teal}` : "none", outlineOffset: 1 }}>
              {AXIS_TICKS.slice(1, -1).map((t) => (<div key={t} className="absolute top-0 bottom-0" style={{ left: `${t}%`, width: 1, background: C.borderSoft, opacity: 0.6 }} />))}
              {CATS.map((cat) => {
                const v = r[cat];
                return (
                  <div key={cat} title={`${cat}（${rankLabels[cat]}）: ${v}%`} className="flex items-center justify-center mono font-semibold" style={{ width: `${v}%`, background: rankColor(cat), color: C.bg, fontSize: 10 }}>
                    {v >= 8 ? `${cat} ${v}%` : ""}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      <div className="text-[10px] mt-3" style={{ color: C.textDim }}>各行は横棒の合計が100%（A〜Eの構成比の目安）。バーにマウスを乗せると各セグメントの詳細を確認できます。</div>
    </div>
  );
}

function RankHoldingsContent({ rank, holdings, onEditHolding, onDeleteHolding }) {
  const items = holdings.filter((h) => h.rank === rank);
  const total = items.reduce((s, h) => s + h.amount, 0);
  const rankLabel = useMemo(() => rankCategoryLabels(holdings)[rank], [holdings, rank]);
  const rows = items.map((h) => ({ ...h, share: (h.amount / total) * 100 }));
  const columns = [
    { key: "name", label: "銘柄" },
    { key: "category", label: "カテゴリー", editable: true, options: CATEGORIES },
    { key: "account", label: "口座" },
    { key: "owner", label: "口座主", editable: true, options: ["shin", "saki"] },
    { key: "rank", label: "ランク", editable: true, options: CATS },
    { key: "amount", label: "金額", align: "right", format: (v) => `¥${v.toLocaleString()}` },
    { key: "share", label: "構成比", align: "right", format: (v) => `${v.toFixed(1)}%` },
  ];
  return (<div><div className="text-xs mb-3" style={{ color: C.textDim }}>{rank}（{rankLabel}） 合計 ¥{total.toLocaleString()}　（列見出しクリックでソート・カテゴリー/ランク/口座主は変更可・右端の🗑で削除）</div><SortableTable columns={columns} rows={rows} defaultSortKey="amount" onEditCell={(row, key, value) => onEditHolding && onEditHolding(row.id, key, value)} onDeleteRow={(row) => onDeleteHolding && onDeleteHolding(row.id)} /></div>);
}

function CrashModalContent({ crash, daysSinceDDStart, currentDD, currentEpisodeCurve }) {
  const cmpIdx = Math.min(daysSinceDDStart ?? 0, crash.curve.length - 1);
  const crashDDatSameDay = crash.curve[cmpIdx].dd;
  const deeper = currentDD < crashDDatSameDay;
  return (
    <div>
      <div className="grid grid-cols-4 gap-3 mb-5">
        <div className="rounded px-3 py-2" style={{ background: C.panel2, border: `1px solid ${C.borderSoft}` }}><div className="text-[10px]" style={{ color: C.textDim }}>開始</div><div className="mono text-xs">{crash.start}</div></div>
        <div className="rounded px-3 py-2" style={{ background: C.panel2, border: `1px solid ${C.borderSoft}` }}><div className="text-[10px]" style={{ color: C.textDim }}>底値</div><div className="mono text-xs">{crash.low}（最大DD {crash.maxDD}%）</div></div>
        <div className="rounded px-3 py-2" style={{ background: C.panel2, border: `1px solid ${C.borderSoft}` }}><div className="text-[10px]" style={{ color: C.textDim }}>下落期間</div><div className="mono text-xs">{fmtDuration(crash.troughDay)}</div></div>
        <div className="rounded px-3 py-2" style={{ background: C.panel2, border: `1px solid ${C.borderSoft}` }}><div className="text-[10px]" style={{ color: C.textDim }}>ATH回復まで</div><div className="mono text-xs">{crash.athRecovery}（{fmtDuration(crash.recoveryDay)}）</div></div>
      </div>
      <div style={{ height: 260 }} className="mb-4">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={C.borderSoft} vertical={false} />
            <XAxis dataKey="day" type="number" domain={[0, crash.recoveryDay]} allowDuplicatedCategory={false} tick={{ fill: C.textDim, fontSize: 10 }} axisLine={{ stroke: C.border }} tickLine={false} label={{ value: "経過日数（下落開始起点）", position: "insideBottom", offset: -2, fill: C.textDim, fontSize: 10 }} />
            <YAxis domain={[Math.min(crash.maxDD * 1.1, -20), 2]} tick={{ fill: C.textDim, fontSize: 10 }} axisLine={false} tickLine={false} width={44} />
            <Tooltip contentStyle={{ background: C.panel, border: `1px solid ${C.border}`, fontSize: 12 }} formatter={(v, n) => [`${v}%`, n === "dd" ? crash.name : "現在"]} />
            <ReferenceLine x={crash.troughDay} stroke={C.borderSoft} strokeDasharray="2 3" label={{ value: "底値", fill: C.textDim, fontSize: 9, position: "top" }} />
            {daysSinceDDStart !== null && <ReferenceLine x={daysSinceDDStart} stroke={C.teal} strokeDasharray="2 3" label={{ value: "現在", fill: C.teal, fontSize: 9, position: "top" }} />}
            <Line data={crash.curve} dataKey="dd" type="monotone" stroke={crash.color} strokeWidth={1.8} dot={false} isAnimationActive={false} name="dd" />
            <Line data={currentEpisodeCurve} dataKey="dd" type="monotone" stroke={C.teal} strokeWidth={2.4} dot={false} isAnimationActive={false} connectNulls={false} name="current" />
            <ReferenceDot x={crash.troughDay} y={crash.maxDD} r={4} fill={crash.color} stroke={C.bg} strokeWidth={2} />
            {daysSinceDDStart !== null && <ReferenceDot x={daysSinceDDStart} y={currentDD} r={4} fill={C.teal} stroke={C.bg} strokeWidth={2} />}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="rounded px-4 py-3 mb-5 text-sm leading-relaxed" style={{ background: C.panel2, border: `1px solid ${C.borderSoft}`, color: C.text }}>
        現在はDD開始から{daysSinceDDStart}日目でDD{currentDD.toFixed(1)}%。{crash.name}の同じ経過日数時点ではDD{crashDDatSameDay}%でした
        （現状の方が<span style={{ color: deeper ? C.rust : C.teal, fontWeight: 700 }}>{deeper ? "深い" : "浅い"}</span>ペース）。
      </div>
      <div className="grid grid-cols-1 gap-4">
        <div><div className="text-[10px] mb-1" style={{ color: C.textDim }}>原因</div><div className="text-sm leading-relaxed" style={{ color: C.textMuted }}>{crash.cause}</div></div>
        <div><div className="text-[10px] mb-1" style={{ color: C.textDim }}>終息した要因</div><div className="text-sm leading-relaxed" style={{ color: C.textMuted }}>{crash.resolution}</div></div>
        <div><div className="text-[10px] mb-1" style={{ color: C.textDim }}>その後の学び</div><div className="text-sm leading-relaxed" style={{ color: C.textMuted }}>{crash.lesson}</div></div>
      </div>
      <div className="mt-4 text-[10px]" style={{ color: C.textDim }}>※ 期間・深さは概算です。カーブ形状は特徴を再現した簡易モデルであり、実際の日次値動きとは異なります。</div>
    </div>
  );
}

/* ---------------- checkpoint settings (add / edit) ---------------- */
function CheckpointSettingsContent({ checkpoints, onCheckpointChange, holdings }) {
  const total = holdingsTotal(holdings);
  return (
    <div>
      <p className="text-xs mb-5 leading-relaxed" style={{ color: C.textDim }}>
        DD戦略のA〜Eモデルとは別に、任意の基準（最大{CHECKPOINT_SLOTS}件）を保有ポートフォリオに対して評価します。例：「レバレッジETFは全体の5%以内」。
        有効にしたチェックポイントは「現状分析」パネルに表示されます。
      </p>
      {checkpoints.map((cp, i) => {
        const preview = evaluateCheckpoint(cp, holdings, total);
        const options = cp.targetType === "rank" ? CATS : CATEGORIES;
        return (
          <div key={i} className="rounded p-3 mb-3" style={{ background: C.panel2, border: `1px solid ${cp.enabled ? C.teal : C.borderSoft}` }}>
            <div className="flex items-center gap-2 mb-2.5">
              <input type="checkbox" checked={cp.enabled} onChange={(e) => onCheckpointChange(i, "enabled", e.target.checked)} />
              <span className="text-xs font-semibold shrink-0" style={{ color: cp.enabled ? C.teal : C.textDim }}>チェックポイント{i + 1}</span>
              <input
                type="text"
                placeholder="ラベル（任意・例：レバレッジETF）"
                value={cp.label}
                onChange={(e) => onCheckpointChange(i, "label", e.target.value)}
                className="text-xs rounded flex-1"
                style={{ background: C.panel, border: `1px solid ${C.borderSoft}`, color: C.text, padding: "3px 8px" }}
              />
            </div>

            <div className="flex flex-wrap items-center gap-4 mb-2.5">
              <div className="flex items-center gap-1.5">
                <label className="text-[10px]" style={{ color: C.textDim }}>対象</label>
                <select
                  value={cp.targetType}
                  onChange={(e) => { onCheckpointChange(i, "targetType", e.target.value); onCheckpointChange(i, "targetValues", []); }}
                  className="text-xs rounded"
                  style={{ background: C.panel, border: `1px solid ${C.borderSoft}`, color: C.text, padding: "2px 5px" }}
                >
                  <option value="category">カテゴリー</option>
                  <option value="rank">ランク（A〜E）</option>
                </select>
              </div>
              <div className="flex items-center gap-1.5">
                <label className="text-[10px]" style={{ color: C.textDim }}>条件</label>
                <select
                  value={cp.direction}
                  onChange={(e) => onCheckpointChange(i, "direction", e.target.value)}
                  className="text-xs rounded"
                  style={{ background: C.panel, border: `1px solid ${C.borderSoft}`, color: C.text, padding: "2px 5px" }}
                >
                  <option value="max">以内（上限）</option>
                  <option value="min">以上（下限）</option>
                </select>
              </div>
              <div className="flex items-center gap-1.5">
                <label className="text-[10px]" style={{ color: C.textDim }}>基準</label>
                <input
                  type="number" min="0" max="100" step="0.5"
                  value={cp.thresholdPct}
                  onChange={(e) => onCheckpointChange(i, "thresholdPct", e.target.value === "" ? "" : parseFloat(e.target.value))}
                  className="text-xs rounded"
                  style={{ background: C.panel, border: `1px solid ${C.borderSoft}`, color: C.text, padding: "3px 6px", width: 60 }}
                />
                <span className="text-[10px]" style={{ color: C.textDim }}>%</span>
              </div>
            </div>

            <label className="text-[10px] block mb-1" style={{ color: C.textDim }}>対象項目（複数選択可）</label>
            <div className="flex flex-wrap gap-x-3 gap-y-1 p-2 rounded" style={{ background: C.panel, border: `1px solid ${C.borderSoft}`, maxHeight: 90, overflowY: "auto" }}>
              {options.map((v) => (
                <label key={v} className="flex items-center gap-1 text-[11px]" style={{ color: C.textMuted, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={cp.targetValues.includes(v)}
                    onChange={(e) => {
                      const next = e.target.checked ? [...cp.targetValues, v] : cp.targetValues.filter((x) => x !== v);
                      onCheckpointChange(i, "targetValues", next);
                    }}
                  />
                  {v}
                </label>
              ))}
            </div>

            {preview && (
              <div className="mt-2 text-[11px] leading-relaxed" style={{ color: preview.ok ? C.teal : C.rust }}>プレビュー：{preview.text}</div>
            )}
            {cp.enabled && !preview && (
              <div className="mt-2 text-[11px]" style={{ color: C.textDim }}>対象項目を選択するとプレビューが表示されます。</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- data input modal ---------------- */
function DataInputModal({ onClose, rawSeries, onReplace, onAppend, onReset, onBackfill, source, holdings, onUpdateHoldings, onResetAndImportHoldings, onResetHoldings, holdingsSource, overrides, categoryDefaultRanks, onCategoryDefaultRankChange }) {
  const [dataset, setDataset] = useState("voo"); // "voo" | "holdings"
  const [tab, setTab] = useState("csv");
  const [manualDate, setManualDate] = useState(new Date().toISOString().slice(0, 10));
  const [manualPrice, setManualPrice] = useState("");
  const [fileName, setFileName] = useState(null);
  const [fileMsg, setFileMsg] = useState(null);
  const [sp500FileName, setSp500FileName] = useState(null);
  const [sp500Msg, setSp500Msg] = useState(null);
  const [rakutenFileName, setRakutenFileName] = useState(null);
  const [rakutenMsg, setRakutenMsg] = useState(null);
  const [preview, setPreview] = useState(null); // rows pending confirmation
  const [previewOwner, setPreviewOwner] = useState("shin");
  const [ownerAutoDetected, setOwnerAutoDetected] = useState(false);
  const [showCategoryRankSettings, setShowCategoryRankSettings] = useState(false);

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const parsed = parseStooqCSV(String(ev.target.result));
      if (parsed.length) { onReplace(parsed); setFileMsg(`${parsed.length}件を読み込みました（${parsed[0].date.toLocaleDateString("ja-JP")} 〜 ${parsed[parsed.length - 1].date.toLocaleDateString("ja-JP")}）`); }
      else setFileMsg("CSVを解析できませんでした。Date,Open,High,Low,Close,Volume 形式か確認してください。");
    };
    reader.readAsText(file);
  };
  const handleSp500File = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setSp500FileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const parsed = parseStooqCSV(String(ev.target.result));
      if (!parsed.length) { setSp500Msg("CSVを解析できませんでした。列名(Date/日付, Close/終値)を確認してください。"); return; }
      const { added, scale } = onBackfill(parsed);
      if (added > 0) setSp500Msg(`SPY上場前(${SPY_LISTING_DATE.toLocaleDateString("ja-JP")}より前)を${added}件、SP500から換算係数${scale.toFixed(4)}(=SPY初値÷同時期SP500水準)で補完しました。`);
      else setSp500Msg("補完対象の期間がありませんでした（SPYデータの開始日以前のSP500データが見つからないか、既にSPY上場後のデータのみです）。");
    };
    reader.readAsText(file);
  };
  const handleAddManual = () => {
    const price = parseFloat(manualPrice);
    if (!manualDate || isNaN(price)) return;
    onAppend({ date: new Date(manualDate), price });
    setManualPrice("");
  };
  const handleRakutenFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setRakutenFileName(file.name);
    setRakutenMsg(null);
    const detectedOwner = detectOwnerFromFileName(file.name);
    setOwnerAutoDetected(!!detectedOwner);
    if (detectedOwner) setPreviewOwner(detectedOwner);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = decodeShiftJIS(ev.target.result);
      const parsed = expandGoldPlusSplits(parseRakutenCSV(text));
      // カテゴリー別ランク設定（ユーザーがカスタマイズ済みならそれを優先）→ 銘柄名ごとの個別修正、の順で上書きする。
      const withDefaultRanks = parsed.map((r) => ({ ...r, rank: categoryDefaultRanks[r.category] ?? r.rank }));
      const rows = withDefaultRanks.map((r) => (overrides[r.name] ? { ...r, ...overrides[r.name] } : r));
      if (rows.length) setPreview(rows);
      else setRakutenMsg("銘柄・評価額の列が見つかりませんでした。楽天証券の残高CSV（Shift-JIS）か確認してください。");
    };
    reader.readAsArrayBuffer(file);
  };
  const updatePreviewRow = (i, field, value) => setPreview((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
  const splitPreviewRow = (i, pairCategory) => setPreview((prev) => {
    const r = prev[i];
    const half = Math.round(r.amount / 2);
    const rowA = { ...r, name: `${r.name}（ゴールド）`, category: "ゴールド", rank: CATEGORY_DEFAULT_RANK["ゴールド"], amount: half, splitCandidate: false };
    const rowB = { ...r, name: `${r.name}（${pairCategory}）`, category: pairCategory, rank: CATEGORY_DEFAULT_RANK[pairCategory] ?? "D", amount: r.amount - half, splitCandidate: false };
    const next = [...prev];
    next.splice(i, 1, rowA, rowB);
    return next;
  });
  const confirmUpdate = () => {
    onUpdateHoldings(previewOwner, preview);
    setRakutenMsg(`${previewOwner}のデータを${preview.length}件のこのCSVの内容に更新しました（重複銘柄は新データで上書き、CSVに無くなった銘柄＝売却済み等は削除）。修正内容は銘柄名ごとに記憶され、次回以降は自動で適用されます。`);
    setPreview(null);
  };
  const confirmResetImport = () => {
    onResetAndImportHoldings(previewOwner, preview);
    setRakutenMsg(`既存の保有資産データと分類の記憶を全て削除し、${preview.length}件を${previewOwner}のデータとして新規登録しました。`);
    setPreview(null);
  };

  const tabBtn = (val, setter, key, label) => (<button onClick={() => setter(key)} className="text-xs px-3 py-1.5 rounded" style={{ color: val === key ? C.bg : C.textMuted, background: val === key ? C.teal : "transparent", border: `1px solid ${val === key ? C.teal : C.borderSoft}`, fontWeight: val === key ? 700 : 400, cursor: "pointer" }}>{label}</button>);

  // モーダル右上の×：プレビュー画面（下位階層）にいる場合はアップロード画面（データ入力パネル）に戻るだけにし、それ以外ではダッシュボードへ戻る。
  const handleModalClose = () => { if (preview) { setPreview(null); return; } onClose(); };

  return (
    <FullScreenModal title="データの入力" onClose={handleModalClose}>
      <div className="flex gap-2 mb-3">{tabBtn(dataset, setDataset, "voo", "SPY価格データ")}{tabBtn(dataset, setDataset, "holdings", "保有資産データ（ポートフォリオ）")}</div>

      {dataset === "voo" ? (
        <>
          <div className="flex gap-2 mb-5">{tabBtn(tab, setTab, "csv", "方式A：CSV取り込み（Stooq）")}{tabBtn(tab, setTab, "manual", "方式B：直接入力")}</div>
          {tab === "csv" ? (
            <div>
              <p className="text-sm mb-1 leading-relaxed" style={{ color: C.textMuted }}>Stooqからダウンロードした SPY.US の日次CSV（Date,Open,High,Low,Close,Volume・日付昇順）を選択してください。</p>
              <p className="text-xs mb-4" style={{ color: C.textDim }}>取得元: https://stooq.com/q/d/l/?s=spy.us&i=d</p>
              <label className="inline-flex items-center gap-2 text-xs px-3 py-2 rounded" style={{ background: C.panel2, border: `1px solid ${C.borderSoft}`, color: C.textMuted, cursor: "pointer" }}>
                <Upload size={13} /> CSVファイルを選択
                <input type="file" accept=".csv" onChange={handleFile} style={{ display: "none" }} />
              </label>
              {fileName && <div className="text-xs mt-2" style={{ color: C.textDim }}>選択中: {fileName}</div>}
              {fileMsg && <div className="text-xs mt-2" style={{ color: C.teal }}>{fileMsg}</div>}

              <div className="mt-8 pt-5" style={{ borderTop: `1px solid ${C.borderSoft}` }}>
                <p className="text-sm mb-1 leading-relaxed" style={{ color: C.textMuted }}>SPY上場（{SPY_LISTING_DATE.toLocaleDateString("ja-JP")}）より前の期間は、SP500の長期データから概算値を算出して補完できます。</p>
                <p className="text-xs mb-4 leading-relaxed" style={{ color: C.textDim }}>方法：SPYの最初の終値と同時期のSP500水準から換算係数を計算し、それより前のSP500日次値に係数を掛けて合成します（お手持ちの sp500_daily_1957-2026.xlsx をCSV書き出ししたものなどが使えます。列名は Date/日付, Close/終値 に対応）。</p>
                <label className="inline-flex items-center gap-2 text-xs px-3 py-2 rounded" style={{ background: C.panel2, border: `1px solid ${C.borderSoft}`, color: C.textMuted, cursor: "pointer" }}>
                  <Upload size={13} /> SP500長期CSVを選択
                  <input type="file" accept=".csv" onChange={handleSp500File} style={{ display: "none" }} />
                </label>
                {sp500FileName && <div className="text-xs mt-2" style={{ color: C.textDim }}>選択中: {sp500FileName}</div>}
                {sp500Msg && <div className="text-xs mt-2" style={{ color: C.teal }}>{sp500Msg}</div>}
                <div className="text-[10px] mt-2" style={{ color: C.textDim }}>※ 配当再投資を含まない価格指数としての概算です。SPYの実際の分配落ちとは完全には一致しません。</div>
              </div>
            </div>
          ) : (
            <div>
              <p className="text-sm mb-4" style={{ color: C.textMuted }}>毎日の運用でその日のSPY終値だけを入力する簡易方式です。既存データに追記・上書きされます。</p>
              <div className="flex items-end gap-3">
                <div><label className="text-[10px] block mb-1" style={{ color: C.textDim }}>日付</label><input type="date" value={manualDate} onChange={(e) => setManualDate(e.target.value)} className="text-xs px-2 py-1.5 rounded mono" style={{ background: C.panel2, border: `1px solid ${C.borderSoft}`, color: C.text }} /></div>
                <div><label className="text-[10px] block mb-1" style={{ color: C.textDim }}>終値（$）</label><input type="number" step="0.01" value={manualPrice} onChange={(e) => setManualPrice(e.target.value)} placeholder="704.20" className="text-xs px-2 py-1.5 rounded w-28 mono" style={{ background: C.panel2, border: `1px solid ${C.borderSoft}`, color: C.text }} /></div>
                <button onClick={handleAddManual} className="text-xs px-4 py-1.5 rounded" style={{ background: C.teal, color: C.bg, fontWeight: 700, border: "none", cursor: "pointer" }}>追加</button>
              </div>
            </div>
          )}

          <div className="mt-8 pt-4 flex items-center justify-between" style={{ borderTop: `1px solid ${C.borderSoft}` }}>
            <div className="flex items-center gap-2 text-xs" style={{ color: C.textDim }}>
              <Database size={13} />
              <span>現在のデータ: {rawSeries.length.toLocaleString()}件・最終日 {rawSeries[rawSeries.length - 1]?.date?.toLocaleDateString("ja-JP")}　（{source === "seed" ? "初期バンドルデータ" : "取り込み済みデータ"}）</span>
            </div>
            <button onClick={onReset} className="text-xs px-2 py-1 rounded" style={{ color: C.textMuted, background: "transparent", border: `1px solid ${C.borderSoft}`, cursor: "pointer" }}>初期データにリセット</button>
          </div>
        </>
      ) : (
        <div>
          {!preview ? (
            <>
              <p className="text-sm mb-1 leading-relaxed" style={{ color: C.textMuted }}>楽天証券の口座管理画面から残高CSV（Shift-JIS）をダウンロードして選択してください。</p>
              <p className="text-xs mb-4 leading-relaxed" style={{ color: C.textDim }}>「銘柄」「口座」「評価額」を含む表形式に対応。カテゴリー・A〜Eランク・為替は名称から自動推定するので、次の画面で内容を確認・修正してから反映します。</p>
              <div className="flex items-end gap-3 mb-2">
                <div>
                  <label className="text-[10px] block mb-1" style={{ color: C.textDim }}>このCSVの口座主{ownerAutoDetected && <span style={{ color: C.teal }}>（ファイル名から自動判定）</span>}</label>
                  <select value={previewOwner} onChange={(e) => { setPreviewOwner(e.target.value); setOwnerAutoDetected(false); }} className="text-xs px-2 py-1.5 rounded" style={{ background: C.panel2, border: `1px solid ${C.borderSoft}`, color: C.text }}>
                    <option value="shin">shin</option><option value="saki">saki</option>
                  </select>
                </div>
                <label className="inline-flex items-center gap-2 text-xs px-3 py-2 rounded" style={{ background: C.panel2, border: `1px solid ${C.borderSoft}`, color: C.textMuted, cursor: "pointer" }}>
                  <Upload size={13} /> 楽天証券CSVを選択
                  <input type="file" accept=".csv" onChange={handleRakutenFile} style={{ display: "none" }} />
                </label>
              </div>
              {rakutenFileName && <div className="text-xs mt-2" style={{ color: C.textDim }}>選択中: {rakutenFileName}</div>}
              {rakutenMsg && <div className="text-xs mt-2" style={{ color: C.teal }}>{rakutenMsg}</div>}

              <div className="mt-8 pt-4 flex items-center justify-between" style={{ borderTop: `1px solid ${C.borderSoft}` }}>
                <div className="flex items-center gap-2 text-xs" style={{ color: C.textDim }}>
                  <Database size={13} />
                  <span>現在のデータ: {holdings.length.toLocaleString()}件　（{holdingsSource === "seed" ? "初期データ" : "取り込み済みデータ"}）</span>
                </div>
                <button onClick={onResetHoldings} className="text-xs px-2 py-1 rounded" style={{ color: C.textMuted, background: "transparent", border: `1px solid ${C.borderSoft}`, cursor: "pointer" }}>初期データにリセット</button>
              </div>

              <div className="mt-4 pt-4" style={{ borderTop: `1px solid ${C.borderSoft}` }}>
                <button onClick={() => setShowCategoryRankSettings((v) => !v)} className="text-xs flex items-center gap-1.5 mb-1" style={{ color: C.textMuted, background: "transparent", border: "none", cursor: "pointer" }}>
                  {showCategoryRankSettings ? "▲" : "▼"} カテゴリー別ランク設定
                </button>
                <p className="text-[10px] mb-3 leading-relaxed" style={{ color: C.textDim }}>カテゴリーごとのデフォルトA〜Eランクです。銘柄のカテゴリーを変更すると、ここで設定したランクが自動で割り当てられます（個別銘柄ごとにさらに手動で上書き可能）。</p>
                {showCategoryRankSettings && (
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
                    {CATEGORIES.map((cat) => (
                      <div key={cat} className="flex items-center justify-between gap-2 text-xs">
                        <span className="truncate" style={{ color: C.textMuted }}>{cat}</span>
                        <select
                          value={categoryDefaultRanks[cat] ?? "D"}
                          onChange={(e) => onCategoryDefaultRankChange && onCategoryDefaultRankChange(cat, e.target.value)}
                          className="text-xs rounded"
                          style={{ background: C.panel2, border: `1px solid ${C.borderSoft}`, color: C.text, padding: "1px 4px" }}
                        >
                          {CATS.map((c) => (<option key={c} value={c}>{c}</option>))}
                        </select>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </>
          ) : (
            <>
              <p className="text-sm mb-1" style={{ color: C.textMuted }}>取り込み内容を確認してください。カテゴリー・ランクは自動推定です。誤りがあればここで修正できます。</p>
              <p className="text-xs mb-1 leading-relaxed" style={{ color: C.textDim }}><b style={{ color: C.textMuted }}>更新</b>：口座主「{previewOwner}」の保有データをこのCSVの内容に同期します（重複銘柄は新データで上書き、新規銘柄は追加、CSVに無くなった銘柄＝売却済み等は削除。他の口座主のデータは変更されません）。／<b style={{ color: C.textMuted }}>初期化</b>：既存の保有資産データと分類の記憶を全て削除し、このCSVの内容だけで作り直します。</p>
              <p className="text-xs mb-3" style={{ color: C.textDim }}>ここでの修正は銘柄名ごとに記憶され、次回以降の取り込みでは自動的に同じ分類が適用されます（毎回直す必要はありません）。</p>
              <div className="flex gap-2 mb-4">
                <button onClick={confirmUpdate} className="text-xs px-4 py-1.5 rounded" style={{ background: C.teal, color: C.bg, fontWeight: 700, border: "none", cursor: "pointer" }}>更新（この口座主のデータをCSVに同期）</button>
                <button onClick={confirmResetImport} className="text-xs px-4 py-1.5 rounded" style={{ background: C.rust, color: C.bg, fontWeight: 700, border: "none", cursor: "pointer" }}>初期化（全削除して読み込み）</button>
                <button onClick={() => setPreview(null)} className="text-xs px-4 py-1.5 rounded" style={{ color: C.textMuted, background: "transparent", border: `1px solid ${C.borderSoft}`, cursor: "pointer" }}>キャンセル</button>
              </div>
              <div className="overflow-y-auto" style={{ maxHeight: 380 }}>
                <table className="w-full text-xs mono">
                  <thead><tr style={{ color: C.textDim }}><th className="text-left font-normal py-1">銘柄</th><th className="text-left font-normal">口座</th><th className="text-left font-normal">カテゴリー</th><th className="text-left font-normal">為替</th><th className="text-left font-normal">ランク</th><th className="text-right font-normal">評価額</th><th className="text-left font-normal">分割候補</th></tr></thead>
                  <tbody>
                    {preview.map((r, i) => (
                      <tr key={i} style={{ borderTop: `1px solid ${C.borderSoft}`, background: r.splitCandidate ? `${C.amber}14` : "transparent" }}>
                        <td className="py-1" style={{ color: C.text }}>{r.name}</td>
                        <td style={{ color: C.textMuted }}>{r.account}</td>
                        <td><select value={r.category} onChange={(e) => updatePreviewRow(i, "category", e.target.value)} className="text-xs rounded" style={{ background: C.panel2, border: `1px solid ${C.borderSoft}`, color: C.text }}>{CATEGORIES.map((c) => (<option key={c} value={c}>{c}</option>))}</select></td>
                        <td><select value={r.currency} onChange={(e) => updatePreviewRow(i, "currency", e.target.value)} className="text-xs rounded" style={{ background: C.panel2, border: `1px solid ${C.borderSoft}`, color: C.text }}><option value="円">円</option><option value="ドル">ドル</option></select></td>
                        <td><select value={r.rank} onChange={(e) => updatePreviewRow(i, "rank", e.target.value)} className="text-xs rounded" style={{ background: C.panel2, border: `1px solid ${C.borderSoft}`, color: C.text }}>{CATS.map((c) => (<option key={c} value={c}>{c}</option>))}</select></td>
                        <td className="text-right" style={{ color: C.text }}>¥{r.amount.toLocaleString()}</td>
                        <td>
                          {r.splitCandidate && (
                            <div className="flex items-center gap-1">
                              <span style={{ color: C.amber, fontSize: 10 }}>ゴールド+</span>
                              <select id={`split-pair-${i}`} defaultValue={r.suggestedPairCategory} className="text-xs rounded" style={{ background: C.panel2, border: `1px solid ${C.borderSoft}`, color: C.text }}>{CATEGORIES.filter((c) => c !== "ゴールド").map((c) => (<option key={c} value={c}>{c}</option>))}</select>
                              <button onClick={() => splitPreviewRow(i, document.getElementById(`split-pair-${i}`).value)} className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: C.amber, color: C.bg, fontWeight: 700, border: "none", cursor: "pointer" }}>分割する</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex gap-2 mt-4">
                <button onClick={confirmUpdate} className="text-xs px-4 py-1.5 rounded" style={{ background: C.teal, color: C.bg, fontWeight: 700, border: "none", cursor: "pointer" }}>更新（この口座主のデータをCSVに同期）</button>
                <button onClick={confirmResetImport} className="text-xs px-4 py-1.5 rounded" style={{ background: C.rust, color: C.bg, fontWeight: 700, border: "none", cursor: "pointer" }}>初期化（全削除して読み込み）</button>
                <button onClick={() => setPreview(null)} className="text-xs px-4 py-1.5 rounded" style={{ color: C.textMuted, background: "transparent", border: `1px solid ${C.borderSoft}`, cursor: "pointer" }}>キャンセル</button>
              </div>
            </>
          )}
        </div>
      )}

      <div className="mt-3 text-[10px] leading-relaxed" style={{ color: C.textDim }}>
        入力したデータはブラウザの IndexedDB（このデバイス・ブラウザ専用の永続ストレージ）に保存されます。次回起動時も同じデータから始まります。別のデバイス・ブラウザとは共有されません（PC⇄スマホ同期は今後の Cloudflare Worker 連携で対応予定）。
      </div>
    </FullScreenModal>
  );
}

/* ---------------- legends ---------------- */
function ClickLegend({ items, hidden, onToggle }) {
  return (<div className="flex items-center gap-3 px-1 flex-wrap">{items.map((it) => (<button key={it.key} onClick={() => onToggle(it.key)} className="flex items-center gap-1.5 text-[11px]" style={{ opacity: hidden[it.key] ? 0.35 : 1, background: "transparent", border: "none", cursor: "pointer" }}><span style={{ width: 10, height: 10, borderRadius: 2, background: it.color }} /><span style={{ color: C.textMuted, textDecoration: hidden[it.key] ? "line-through" : "none" }}>{it.label}</span></button>))}</div>);
}

/* ---------------- main ---------------- */
export default function DDDashboard() {
  const [rawSeries, setRawSeries] = useState(SEED_SERIES);
  const [dataSource, setDataSource] = useState("seed");
  const [holdings, setHoldings] = useState(HOLDINGS_DEFAULT);
  const [holdingsSource, setHoldingsSource] = useState("seed");
  const [overrides, setOverrides] = useState({});
  const [categoryDefaultRanks, setCategoryDefaultRanks] = useState(CATEGORY_DEFAULT_RANK);
  const [checkpoints, setCheckpoints] = useState(DEFAULT_CHECKPOINTS);
  const [period, setPeriod] = useState("1Y");
  const [hidden, setHidden] = useState({});
  const [hiddenCrash, setHiddenCrash] = useState({});
  const [pieView, setPieView] = useState("rank");
  const [modelOverride, setModelOverride] = useState(null); // null = 自動（現在の評価額に応じて選択）
  const [chartTab, setChartTab] = useState("normal");
  const [modal, setModal] = useState(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await storage.get("voo_price_history");
        if (res && res.value) {
          const parsed = JSON.parse(res.value).map((p) => ({ date: new Date(p.date), price: p.price }));
          if (parsed.length) { setRawSeries(parsed); setDataSource("imported"); }
        }
      } catch (e) { /* no saved data yet — keep bundled seed */ }
      try {
        const res2 = await storage.get("portfolio_holdings");
        if (res2 && res2.value) {
          const raw2 = JSON.parse(res2.value);
          const hadMissingId = raw2.some((h) => !h.id);
          const parsed2 = raw2.map((h) => (h.id ? h : { ...h, id: genId() })); // 旧バージョンで保存されたデータにidを補完
          if (parsed2.length) { setHoldings(parsed2); setHoldingsSource("imported"); if (hadMissingId) persistHoldings(parsed2); }
        }
      } catch (e) { /* no saved holdings yet — keep default */ }
      try {
        const res3 = await storage.get("classification_overrides");
        if (res3 && res3.value) setOverrides(JSON.parse(res3.value));
      } catch (e) { /* no saved overrides yet */ }
      try {
        const res4 = await storage.get("category_default_ranks");
        if (res4 && res4.value) setCategoryDefaultRanks((prev) => ({ ...prev, ...JSON.parse(res4.value) }));
      } catch (e) { /* no saved category default ranks yet — keep built-in defaults */ }
      try {
        const res5 = await storage.get("portfolio_checkpoints");
        if (res5 && res5.value) setCheckpoints(JSON.parse(res5.value));
      } catch (e) { /* no saved checkpoints yet — keep built-in default */ }
      setHydrated(true);
    })();
  }, []);

  async function persist(series) {
    try { await storage.set("voo_price_history", JSON.stringify(series.map((p) => ({ date: p.date.toISOString().slice(0, 10), price: p.price })))); } catch (e) { /* storage unavailable */ }
  }
  async function persistHoldings(list) {
    try { await storage.set("portfolio_holdings", JSON.stringify(list)); } catch (e) { /* storage unavailable */ }
  }
  async function persistOverrides(map) {
    try { await storage.set("classification_overrides", JSON.stringify(map)); } catch (e) { /* storage unavailable */ }
  }
  async function persistCategoryDefaultRanks(map) {
    try { await storage.set("category_default_ranks", JSON.stringify(map)); } catch (e) { /* storage unavailable */ }
  }
  function handleCategoryDefaultRankChange(category, rank) {
    setCategoryDefaultRanks((prev) => {
      const next = { ...prev, [category]: rank };
      persistCategoryDefaultRanks(next);
      return next;
    });
  }
  async function persistCheckpoints(list) {
    try { await storage.set("portfolio_checkpoints", JSON.stringify(list)); } catch (e) { /* storage unavailable */ }
  }
  function handleCheckpointChange(index, field, value) {
    setCheckpoints((prev) => {
      const next = prev.map((cp, i) => (i === index ? { ...cp, [field]: value } : cp));
      persistCheckpoints(next);
      return next;
    });
  }
  function handleReplace(parsed) { setRawSeries(parsed); setDataSource("imported"); persist(parsed); }
  function handleAppend(entry) {
    setRawSeries((prev) => {
      const map = new Map(prev.map((p) => [p.date.toISOString().slice(0, 10), p]));
      map.set(entry.date.toISOString().slice(0, 10), entry);
      const merged = Array.from(map.values()).sort((a, b) => a.date - b.date);
      persist(merged);
      return merged;
    });
    setDataSource("imported");
  }
  function handleReset() { setRawSeries(SEED_SERIES); setDataSource("seed"); storage.delete("voo_price_history").catch(() => {}); }
  function handleBackfill(sp500Parsed) {
    const { merged, added, scale } = backfillFromIndex(rawSeries, sp500Parsed);
    if (added > 0) { setRawSeries(merged); setDataSource("imported"); persist(merged); }
    return { added, scale };
  }
  // 「更新」：この口座主の保有データを新CSVの内容に完全同期する（重複銘柄は新データで上書き、新規銘柄は追加、
  // CSVに含まれなくなった銘柄＝売却済み等は削除）。他の口座主のデータ・分類の記憶（overrides）は影響を受けない。
  function handleUpdateHoldings(owner, previewRows) {
    setHoldings((prev) => {
      const incoming = previewRows.map((r) => ({ ...r, owner, id: r.id ?? genId() }));
      const kept = prev.filter((h) => h.owner !== owner);
      const merged = [...kept, ...incoming];
      persistHoldings(merged);
      return merged;
    });
    setHoldingsSource("imported");
    setOverrides((prev) => {
      const next = { ...prev };
      for (const r of previewRows) next[r.name] = { category: r.category, rank: r.rank, currency: r.currency };
      persistOverrides(next);
      return next;
    });
  }
  // 「初期化」：既存の保有資産データ・分類の記憶（overrides）を全て消去し、このCSVの内容のみで作り直す。
  function handleResetAndImportHoldings(owner, previewRows) {
    const incoming = previewRows.map((r) => ({ ...r, owner, id: r.id ?? genId() }));
    setHoldings(incoming);
    persistHoldings(incoming);
    setHoldingsSource("imported");
    const next = {};
    for (const r of previewRows) next[r.name] = { category: r.category, rank: r.rank, currency: r.currency };
    setOverrides(next);
    persistOverrides(next);
  }
  function handleResetHoldings() { setHoldings(HOLDINGS_DEFAULT); setHoldingsSource("seed"); storage.delete("portfolio_holdings").catch(() => {}); }
  // カテゴリー/ランクは銘柄名ごとに（同じ銘柄が複数口座・口座主にあっても揃うよう）まとめて更新し、overridesにも記憶する。
  // 口座主は行固有の情報なので、その行だけを更新する。
  function handleHoldingFieldEdit(id, field, value) {
    const target = holdings.find((h) => h.id === id);
    if (!target) return;
    // カテゴリーを変更した場合、ランクは「カテゴリー別ランク設定」のデフォルト値を自動で割り当てる（個別にさらに手動上書き可）。
    const autoRank = field === "category" ? (categoryDefaultRanks[value] ?? CATEGORY_DEFAULT_RANK[value] ?? "D") : null;
    setHoldings((prev) => {
      const next = field === "owner"
        ? prev.map((h) => (h.id === id ? { ...h, owner: value } : h))
        : prev.map((h) => (h.name === target.name ? { ...h, [field]: value, ...(field === "category" ? { rank: autoRank } : {}) } : h));
      persistHoldings(next);
      return next;
    });
    if (field === "category" || field === "rank" || field === "currency") {
      setOverrides((prev) => {
        const prior = prev[target.name] || { category: target.category, rank: target.rank, currency: target.currency };
        const next = { ...prev, [target.name]: { ...prior, [field]: value, ...(field === "category" ? { rank: autoRank } : {}) } };
        persistOverrides(next);
        return next;
      });
    }
  }
  // 銘柄を削除する。ゴールドプラス系などの分割銘柄（同じ元銘柄名・同じ口座主で、末尾の（カテゴリー）表記だけが異なる対の行）は
  // 片方だけ消すと合計評価額が半分になってしまうため、対になる行があれば両方まとめて消すかどうかを確認する。
  function handleDeleteHolding(id) {
    const target = holdings.find((h) => h.id === id);
    if (!target) return;
    const base = baseHoldingName(target.name);
    const sibling = base !== target.name
      ? holdings.find((h) => h.id !== id && h.owner === target.owner && baseHoldingName(h.name) === base && h.name !== target.name)
      : null;
    if (sibling) {
      const ok = window.confirm(`「${base}」はゴールドプラス系などの分割銘柄です。対になるもう一方の行（${sibling.category}・¥${sibling.amount.toLocaleString()}）も一緒に削除しますか？\n\nOK：2行とも削除　／　キャンセル：削除しない（片方だけの削除は行いません）`);
      if (!ok) return;
      setHoldings((prev) => {
        const next = prev.filter((h) => h.id !== id && h.id !== sibling.id);
        persistHoldings(next);
        return next;
      });
    } else {
      const ok = window.confirm(`「${target.name}」（¥${target.amount.toLocaleString()}）を削除しますか？`);
      if (!ok) return;
      setHoldings((prev) => {
        const next = prev.filter((h) => h.id !== id);
        persistHoldings(next);
        return next;
      });
    }
  }

  const d = useMemo(() => computeAll(rawSeries), [rawSeries]);
  const chartData = useMemo(() => sliceForPeriod(d.FULL, d.last, period), [d.FULL, d.last, period]);
  const rangeDays = useMemo(() => { const f = chartData[0].date, l = chartData[chartData.length - 1].date; return Math.round((l - f) / 86400000); }, [chartData]);
  const comparisonData = useMemo(() => buildComparisonData(d.currentEpisodeCurve), [d.currentEpisodeCurve]);
  const toggle = (k) => setHidden((p) => ({ ...p, [k]: !p[k] }));
  const toggleCrash = (k) => setHiddenCrash((p) => ({ ...p, [k]: !p[k] }));

  const currentHoldingPct = useMemo(() => currentHoldingPctFromHoldings(holdings), [holdings]);
  const rankLabels = useMemo(() => rankCategoryLabels(holdings), [holdings]);
  const effectiveModelRow = modelOverride ? (MODEL_ROWS.find((r) => r.label === modelOverride) ?? d.modelRow) : d.modelRow;
  const blocks = useMemo(() => {
    const AB = { cur: currentHoldingPct.A + currentHoldingPct.B, tgt: effectiveModelRow.A + effectiveModelRow.B };
    const Cb = { cur: currentHoldingPct.C, tgt: effectiveModelRow.C };
    const DE = { cur: currentHoldingPct.D + currentHoldingPct.E, tgt: effectiveModelRow.D + effectiveModelRow.E };
    return { AB, Cb, DE };
  }, [currentHoldingPct, effectiveModelRow]);

  const crashLegendItems = [...CRASHES.map((c) => ({ key: c.id, label: c.name, color: c.color })), { key: "current", label: "現在", color: C.teal }];
  const analysisText = useMemo(() => buildAnalysisText(d, currentHoldingPct, holdingsTotal(holdings)), [d, currentHoldingPct, holdings]);
  const checkpointResults = useMemo(() => {
    const total = holdingsTotal(holdings);
    return checkpoints.map((cp) => evaluateCheckpoint(cp, holdings, total)).filter(Boolean);
  }, [checkpoints, holdings]);

  if (!hydrated) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100dvh", background: C.bg, color: C.textDim, fontFamily: "monospace", fontSize: 13 }}>
        読み込み中…
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col" style={{ background: C.bg, color: C.text, height: "100dvh", overflow: "hidden", fontFamily: "'Zen Kaku Gothic New','Hiragino Kaku Gothic ProN',sans-serif" }}>
      <style>{`.mono { font-family: 'JetBrains Mono', ui-monospace, monospace; }`}</style>

      {modal?.type === "trackRecord" && <FullScreenModal title="過去のトラックレコード（1957–2026・69年）" onClose={() => setModal(null)}><TrackRecordContent currentT={d.episode.currentT} /></FullScreenModal>}
      {modal?.type === "portfolio" && <FullScreenModal title="ポートフォリオ構成表" onClose={() => setModal(null)}><PortfolioTableContent view={pieView} holdings={holdings} onEditHolding={handleHoldingFieldEdit} onDeleteHolding={handleDeleteHolding} /></FullScreenModal>}
      {modal?.type === "ddTable" && <FullScreenModal title="DD毎のA〜E配分表" onClose={() => setModal(null)}><DDTableContent modelRow={d.modelRow} holdings={holdings} /></FullScreenModal>}
      {modal?.type === "rank" && <FullScreenModal title={`${modal.rank}ランクの保有銘柄`} onClose={() => setModal(null)}><RankHoldingsContent rank={modal.rank} holdings={holdings} onEditHolding={handleHoldingFieldEdit} onDeleteHolding={handleDeleteHolding} /></FullScreenModal>}
      {modal?.type === "crash" && <FullScreenModal title={`${modal.crash.name}（${modal.crash.start} 〜）と現状の比較`} onClose={() => setModal(null)}><CrashModalContent crash={modal.crash} daysSinceDDStart={d.daysSinceDDStart} currentDD={d.currentDD} currentEpisodeCurve={d.currentEpisodeCurve} /></FullScreenModal>}
      {modal?.type === "ddChart" && <FullScreenModal title="評価額（左軸） / DD%（右軸）" onClose={() => setModal(null)}><DDChartModalContent chartData={chartData} rangeDays={rangeDays} d={d} hidden={hidden} toggle={toggle} period={period} setPeriod={setPeriod} /></FullScreenModal>}
      {modal?.type === "dataInput" && <DataInputModal onClose={() => setModal(null)} rawSeries={rawSeries} onReplace={handleReplace} onAppend={handleAppend} onReset={handleReset} onBackfill={handleBackfill} source={dataSource} holdings={holdings} onUpdateHoldings={handleUpdateHoldings} onResetAndImportHoldings={handleResetAndImportHoldings} onResetHoldings={handleResetHoldings} holdingsSource={holdingsSource} overrides={overrides} categoryDefaultRanks={categoryDefaultRanks} onCategoryDefaultRankChange={handleCategoryDefaultRankChange} />}
      {modal?.type === "checkpointSettings" && <FullScreenModal title="チェックポイント設定" onClose={() => setModal(null)}><CheckpointSettingsContent checkpoints={checkpoints} onCheckpointChange={handleCheckpointChange} holdings={holdings} /></FullScreenModal>}

      <div className="flex items-center justify-between px-5 py-3 shrink-0" style={{ borderBottom: `1px solid ${C.border}`, background: C.panel2 }}>
        <div className="flex items-center gap-3"><span className="text-sm font-bold tracking-wide">DD戦略ダッシュボード</span><span className="text-[11px]" style={{ color: C.textDim }}>SPY・日次</span></div>
        <div className="flex items-center gap-3">
          <button onClick={() => setModal({ type: "dataInput" })} className="flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full" style={{ color: C.textMuted, background: C.panel, border: `1px solid ${C.borderSoft}`, cursor: "pointer" }}>
            <Database size={12} /> データ入力
          </button>
          <span className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full" style={{ color: depthColor(d.currentDD), background: `${depthColor(d.currentDD)}1a`, border: `1px solid ${depthColor(d.currentDD)}44` }}>{d.isDrawdown ? <TrendingDown size={12} /> : <TrendingUp size={12} />} {d.mode}</span>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        <DepthGauge dd={d.currentDD} />

        <div className="flex-1 flex flex-col gap-0 p-2 min-w-0">
          <div style={{ height: 116, flexShrink: 0 }}><StatusPanel d={d} onOpenTrackRecord={() => setModal({ type: "trackRecord" })} /></div>

          <div className="flex-1 flex flex-col" style={{ gap: 0, minHeight: 0 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 4, flex: 1, minHeight: 0 }}>
            {/* top-left: chart */}
            <div style={{ minHeight: 0 }}>
              <Panel
                title={chartTab === "normal" ? "評価額（左軸） / DD%（右軸）" : "過去の暴落との比較（経過日数ベース）"}
                action={
                  <div className="flex items-center gap-3">
                    <div className="flex gap-0.5 mr-2">{[{ k: "normal", l: "通常表示" }, { k: "crash", l: "暴落比較" }].map((t) => (<button key={t.k} onClick={() => setChartTab(t.k)} className="text-[10px] px-1.5 py-0.5 rounded" style={{ color: chartTab === t.k ? C.bg : C.textMuted, background: chartTab === t.k ? C.amber : "transparent", fontWeight: chartTab === t.k ? 700 : 400 }}>{t.l}</button>))}</div>
                    {chartTab === "normal" ? (<><ClickLegend items={[{ key: "price", label: "評価額 / ATH", color: C.teal }, { key: "dd", label: "DD%", color: C.rust }]} hidden={hidden} onToggle={toggle} /><div className="flex gap-0.5">{PERIODS.map((p) => (<button key={p.key} onClick={() => setPeriod(p.key)} className="text-[10px] px-1.5 py-0.5 rounded" style={{ color: period === p.key ? C.bg : C.textMuted, background: period === p.key ? C.teal : "transparent", fontWeight: period === p.key ? 700 : 400 }}>{p.label}</button>))}</div></>) : (<ClickLegend items={crashLegendItems} hidden={hiddenCrash} onToggle={toggleCrash} />)}
                  </div>
                }
                className="h-full"
              >
                {chartTab === "normal" ? (
                  <div className="h-full flex flex-col cursor-zoom-in" title="クリックで拡大表示" onClick={() => setModal({ type: "ddChart" })}>
                    <div className="flex-1 min-h-0">
                      <ResponsiveContainer width="100%" height="100%" key={period}>
                        <EvalDDChartBody chartData={chartData} rangeDays={rangeDays} d={d} hidden={hidden} />
                      </ResponsiveContainer>
                    </div>
                  </div>
                ) : (
                  <div className="h-full flex flex-col">
                    <div className="flex-1 min-h-0">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={comparisonData} margin={{ top: 12, right: 20, left: 0, bottom: 0 }}>
                          <CartesianGrid stroke={C.borderSoft} vertical={false} />
                          <XAxis dataKey="day" tick={{ fill: C.textDim, fontSize: 10 }} axisLine={{ stroke: C.border }} tickLine={false} label={{ value: "経過日数（下落開始起点）", position: "insideBottom", offset: -2, fill: C.textDim, fontSize: 10 }} />
                          <YAxis domain={[-60, 2]} tick={{ fill: C.textDim, fontSize: 10 }} axisLine={false} tickLine={false} width={44} />
                          <Tooltip contentStyle={{ background: C.panel, border: `1px solid ${C.border}`, fontSize: 12 }} />
                          {CRASHES.map((c) => (!hiddenCrash[c.id] && <Line key={c.id} type="monotone" dataKey={c.id} stroke={c.color} strokeWidth={1.3} dot={false} isAnimationActive={false} connectNulls={false} name={c.name} />))}
                          {!hiddenCrash.current && <Line type="monotone" dataKey="current" stroke={C.teal} strokeWidth={2.4} dot={false} isAnimationActive={false} connectNulls={false} name="現在" />}
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex gap-2 px-2 pb-2 pt-1 flex-wrap shrink-0">
                      {CRASHES.map((c) => (<button key={c.id} onClick={() => setModal({ type: "crash", crash: c })} className="flex-1 min-w-[150px] text-left rounded px-2.5 py-1.5" style={{ background: C.panel2, border: `1px solid ${C.borderSoft}`, cursor: "pointer" }}><div className="flex items-center gap-1.5 mb-0.5"><span style={{ width: 8, height: 8, borderRadius: 2, background: c.color }} /><span className="text-[11px] font-semibold" style={{ color: C.text }}>{c.name}</span></div><div className="mono text-[10px]" style={{ color: C.textMuted }}>最大{c.maxDD}%・{fmtDuration(c.troughDay)}で底</div></button>))}
                    </div>
                  </div>
                )}
              </Panel>
            </div>

            {/* top-right: AI advice */}
            <div style={{ minHeight: 0 }}>
              <Panel title="現状分析（AI）" className="h-full" hideHeader>
                <div className="p-2.5 flex flex-col gap-1.5 overflow-y-auto h-full">
                  <div>
                    <div className="text-[10px] mb-0.5" style={{ color: C.textDim }}>現状分析</div>
                    <div className="text-[11px] leading-tight" style={{ color: C.text }}>{analysisText}</div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-[10px]" style={{ color: C.textDim }}>チェックポイント</span>
                      <button onClick={() => setModal({ type: "checkpointSettings" })} className="text-[9px] underline" style={{ color: C.textDim, background: "transparent", border: "none", cursor: "pointer" }}>新設・変更</button>
                    </div>
                    {checkpointResults.length > 0 ? (
                      <ul className="text-[11px] leading-tight list-disc pl-3" style={{ color: C.textMuted }}>
                        {checkpointResults.map((r, i) => (<li key={i} style={{ color: r.ok ? C.textMuted : C.rust }}>{r.text}</li>))}
                      </ul>
                    ) : (
                      <div className="text-[11px] leading-tight" style={{ color: C.textDim }}>チェックポイントが設定されていません。「新設・変更」から設定できます。</div>
                    )}
                  </div>
                  <div className="mt-auto flex gap-1.5 text-[10px] leading-tight" style={{ color: C.textDim }}><Info size={11} style={{ flexShrink: 0, marginTop: 1 }} /><span>投資助言ではなく可視化・判断補助です。過去確率は将来を保証しません。</span></div>
                </div>
              </Panel>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 4, flex: 1, minHeight: 0 }}>
            {/* bottom-left: portfolio pie */}
            <div style={{ minHeight: 0 }}>
              <Panel title="ポートフォリオ構成" action={<div className="flex gap-1">{[{ k: "category", l: "カテゴリー別" }, { k: "currency", l: "為替別" }, { k: "rank", l: "A〜Eランク" }, { k: "owner", l: "口座別" }].map((t) => (<button key={t.k} onClick={() => setPieView(t.k)} className="text-[10px] px-1.5 py-0.5 rounded" style={{ color: pieView === t.k ? C.bg : C.textMuted, background: pieView === t.k ? C.teal : "transparent", fontWeight: pieView === t.k ? 700 : 400 }}>{t.l}</button>))}</div>} className="h-full">
                <PortfolioPie view={pieView} holdings={holdings} onOpen={() => setModal({ type: "portfolio" })} />
              </Panel>
            </div>

            {/* bottom-right: A-E diff */}
            <div style={{ minHeight: 0 }}>
              <Panel title="A〜E 配分乖離" action={<div className="flex items-center gap-2">
                <select value={modelOverride ?? ""} onChange={(e) => setModelOverride(e.target.value || null)} className="text-[10px] rounded px-1 py-0.5" style={{ background: C.panel2, color: C.text, border: `1px solid ${C.borderSoft}` }}>
                  <option value="">自動（{d.modelRow.label}）</option>
                  {MODEL_ROWS.map((r) => (<option key={r.label} value={r.label}>{r.label}</option>))}
                </select>
                <span className="flex items-center gap-1 text-[9px]" style={{ color: C.textMuted }}><span style={{ width: 8, height: 8, borderRadius: 2, background: C.textMuted, display: "inline-block" }} />実績<span style={{ width: 8, height: 8, borderRadius: 2, background: C.borderSoft, display: "inline-block", marginLeft: 4 }} />モデル</span><button onClick={() => setModal({ type: "ddTable" })} title="DD毎の配分表を表示" style={{ background: "transparent", border: "none", cursor: "pointer" }}><Info size={14} style={{ color: C.textDim }} /></button></div>} className="h-full">
                <div className="overflow-y-auto h-full">
                  {CATS.map((cat) => (<DiffBar key={cat} cat={cat} current={currentHoldingPct[cat]} target={effectiveModelRow[cat]} label={rankLabels[cat]} onClick={() => setModal({ type: "rank", rank: cat })} />))}
                  <div className="px-3 py-0.5 grid grid-cols-3 gap-1.5">
                    {[{ label: "A+B", ...blocks.AB }, { label: "C", ...blocks.Cb }, { label: "D+E", ...blocks.DE }].map((b) => { const diff = Number((b.cur - b.tgt).toFixed(1)); return (<div key={b.label} className="rounded px-2 py-0.5 text-center" style={{ background: C.panel2, border: `1px solid ${C.borderSoft}` }}><div className="text-[10px]" style={{ color: C.textDim }}>{b.label}</div><div className="mono text-xs font-semibold">{Number(b.cur.toFixed(1))}%</div><div className="mono text-[10px]" style={{ color: Math.abs(diff) >= 4 ? C.rust : C.textMuted }}>{diff > 0 ? "+" : ""}{diff}pt</div></div>); })}
                  </div>
                </div>
              </Panel>
            </div>
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}
