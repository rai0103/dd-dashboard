// QQQ（Nasdaq-100指数のETF）の「QQQ上場前換算」合成：SP500→VOOの合成（lib/sp500Synthetic.ts）と同じ考え方で、
// QQQ ETF上場（1999年3月10日）より前の期間もDD戦略シミュレーション等で使えるようにする。
//   ・接続点より前：Nasdaq-100指数（^NDX、lib/ndxPreQqqData.tsのNDX_PRE_QQQ_CSV。出所はStooq）× 補正係数
//   ・接続点以降：QQQの実際の終値（Twelve Data経由の自動取得）
//   ・補正係数は、NDX側とQQQ側の両方に値がある最も新しい日があればその日で接続する（lib/sp500Synthetic.tsと同じ方式）。
//     通常は重複する日が無い（NDX側データは1999/3/9まで、QQQ実データは上場日の1999/3/10から）ため、その場合は
//     NDX系列の最終日の値とQQQ系列の最初の日の値を直接つなぐ。どちらの方式でも接続点で価格が段差なくつながるため、
//     騰落率・DD率はスケール変換の影響を受けない。
// このファイルは外部importを持たないため（型のみsp500Synthetic.tsから流用）、`node --test` から直接実行できる。

import type { DatedPrice } from "./sp500Synthetic.ts";
import { NDX_PRE_QQQ_CSV } from "./ndxPreQqqData.ts";

export interface QqqSyntheticResult {
  series: DatedPrice[];
  junctionDate: string | null; // YYYY-MM-DD（接続できない場合はnull）
  factor: number | null;
  ndxCount: number; // 換算に使ったNDX（接続点より前）の件数
  qqqCount: number; // 接続点以降のQQQの件数
  mode: "spliced-overlap" | "spliced-boundary" | "ndx-only" | "qqq-only";
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

// lib/ndxPreQqqData.tsの「date,close」CSV文字列（1行目はヘッダー）をDatedPrice[]にパースする。
export function parseNdxPreQqqCsv(csv: string = NDX_PRE_QQQ_CSV): DatedPrice[] {
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

export function buildQqqEquivalentSeries(ndxPre: DatedPrice[], qqq: DatedPrice[]): QqqSyntheticResult {
  const ndx = cleanSorted(ndxPre), qq = cleanSorted(qqq);
  if (!qq.length) return { series: ndx, junctionDate: null, factor: null, ndxCount: ndx.length, qqqCount: 0, mode: "ndx-only" };
  if (!ndx.length) return { series: qq, junctionDate: null, factor: null, ndxCount: 0, qqqCount: qq.length, mode: "qqq-only" };

  // 方式1：NDXとQQQの両方に値がある最も新しい日があれば、その日で接続する（lib/sp500Synthetic.tsと同じ方式）。
  const qqqByDate = new Map(qq.map((p) => [iso(p.date), p.price]));
  let junction: DatedPrice | null = null;
  for (let i = ndx.length - 1; i >= 0; i--) if (qqqByDate.has(iso(ndx[i].date))) { junction = ndx[i]; break; }
  if (junction) {
    const jIso = iso(junction.date);
    const factor = qqqByDate.get(jIso)! / junction.price;
    const before = ndx.filter((p) => iso(p.date) < jIso).map((p) => ({ date: p.date, price: p.price * factor }));
    const after = qq.filter((p) => iso(p.date) >= jIso);
    return { series: [...before, ...after], junctionDate: jIso, factor, ndxCount: before.length, qqqCount: after.length, mode: "spliced-overlap" };
  }

  // 方式2：重複する日が無い場合（通常はこちら）：QQQ系列の最初の日より前のNDXデータだけを使い、
  // NDX系列の最終日の値とQQQ系列の最初の日の値を直接つなぐ（段差なく接続）。
  const qFirstIso = iso(qq[0].date);
  const ndxBeforeQqq = ndx.filter((p) => iso(p.date) < qFirstIso);
  if (!ndxBeforeQqq.length) return { series: qq, junctionDate: null, factor: null, ndxCount: 0, qqqCount: qq.length, mode: "qqq-only" };
  const lastNdx = ndxBeforeQqq[ndxBeforeQqq.length - 1];
  const factor = qq[0].price / lastNdx.price;
  const before = ndxBeforeQqq.map((p) => ({ date: p.date, price: p.price * factor }));
  return { series: [...before, ...qq], junctionDate: qFirstIso, factor, ndxCount: before.length, qqqCount: qq.length, mode: "spliced-boundary" };
}
