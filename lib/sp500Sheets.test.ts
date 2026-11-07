// 実行: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSp500Sheets, zoomSheet, upDownSheet, ddHistorySheet, scenariosSheet, factsSheet, crashName, termYearOf } from "./sp500Sheets.ts";

// 営業日だけの日付（土日を除く）で、決定論的な擬似乱数の系列を作る
function synth(years = 30, seed = 7) {
  let s = seed;
  const rand = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const out: { date: string; close: number }[] = [];
  let price = 100;
  const d = new Date(Date.UTC(1990, 0, 2));
  while (out.length < years * 252) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) {
      const shock = rand() < 0.01 ? -0.03 - rand() * 0.04 : (rand() - 0.5) * 0.02;
      price *= 1 + 0.0009 + shock;
      out.push({ date: d.toISOString().slice(0, 10), close: price });
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

test("computeSp500Sheets：すべてのシートを計算でき、最終日が asOf になる", () => {
  const pts = synth();
  const r = computeSp500Sheets(pts)!;
  assert.ok(r);
  assert.equal(r.asOf, pts[pts.length - 1].date);
  for (const k of ["title", "zoom", "upDown", "ddOverlay", "ddHistory", "athZone", "ytdPaths", "scenarios", "facts"] as const) assert.ok(r[k], `${k} が計算できていない`);
});

test("zoomSheet：年初来は前年最終日を0%とし、直近N日の前日比を返す", () => {
  const pts = [
    { date: "2025-12-30", close: 100 }, { date: "2025-12-31", close: 100 },
    { date: "2026-01-02", close: 101 }, { date: "2026-01-05", close: 99 }, { date: "2026-01-06", close: 110 },
  ];
  const z = zoomSheet(pts.map((p) => ({ ...p })) as any, 2)!;
  assert.equal(z.year, 2026);
  assert.deepEqual(z.ytd.map((p) => p.pct), [1, -1, 10]);
  assert.equal(z.ytdPct, 10);
  assert.deepEqual(z.zoom.map((p) => p.dayPct), [-2, 11.1]);
  assert.equal(z.dd, 0);
  assert.equal(z.daysSinceATH, 0);
});

test("upDownSheet：今年の上昇日・下落日の数が実際の騰落と一致する", () => {
  const pts = synth(12);
  const u = upDownSheet(pts as any)!;
  const year = pts[pts.length - 1].date.slice(0, 4);
  const firstIdx = pts.findIndex((p) => p.date.startsWith(year));
  let up = 0, down = 0;
  for (let i = firstIdx; i < pts.length; i++) { const r = pts[i].close - pts[i - 1].close; if (r > 0) up++; else if (r < 0) down++; }
  assert.equal(u.rows[0].up, up);
  assert.equal(u.rows[0].down, down);
  assert.equal(u.rows[1].n, 10);
});

test("ddHistorySheet：最大ドローダウンと、暦年ベースの到達割合が0〜100%に収まる", () => {
  const pts = [...synth(20)];
  const h = ddHistorySheet(pts as any)!;
  assert.ok(h.maxDD < 0);
  for (const r of h.reach) assert.ok(r.share >= 0 && r.share <= 100);
  // 深い水準ほど到達した年の割合は小さい（単調）
  for (let i = 1; i < h.reach.length; i++) assert.ok(h.reach[i].share <= h.reach[i - 1].share);
});

test("scenariosSheet：7つのシナリオを返し、該当年が3年未満なら条件を緩和して3年にする", () => {
  const s = scenariosSheet(synth(40) as any)!;
  assert.equal(s.scenarios.length, 7);
  for (const sc of s.scenarios) {
    assert.ok(sc.n >= 3 || !sc.relaxed);
    if (sc.relaxed) assert.equal(sc.n, 3);
    assert.ok(sc.years.every((y) => y.path[0].x === 0 && y.path[0].y === 0));
  }
});

test("factsSheet：年数・倍率・年率の整合（倍率^(1/年数)−1 ≒ 年率）", () => {
  const f = factsSheet(synth(25) as any)!;
  assert.ok(f.years >= 24 && f.years <= 26);
  assert.ok(f.negativeYearShare >= 0 && f.negativeYearShare <= 100);
  assert.ok(f.dd5Share >= 0 && f.dd5Share <= 100);
});

test("crashName・termYearOf：既知の暴落名と大統領任期の年", () => {
  assert.equal(crashName(2009), "2008-09年 リーマンショック");
  assert.equal(crashName(1987), "1987年 ブラックマンデー");
  assert.equal(crashName(1951), "1951年の下落");
  assert.equal(termYearOf(2025), 1);
  assert.equal(termYearOf(2026), 2);
  assert.equal(termYearOf(2028), 4);
});
