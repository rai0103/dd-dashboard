// SOXL本系列の「上場前換算」合成：QQQ側（lib/qqqSynthetic.ts）と同じ考え方で、SOXL ETF上場（2010年3月11日）
// より前の期間もDD分析・長尺動画等で使えるようにする。
//   ・接続点より前：lib/soxlPreListingData.tsのSOXL_PRE_LISTING_CSV（SOXXから3倍＋補正値で合成済み・出所Stooq）
//   ・接続点以降：SOXLの実際の終値（Twelve Data経由の自動取得・CSV取り込み）
//   ・SOXL_PRE_LISTING_CSVは、SOXL上場日の実際の終値を起点に逆算して作られているため、接続点で価格がすでに
//     段差なくつながっている（QQQ側のNDXのような、接続時の倍率換算は不要）。念のため、接続点の両方に値がある
//     最も新しい日があればその日の比率で微調整する（通常は重複日が無いため、接続点の値をそのまま使う）。
// このファイルは外部importを持たないため（型のみsp500Synthetic.tsから流用）、`node --test` から直接実行できる。

import type { DatedPrice } from "./sp500Synthetic.ts";
import { SOXL_PRE_LISTING_CSV } from "./soxlPreListingData.ts";

export interface SoxlSyntheticResult {
  series: DatedPrice[];
  junctionDate: string | null; // YYYY-MM-DD（接続できない場合はnull）
  factor: number | null;
  preListingCount: number; // 接続点より前（合成データ）の件数
  soxlCount: number; // 接続点以降（実データ）の件数
  mode: "spliced-overlap" | "spliced-boundary" | "pre-listing-only" | "soxl-only";
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

// lib/soxlPreListingData.tsの「date,close」CSV文字列（1行目はヘッダー）をDatedPrice[]にパースする。
export function parseSoxlPreListingCsv(csv: string = SOXL_PRE_LISTING_CSV): DatedPrice[] {
  const lines = csv.trim().split("\n");
  const out: DatedPrice[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const [dateStr, closeStr] = line.split(",");
    if (!dateStr || !closeStr) continue;
    const price = Number(closeStr);
    if (!Number.isFinite(price) || price <= 0) continue;
    out.push({ date: new Date(`${dateStr}T00:00:00.000Z`), price });
  }
  return out;
}

function cleanSorted(list: DatedPrice[]): DatedPrice[] {
  const m = new Map<string, DatedPrice>();
  for (const p of list) if (p && Number.isFinite(p.price) && p.price > 0) m.set(iso(p.date), p); // 同じ日付は後勝ち
  return [...m.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
}

export function buildSoxlEquivalentSeries(preListing: DatedPrice[], soxl: DatedPrice[]): SoxlSyntheticResult {
  const pre = cleanSorted(preListing), sx = cleanSorted(soxl);
  if (!sx.length) return { series: pre, junctionDate: null, factor: null, preListingCount: pre.length, soxlCount: 0, mode: "pre-listing-only" };
  if (!pre.length) return { series: sx, junctionDate: null, factor: null, preListingCount: 0, soxlCount: sx.length, mode: "soxl-only" };

  // 方式1：合成データと実データの両方に値がある最も新しい日があれば、その日の比率で接続する（lib/qqqSynthetic.tsと同じ方式）。
  const soxlByDate = new Map(sx.map((p) => [iso(p.date), p.price]));
  let junction: DatedPrice | null = null;
  for (let i = pre.length - 1; i >= 0; i--) if (soxlByDate.has(iso(pre[i].date))) { junction = pre[i]; break; }
  if (junction) {
    const jIso = iso(junction.date);
    const factor = soxlByDate.get(jIso)! / junction.price;
    const before = pre.filter((p) => iso(p.date) < jIso).map((p) => ({ date: p.date, price: p.price * factor }));
    const after = sx.filter((p) => iso(p.date) >= jIso);
    return { series: [...before, ...after], junctionDate: jIso, factor, preListingCount: before.length, soxlCount: after.length, mode: "spliced-overlap" };
  }

  // 方式2：重複する日が無い場合（通常はこちら）：SOXL実データの最初の日より前の合成データだけを使い、
  // 合成データの最終日の値とSOXL実データの最初の日の値を直接つなぐ（段差なく接続。通常は比率1倍に近い値になる）。
  const sFirstIso = iso(sx[0].date);
  const preBeforeSoxl = pre.filter((p) => iso(p.date) < sFirstIso);
  if (!preBeforeSoxl.length) return { series: sx, junctionDate: null, factor: null, preListingCount: 0, soxlCount: sx.length, mode: "soxl-only" };
  const lastPre = preBeforeSoxl[preBeforeSoxl.length - 1];
  const factor = sx[0].price / lastPre.price;
  const before = preBeforeSoxl.map((p) => ({ date: p.date, price: p.price * factor }));
  return { series: [...before, ...sx], junctionDate: sFirstIso, factor, preListingCount: before.length, soxlCount: sx.length, mode: "spliced-boundary" };
}
