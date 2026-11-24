// [グラフ動画] 場面ごとに、ダッシュボードのグラフを動かしながら描く（Canvas 2D）。
// 長尺（1920×1080）とショート（1080×1920）の両方を同じ関数で描き、場面の進み具合 p（0〜1）で線が伸びる・
// 数字が増える・棒が伸びる、などの動きを付ける。数字は lib/chartVideo/assetReport.ts が作ったものだけを使う。
import type { AssetReport } from './assetReport';
import type { CVScene, CVFormat } from './assetScript';

type Ctx = CanvasRenderingContext2D;
export const CV_SIZE = { long: { w: 1920, h: 1080 }, short: { w: 1080, h: 1920 } } as const;
const FONT = '"Zen Kaku Gothic New", "Yu Gothic", "Meiryo", "Hiragino Sans", sans-serif';
const MONO = '"JetBrains Mono", "Consolas", "Menlo", monospace';
export const CVC = {
  bg0: '#0A0F1C', bg1: '#111A2C', panel: '#111A2C', panel2: '#0D1424', border: '#22304C', grid: 'rgba(133,146,172,0.14)',
  text: '#E7ECF3', muted: '#8592AC', dim: '#56637F', teal: '#45C4B0', amber: '#D9A24B', rust: '#C0654B', blue: '#5B90C7', violet: '#8E7CC3',
};
export const HOLDING_COLORS = [CVC.teal, CVC.blue, CVC.violet, CVC.amber, '#7FA37A', '#BE7A63', '#C77FB0', '#4FA0A6', '#A3A24B', CVC.rust];

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const easeOut = (t: number) => 1 - Math.pow(1 - clamp(t), 3);
const easeInOut = (t: number) => { const x = clamp(t); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
const sub = (p: number, a: number, b: number) => clamp((p - a) / (b - a));
const yenFull = (v: number) => `${v < 0 ? '−' : ''}¥${Math.round(Math.abs(v)).toLocaleString('ja-JP')}`;
const yenSigned = (v: number) => `${v >= 0 ? '+' : '−'}¥${Math.round(Math.abs(v)).toLocaleString('ja-JP')}`;
const pctSigned = (v: number, d = 1) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}%`;
export function yenShort(v: number): string {
  const a = Math.abs(v), s = v < 0 ? '−' : '';
  if (a >= 1e8) return `${s}${(a / 1e8).toFixed(a >= 1e9 ? 0 : 2).replace(/\.?0+$/, '')}億円`;
  if (a >= 1e4) return `${s}${(a / 1e4).toFixed(a >= 1e6 ? 0 : 1).replace(/\.0$/, '')}万円`;
  return `${s}${Math.round(a)}円`;
}
const axisYen = (v: number) => (v === 0 ? '0' : Math.abs(v) >= 1e8 ? `${(v / 1e8).toFixed(v % 1e8 === 0 ? 0 : 2).replace(/\.?0+$/, '')}億` : `${Math.round(v / 1e4).toLocaleString('ja-JP')}万`);

function font(c: Ctx, size: number, bold = false, mono = false) { c.font = `${bold ? 700 : 500} ${size}px ${mono ? MONO : FONT}`; }
function text(c: Ctx, s: string, x: number, y: number, size: number, color: string, o: { bold?: boolean; align?: CanvasTextAlign; alpha?: number; mono?: boolean; maxW?: number; base?: CanvasTextBaseline } = {}) {
  c.save();
  font(c, size, o.bold, o.mono);
  c.fillStyle = color; c.textAlign = o.align ?? 'left'; c.textBaseline = o.base ?? 'alphabetic';
  c.globalAlpha *= o.alpha ?? 1;
  let str = s;
  if (o.maxW) while (str.length > 1 && c.measureText(str).width > o.maxW) str = str.slice(0, -2) + '…';
  c.fillText(str, x, y);
  c.restore();
}
function wrap(c: Ctx, s: string, maxW: number, size: number, bold = false): string[] {
  font(c, size, bold);
  const out: string[] = [];
  let line = '';
  for (const ch of Array.from(s)) {
    if (c.measureText(line + ch).width > maxW && line) {
      // 句読点・閉じかっこは行頭に置かない
      if (/[、。，．）」』！？]/.test(ch)) { line += ch; continue; }
      out.push(line); line = ch;
    } else line += ch;
  }
  if (line) out.push(line);
  return out;
}
function rr(c: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const k = Math.min(r, w / 2, h / 2);
  c.beginPath(); c.moveTo(x + k, y); c.arcTo(x + w, y, x + w, y + h, k); c.arcTo(x + w, y + h, x, y + h, k); c.arcTo(x, y + h, x, y, k); c.arcTo(x, y, x + w, y, k); c.closePath();
}
function niceTicks(lo: number, hi: number, n = 4): number[] {
  if (!(hi > lo)) hi = lo + 1;
  const raw = (hi - lo) / n, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let t = Math.floor(lo / step) * step; t <= Math.ceil(hi / step) * step + step / 2; t += step) out.push(Math.round(t));
  return out;
}
const dayNum = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / 86400000;

/** 単調な3次補間（折れ線をなめらかに。行き過ぎない）で点列をつなぐパスを作る */
function smoothPath(c: Ctx, pts: { x: number; y: number }[], move = true) {
  if (!pts.length) return;
  if (move) c.moveTo(pts[0].x, pts[0].y); else c.lineTo(pts[0].x, pts[0].y);
  if (pts.length < 3) { for (let i = 1; i < pts.length; i++) c.lineTo(pts[i].x, pts[i].y); return; }
  const n = pts.length, d: number[] = [], m: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((pts[i + 1].y - pts[i].y) / Math.max(1e-6, pts[i + 1].x - pts[i].x));
  m.push(d[0]);
  for (let i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2);
  m.push(d[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    const h = pts[i + 1].x - pts[i].x;
    c.bezierCurveTo(pts[i].x + h / 3, pts[i].y + (m[i] * h) / 3, pts[i + 1].x - h / 3, pts[i + 1].y - (m[i + 1] * h) / 3, pts[i + 1].x, pts[i + 1].y);
  }
}
/** 点列の x における y（直線補間。範囲外は端の値） */
function yAt(pts: { x: number; y: number }[], x: number): number | null {
  if (!pts.length) return null;
  if (x <= pts[0].x) return pts[0].y;
  for (let i = 1; i < pts.length; i++) if (x <= pts[i].x) { const a = pts[i - 1], b = pts[i]; return a.y + ((b.y - a.y) * (x - a.x)) / Math.max(1e-6, b.x - a.x); }
  return pts[pts.length - 1].y;
}

interface Layout { W: number; H: number; s: number; portrait: boolean; pad: number; top: number; content: { x: number; y: number; w: number; h: number }; subY: number }
function layout(W: number, H: number): Layout {
  const portrait = H > W, s = Math.min(W, H) / 1080;
  if (portrait) {
    const pad = 64 * s;
    return { W, H, s, portrait, pad, top: 92 * s, content: { x: pad, y: 380 * s, w: W - pad * 2, h: 980 * s }, subY: 1420 * s };
  }
  const pad = 84 * s;
  return { W, H, s, portrait, pad, top: 64 * s, content: { x: pad, y: 220 * s, w: W - pad * 2, h: 660 * s }, subY: 925 * s };
}

/** 縦横の目盛り・格子を描き、値→座標の変換を返す */
function axes(c: Ctx, L: Layout, rect: { x: number; y: number; w: number; h: number }, x0: number, x1: number, yTicks: number[], xLabels: { x: number; label: string }[], alpha: number, yFmt = axisYen) {
  const lo = yTicks[0], hi = yTicks[yTicks.length - 1];
  const left = rect.x + 110 * L.s, right = rect.x + rect.w - 10 * L.s, top = rect.y + 10 * L.s, bottom = rect.y + rect.h - 56 * L.s;
  const X = (v: number) => left + ((v - x0) / Math.max(1e-9, x1 - x0)) * (right - left);
  const Y = (v: number) => bottom - ((v - lo) / Math.max(1e-9, hi - lo)) * (bottom - top);
  c.save(); c.globalAlpha *= alpha;
  c.strokeStyle = CVC.grid; c.lineWidth = 1.5 * L.s; c.setLineDash([6 * L.s, 8 * L.s]);
  for (const t of yTicks) { c.beginPath(); c.moveTo(left, Y(t)); c.lineTo(right, Y(t)); c.stroke(); text(c, yFmt(t), left - 18 * L.s, Y(t) + 9 * L.s, 26 * L.s, CVC.muted, { align: 'right', mono: true }); }
  c.setLineDash([]);
  c.strokeStyle = 'rgba(133,146,172,0.4)'; c.beginPath(); c.moveTo(left, bottom); c.lineTo(right, bottom); c.stroke();
  // 近すぎる目盛りの文字は飛ばす（最後の目盛りは残し、その手前を飛ばす）
  const shown: { x: number; label: string }[] = [];
  const minGap = 90 * L.s;
  xLabels.forEach((l, i) => {
    const px = X(l.x);
    if (i === xLabels.length - 1) { while (shown.length && px - X(shown[shown.length - 1].x) < minGap) shown.pop(); shown.push(l); }
    else if (!shown.length || px - X(shown[shown.length - 1].x) >= minGap) shown.push(l);
  });
  for (const l of shown) text(c, l.label, X(l.x), bottom + 40 * L.s, 24 * L.s, CVC.muted, { align: 'center', mono: true });
  c.restore();
  return { X, Y, left, right, top, bottom };
}

function legend(c: Ctx, L: Layout, x: number, y: number, items: { label: string; color: string; dash?: boolean }[], alpha: number) {
  let cx = x;
  for (const it of items) {
    c.save(); c.globalAlpha *= alpha;
    c.strokeStyle = it.color; c.lineWidth = 5 * L.s; if (it.dash) c.setLineDash([10 * L.s, 7 * L.s]);
    c.beginPath(); c.moveTo(cx, y - 9 * L.s); c.lineTo(cx + 40 * L.s, y - 9 * L.s); c.stroke(); c.restore();
    text(c, it.label, cx + 52 * L.s, y, 28 * L.s, CVC.text, { alpha });
    font(c, 28 * L.s); cx += 52 * L.s + c.measureText(it.label).width + 44 * L.s;
  }
}
function callout(c: Ctx, L: Layout, x: number, y: number, lines: { t: string; color: string; size: number; bold?: boolean; mono?: boolean }[], alpha: number, anchor: 'left' | 'right' = 'right') {
  const padX = 22 * L.s, padY = 18 * L.s, gap = 10 * L.s;
  let w = 0, h = padY * 2 - gap;
  for (const l of lines) { font(c, l.size * L.s, l.bold, l.mono); w = Math.max(w, c.measureText(l.t).width); h += l.size * L.s + gap; }
  w += padX * 2;
  const bx = anchor === 'right' ? x - w : x, by = y - h / 2;
  c.save(); c.globalAlpha *= alpha;
  rr(c, bx, by, w, h, 14 * L.s); c.fillStyle = 'rgba(13,20,36,0.92)'; c.fill(); c.strokeStyle = 'rgba(69,196,176,0.55)'; c.lineWidth = 2 * L.s; c.stroke();
  let ty = by + padY;
  for (const l of lines) { ty += l.size * L.s; text(c, l.t, bx + padX, ty - 4 * L.s, l.size * L.s, l.color, { bold: l.bold, mono: l.mono }); ty += gap; }
  c.restore();
}

// ---------------- 場面ごとの描画 ----------------
type DrawFn = (c: Ctx, L: Layout, r: AssetReport, sc: CVScene, p: number, t: number) => void;

const drawTitle: DrawFn = (c, L, r, _sc, p, t) => {
  // 背景：評価額の推移をうっすら
  const pts = r.points.filter((q) => q.value != null);
  if (pts.length >= 2) {
    const xs = pts.map((q) => dayNum(q.date)), vs = pts.map((q) => q.value as number);
    const x0 = xs[0], x1 = xs[xs.length - 1], hi = Math.max(...vs) * 1.1;
    const P = pts.map((q, i) => ({ x: ((xs[i] - x0) / Math.max(1, x1 - x0)) * L.W, y: L.H * 0.92 - (vs[i] / hi) * L.H * 0.55 }));
    c.save(); c.globalAlpha = 0.16;
    c.beginPath(); c.rect(0, 0, L.W * easeOut(p / 0.8), L.H); c.clip();
    c.beginPath(); smoothPath(c, P); c.lineTo(L.W, L.H); c.lineTo(0, L.H); c.closePath(); c.fillStyle = CVC.teal; c.fill();
    c.restore();
  }
  const cx = L.W / 2, k = easeOut(p / 0.25);
  const y0 = L.portrait ? L.H * 0.36 : L.H * 0.34;
  // ラベル
  font(c, 34 * L.s, true); const lw = c.measureText('資産形成レポート').width + 56 * L.s;
  c.save(); c.globalAlpha *= k; rr(c, cx - lw / 2, y0 - 50 * L.s, lw, 66 * L.s, 33 * L.s); c.fillStyle = CVC.teal; c.fill(); c.restore();
  text(c, '資産形成レポート', cx, y0, 34 * L.s, CVC.bg0, { bold: true, align: 'center', alpha: k });
  // チャンネル名
  const lines = wrap(c, r.channel, L.portrait ? L.W - 140 * L.s : L.W - 300 * L.s, (L.portrait ? 76 : 84) * L.s, true);
  lines.forEach((ln, i) => {
    const kk = easeOut(sub(p, 0.08 + i * 0.06, 0.35 + i * 0.06));
    c.save(); c.translate(0, (1 - kk) * 24 * L.s);
    text(c, ln, cx, y0 + (120 + i * 104) * L.s, (L.portrait ? 76 : 84) * L.s, CVC.text, { bold: true, align: 'center', alpha: kk });
    c.restore();
  });
  const yy = y0 + (120 + lines.length * 104) * L.s;
  text(c, `${Number(r.asOf.slice(0, 4))}年${Number(r.asOf.slice(5, 7))}月${Number(r.asOf.slice(8, 10))}日 時点`, cx, yy + 10 * L.s, 40 * L.s, CVC.muted, { align: 'center', alpha: easeOut(sub(p, 0.25, 0.5)) });
  // 強調のひとこと（ポンと出る）
  const pop = sub(p, 0.4, 0.6), sc = pop <= 0 ? 0 : pop < 1 ? 0.6 + 0.55 * Math.sin(pop * Math.PI * 0.75) : 1 + 0.02 * Math.sin(t * 3);
  if (pop > 0) {
    c.save(); c.translate(cx, yy + 120 * L.s); c.scale(sc, sc);
    text(c, '目指せ！15年で1億円！', 0, 0, (L.portrait ? 64 : 72) * L.s, CVC.amber, { bold: true, align: 'center' });
    c.restore();
  }
};

const drawRules: DrawFn = (c, L, r, _sc, p) => {
  const items = [
    { icon: '1', t: `スタート：${Number(r.rules.startYm.slice(0, 4))}年${Number(r.rules.startYm.slice(5, 7))}月・初期費用${yenShort(r.rules.initial)}` },
    { icon: '2', t: `毎月${yenShort(r.rules.monthly)}を積み立て` },
    { icon: '3', t: `6月・12月は各${yenShort(r.rules.bonus)}を追加（年100万円）` },
    { icon: '4', t: `目標：${r.rules.targetYears}年で${yenShort(r.rules.goal)}` },
    { icon: '%', t: `必要な年率：約${(r.road.rate * 100).toFixed(1)}%`, accent: true },
  ];
  const R = L.content, rowH = (L.portrait ? 150 : 112) * L.s, size = (L.portrait ? 44 : 46) * L.s;
  const y0 = R.y + (L.portrait ? 60 : 20) * L.s;
  items.forEach((it, i) => {
    const k = easeOut(sub(p, 0.06 + i * 0.11, 0.24 + i * 0.11));
    if (k <= 0) return;
    const y = y0 + i * rowH;
    c.save(); c.globalAlpha *= k; c.translate((1 - k) * -40 * L.s, 0);
    rr(c, R.x, y, R.w, rowH - 22 * L.s, 18 * L.s); c.fillStyle = it.accent ? 'rgba(217,162,75,0.14)' : CVC.panel; c.fill();
    c.strokeStyle = it.accent ? 'rgba(217,162,75,0.6)' : CVC.border; c.lineWidth = 2 * L.s; c.stroke();
    const cy = y + (rowH - 22 * L.s) / 2;
    c.beginPath(); c.arc(R.x + 56 * L.s, cy, 30 * L.s, 0, Math.PI * 2); c.fillStyle = it.accent ? CVC.amber : CVC.teal; c.fill();
    text(c, it.icon, R.x + 56 * L.s, cy + 12 * L.s, 32 * L.s, CVC.bg0, { bold: true, align: 'center' });
    const lines = wrap(c, it.t, R.w - 150 * L.s, size, true).slice(0, 2);
    lines.forEach((ln, j) => text(c, ln, R.x + 112 * L.s, cy + size * 0.36 + (j - (lines.length - 1) / 2) * size * 1.2, size, it.accent ? CVC.amber : CVC.text, { bold: true }));
    c.restore();
  });
};

const drawStats: DrawFn = (c, L, r, _sc, p) => {
  const R = L.content;
  const cols = L.portrait ? 1 : 2, gap = (L.portrait ? 22 : 28) * L.s;
  const cw = (R.w - gap * (cols - 1)) / cols, ch = (L.portrait ? 180 : 250) * L.s;
  const cnt = easeOut(sub(p, 0.08, 0.5));
  const cards = [
    { label: '評価額', v: yenFull(r.value * cnt), color: CVC.text },
    { label: '元本', v: yenFull(r.principal * cnt), color: CVC.text },
    { label: '評価損益', v: `${yenSigned(r.pl * cnt)}（${pctSigned(r.plPct * cnt)}）`, color: r.pl >= 0 ? CVC.teal : CVC.rust },
    { label: `目標達成率（評価額÷${yenShort(r.goal)}）`, v: `${(r.goalPct * cnt).toFixed(2)}%`, color: CVC.text, bar: true },
  ];
  cards.forEach((cd, i) => {
    const k = easeOut(sub(p, i * 0.07, 0.2 + i * 0.07));
    const x = R.x + (i % cols) * (cw + gap), y = R.y + Math.floor(i / cols) * (ch + gap);
    c.save(); c.globalAlpha *= k; c.translate(0, (1 - k) * 30 * L.s);
    rr(c, x, y, cw, ch, 20 * L.s); c.fillStyle = CVC.panel; c.fill(); c.strokeStyle = CVC.border; c.lineWidth = 2 * L.s; c.stroke();
    text(c, cd.label, x + 32 * L.s, y + (L.portrait ? 54 : 62) * L.s, 32 * L.s, CVC.muted, { maxW: cw - 64 * L.s });
    const vs = (L.portrait ? 54 : 58) * L.s;
    text(c, cd.v, x + 32 * L.s, y + (L.portrait ? 54 : 62) * L.s + vs * (L.portrait ? 1.35 : 1.5), vs, cd.color, { bold: true, mono: true, maxW: cw - 64 * L.s });
    if (cd.bar) {
      const bx = x + 32 * L.s, by = y + ch - (L.portrait ? 34 : 56) * L.s, bw = cw - 64 * L.s, bh = 18 * L.s;
      rr(c, bx, by, bw, bh, bh / 2); c.fillStyle = 'rgba(133,146,172,0.2)'; c.fill();
      // 達成率は小さいので、最低でも見える幅にする
      const fw = Math.max(bh, bw * clamp((r.goalPct / 100) * cnt));
      rr(c, bx, by, fw, bh, bh / 2); c.fillStyle = CVC.teal; c.fill();
    }
    c.restore();
  });
  // 月初から・年初から・前回から
  const chips = [
    r.monthPct != null ? { l: '月初から', v: pctSigned(r.monthPct), up: r.monthPct >= 0 } : null,
    r.yearPct != null ? { l: '年初から', v: pctSigned(r.yearPct), up: r.yearPct >= 0 } : null,
    r.weekly && r.weekly.pct != null ? { l: `前回（${Number(r.weekly.prevDate.slice(5, 7))}/${Number(r.weekly.prevDate.slice(8, 10))}）から`, v: pctSigned(r.weekly.pct), up: r.weekly.pct >= 0 } : null,
  ].filter(Boolean) as { l: string; v: string; up: boolean }[];
  let cx = R.x, cy = R.y + Math.ceil(4 / cols) * (ch + gap) + 30 * L.s;
  chips.forEach((ch2, i) => {
    const k = easeOut(sub(p, 0.5 + i * 0.08, 0.65 + i * 0.08));
    const label = `${ch2.l}  ${ch2.v}`;
    font(c, 34 * L.s, true); const w = c.measureText(label).width + 48 * L.s;
    if (cx + w > R.x + R.w) { cx = R.x; cy += 84 * L.s; }
    c.save(); c.globalAlpha *= k;
    rr(c, cx, cy, w, 64 * L.s, 32 * L.s); c.fillStyle = ch2.up ? 'rgba(69,196,176,0.16)' : 'rgba(192,101,75,0.18)'; c.fill();
    c.restore();
    text(c, ch2.l, cx + 24 * L.s, cy + 44 * L.s, 30 * L.s, CVC.muted, { alpha: k });
    font(c, 30 * L.s); const lw = c.measureText(ch2.l).width;
    text(c, ch2.v, cx + 24 * L.s + lw + 14 * L.s, cy + 44 * L.s, 34 * L.s, ch2.up ? CVC.teal : CVC.rust, { bold: true, mono: true, alpha: k });
    cx += w + 20 * L.s;
  });
};

/** 横軸が日付の折れ線（評価額・元本）。reveal で左から伸ばす */
const drawValue: DrawFn = (c, L, r, _sc, p) => {
  const pts = r.points.filter((q) => q.value != null || q.principal != null);
  if (pts.length < 2) return;
  const xs = pts.map((q) => dayNum(q.date));
  const all = pts.flatMap((q) => [q.value, q.principal]).filter((v) => v != null) as number[];
  const lo = Math.min(...all), hi = Math.max(...all);
  const ticks = niceTicks(Math.max(0, lo - (hi - lo) * 0.1), hi + (hi - lo) * 0.08, 4);
  const R = { ...L.content, y: L.content.y + 50 * L.s, h: L.content.h - 50 * L.s };
  const months: { x: number; label: string }[] = [];
  const step = L.portrait ? 3 : 1;
  pts.forEach((q, i) => { if (i % step === 0 || i === pts.length - 1) months.push({ x: xs[i], label: `${q.date.slice(2, 4)}/${Number(q.date.slice(5, 7))}` }); });
  const A = axes(c, L, R, xs[0], xs[xs.length - 1], ticks, months, easeOut(p / 0.15));
  legend(c, L, R.x + 110 * L.s, L.content.y + 20 * L.s, [{ label: '評価額', color: CVC.teal }, { label: '元本', color: CVC.amber, dash: true }], easeOut(p / 0.2));
  const V = pts.filter((q) => q.value != null).map((q) => ({ x: A.X(dayNum(q.date)), y: A.Y(q.value as number) }));
  const P = pts.filter((q) => q.principal != null).map((q) => ({ x: A.X(dayNum(q.date)), y: A.Y(q.principal as number) }));
  const rv = easeInOut(sub(p, 0.1, 0.72));
  const clipX = A.left + (A.right - A.left) * rv;
  c.save(); c.beginPath(); c.rect(A.left - 10, A.top - 40 * L.s, clipX - A.left + 10, A.bottom - A.top + 60 * L.s); c.clip();
  if (V.length >= 2) {
    const g = c.createLinearGradient(0, A.top, 0, A.bottom); g.addColorStop(0, 'rgba(69,196,176,0.32)'); g.addColorStop(1, 'rgba(69,196,176,0.02)');
    c.beginPath(); smoothPath(c, V); c.lineTo(V[V.length - 1].x, A.bottom); c.lineTo(V[0].x, A.bottom); c.closePath(); c.fillStyle = g; c.fill();
  }
  c.lineJoin = 'round'; c.lineCap = 'round';
  if (P.length >= 2) { c.beginPath(); smoothPath(c, P); c.strokeStyle = CVC.amber; c.lineWidth = 4 * L.s; c.setLineDash([14 * L.s, 10 * L.s]); c.stroke(); c.setLineDash([]); }
  if (V.length >= 2) { c.beginPath(); smoothPath(c, V); c.strokeStyle = CVC.teal; c.lineWidth = 6 * L.s; c.stroke(); }
  c.restore();
  // 線の先頭の点と、その時点の評価額
  const hy = yAt(V, clipX);
  if (hy != null && rv > 0 && rv < 1) {
    const v = ticks[0] + ((A.bottom - hy) / (A.bottom - A.top)) * (ticks[ticks.length - 1] - ticks[0]);
    c.beginPath(); c.arc(clipX, hy, 11 * L.s, 0, Math.PI * 2); c.fillStyle = CVC.teal; c.fill();
    text(c, yenShort(v), clipX, hy - 28 * L.s, 30 * L.s, CVC.text, { bold: true, align: 'center', mono: true });
  }
  if (rv >= 1) {
    const last = V[V.length - 1];
    const k = easeOut(sub(p, 0.74, 0.86));
    c.beginPath(); c.arc(last.x, last.y, 12 * L.s, 0, Math.PI * 2); c.fillStyle = CVC.teal; c.fill();
    callout(c, L, last.x - 30 * L.s, Math.min(A.bottom - 120 * L.s, last.y + 110 * L.s), [
      { t: `評価額 ${yenFull(r.value)}`, color: CVC.text, size: 32, bold: true, mono: true },
      { t: `元本 ${yenFull(r.principal)}`, color: CVC.amber, size: 28, mono: true },
      { t: `損益 ${yenSigned(r.pl)}（${pctSigned(r.plPct)}）`, color: r.pl >= 0 ? CVC.teal : CVC.rust, size: 28, bold: true, mono: true },
    ], k);
  }
};

/** 銘柄別の積み上げ（面）。下から順に積み、左から伸ばす */
const drawStack: DrawFn = (c, L, r, _sc, p) => {
  const rows = r.stack.rows;
  if (rows.length < 2) return;
  const xs = rows.map((q) => dayNum(q.date));
  const hi = Math.max(...rows.map((q) => q.values.reduce((a, b) => a + b, 0)));
  const ticks = niceTicks(0, hi * 1.06, 4);
  const legendH = L.portrait ? Math.ceil(r.stack.names.length / 2) * 54 * L.s + 20 * L.s : 0;
  const R = { ...L.content, y: L.content.y + (L.portrait ? legendH : 10 * L.s), w: L.portrait ? L.content.w : L.content.w - 360 * L.s, h: L.content.h - (L.portrait ? legendH : 10 * L.s) };
  const labels: { x: number; label: string }[] = [];
  let lastYm = '';
  rows.forEach((q, i) => { const ym = q.date.slice(0, 7); if (ym !== lastYm && (labels.length === 0 || i - labels.length * 0 >= 0)) { lastYm = ym; labels.push({ x: xs[i], label: `${Number(q.date.slice(5, 7))}月` }); } });
  const keep = labels.filter((_, i) => i % (L.portrait ? 3 : 2) === 0 || i === labels.length - 1);
  const A = axes(c, L, R, xs[0], xs[xs.length - 1], ticks, keep, easeOut(p / 0.15));
  const rv = easeInOut(sub(p, 0.08, 0.7));
  const clipX = A.left + (A.right - A.left) * rv;
  c.save(); c.beginPath(); c.rect(A.left, A.top - 20 * L.s, clipX - A.left, A.bottom - A.top + 20 * L.s); c.clip();
  const n = r.stack.names.length;
  const base = rows.map(() => 0);
  for (let j = 0; j < n; j++) {
    const lowP = rows.map((q, i) => ({ x: A.X(xs[i]), y: A.Y(base[i]) }));
    rows.forEach((q, i) => { base[i] += q.values[j]; });
    const upP = rows.map((q, i) => ({ x: A.X(xs[i]), y: A.Y(base[i]) }));
    const col = HOLDING_COLORS[j % HOLDING_COLORS.length];
    c.beginPath(); smoothPath(c, upP); smoothPath(c, [...lowP].reverse(), false); c.closePath();
    c.globalAlpha = 0.78; c.fillStyle = col; c.fill(); c.globalAlpha = 1;
    c.beginPath(); smoothPath(c, upP); c.strokeStyle = col; c.lineWidth = 2.5 * L.s; c.stroke();
  }
  c.restore();
  // 合計（線の先頭）
  const totP = rows.map((q, i) => ({ x: A.X(xs[i]), y: A.Y(q.values.reduce((a, b) => a + b, 0)) }));
  const hy = yAt(totP, clipX);
  if (hy != null && rv > 0) {
    const v = ticks[0] + ((A.bottom - hy) / (A.bottom - A.top)) * (ticks[ticks.length - 1] - ticks[0]);
    text(c, `合計 ${yenShort(v)}`, Math.min(clipX, A.right - 90 * L.s), hy - 24 * L.s, 30 * L.s, CVC.text, { bold: true, align: 'center', mono: true });
  }
  // 凡例
  const lk = easeOut(sub(p, 0.2, 0.4));
  r.stack.shorts.forEach((nm, j) => {
    const col = HOLDING_COLORS[j % HOLDING_COLORS.length];
    const lx = L.portrait ? L.content.x + (j % 2) * (L.content.w / 2) : L.content.x + L.content.w - 330 * L.s;
    const ly = L.portrait ? L.content.y + Math.floor(j / 2) * 54 * L.s + 30 * L.s : L.content.y + 40 * L.s + j * 56 * L.s;
    c.save(); c.globalAlpha *= lk; rr(c, lx, ly - 24 * L.s, 28 * L.s, 28 * L.s, 6 * L.s); c.fillStyle = col; c.fill(); c.restore();
    text(c, nm, lx + 42 * L.s, ly, 28 * L.s, CVC.text, { alpha: lk, maxW: (L.portrait ? L.content.w / 2 : 330 * L.s) - 50 * L.s });
  });
  if (rows.some((q) => q.estimated)) text(c, '※スクショの無い月は、値動きからの推計です', L.content.x + (L.portrait ? 0 : 110 * L.s), L.content.y + L.content.h + 26 * L.s, 22 * L.s, CVC.dim, { alpha: lk });
};

const drawHoldings: DrawFn = (c, L, r, _sc, p) => {
  const list = r.holdings.slice(0, L.portrait ? 8 : 7);
  if (!list.length) return;
  const R = L.content, maxV = Math.max(...list.map((h) => h.value));
  const rowH = Math.min((L.portrait ? 120 : 92) * L.s, R.h / list.length);
  const nameW = (L.portrait ? 0 : 330) * L.s, valW = (L.portrait ? 0 : 260) * L.s, pctW = (L.portrait ? 0 : 190) * L.s;
  list.forEach((h, i) => {
    const k = easeOut(sub(p, 0.05 + i * 0.07, 0.4 + i * 0.07));
    const y = R.y + i * rowH;
    const col = HOLDING_COLORS[i % HOLDING_COLORS.length];
    if (L.portrait) {
      text(c, h.short, R.x, y + 34 * L.s, 32 * L.s, CVC.text, { bold: true, alpha: easeOut(sub(p, i * 0.07, 0.15 + i * 0.07)), maxW: R.w * 0.55 });
      text(c, yenFull(h.value * k), R.x + R.w, y + 34 * L.s, 30 * L.s, CVC.text, { align: 'right', mono: true, alpha: k });
      const bw = (R.w - (h.pct != null ? 170 * L.s : 0)) * (h.value / maxV) * k;
      rr(c, R.x, y + 50 * L.s, Math.max(4, bw), 34 * L.s, 8 * L.s); c.fillStyle = col; c.fill();
      if (h.pct != null) text(c, pctSigned(h.pct), R.x + R.w, y + 78 * L.s, 30 * L.s, h.pct >= 0 ? CVC.teal : CVC.rust, { align: 'right', bold: true, mono: true, alpha: sub(p, 0.45 + i * 0.07, 0.6 + i * 0.07) });
      return;
    }
    text(c, h.short, R.x, y + rowH / 2 + 12 * L.s, 34 * L.s, CVC.text, { bold: true, alpha: easeOut(sub(p, i * 0.07, 0.15 + i * 0.07)), maxW: nameW - 20 * L.s });
    const bx = R.x + nameW, bwMax = R.w - nameW - valW - pctW;
    rr(c, bx, y + rowH * 0.22, Math.max(4, bwMax * (h.value / maxV) * k), rowH * 0.56, 10 * L.s); c.fillStyle = col; c.fill();
    text(c, yenFull(h.value * k), bx + bwMax + valW - 10 * L.s, y + rowH / 2 + 12 * L.s, 32 * L.s, CVC.text, { align: 'right', mono: true, alpha: k });
    if (h.pct != null) text(c, pctSigned(h.pct), R.x + R.w, y + rowH / 2 + 12 * L.s, 32 * L.s, h.pct >= 0 ? CVC.teal : CVC.rust, { align: 'right', bold: true, mono: true, alpha: sub(p, 0.45 + i * 0.07, 0.6 + i * 0.07) });
  });
  if (list.some((h) => h.pct != null) && r.weekly) text(c, `右の％：前回（${Number(r.weekly.prevDate.slice(5, 7))}/${Number(r.weekly.prevDate.slice(8, 10))}）からの値動き（買い付け分を除く）`, R.x, R.y + R.h + 26 * L.s, 22 * L.s, CVC.dim, { alpha: sub(p, 0.5, 0.7) });
};

const drawPlan: DrawFn = (c, L, r, _sc, p) => {
  const rows = r.plan.rows;
  if (!rows.length) return;
  const all = rows.flatMap((q) => [q.plan, q.principal, q.actual]).filter((v) => v != null) as number[];
  const ticks = niceTicks(0, Math.max(...all) * 1.08, 4);
  const R = { ...L.content, y: L.content.y + 50 * L.s, h: L.content.h - 50 * L.s };
  const labels = rows.map((q) => ({ x: q.month, label: `${Number(q.ym.slice(5, 7))}月` })).filter((_, i, a) => i % (L.portrait ? 3 : 1) === 0 || i === a.length - 1);
  const A = axes(c, L, R, rows[0].month - 0.5, rows[rows.length - 1].month + 0.5, ticks, labels, easeOut(p / 0.15));
  legend(c, L, R.x + 110 * L.s, L.content.y + 20 * L.s, [{ label: `計画（年率${(r.plan.rate * 100).toFixed(1)}%）`, color: CVC.amber, dash: true }, { label: '実績', color: CVC.teal }], easeOut(p / 0.2));
  // 元本は棒、計画は点線、実績は棒の上の線
  const bw = Math.min(46 * L.s, ((A.right - A.left) / rows.length) * 0.5);
  rows.forEach((q, i) => {
    const k = easeOut(sub(p, 0.08 + (i / rows.length) * 0.5, 0.25 + (i / rows.length) * 0.5));
    const x = A.X(q.month);
    c.save(); c.globalAlpha *= 0.5 * k; c.fillStyle = 'rgba(133,146,172,0.55)';
    c.fillRect(x - bw / 2, A.Y(q.principal * k), bw, A.bottom - A.Y(q.principal * k)); c.restore();
  });
  const rv = easeInOut(sub(p, 0.1, 0.7)), clipX = A.left + (A.right - A.left) * rv;
  c.save(); c.beginPath(); c.rect(A.left, A.top - 30 * L.s, clipX - A.left, A.bottom - A.top + 40 * L.s); c.clip();
  const PL = rows.map((q) => ({ x: A.X(q.month), y: A.Y(q.plan) }));
  c.beginPath(); smoothPath(c, PL); c.strokeStyle = CVC.amber; c.lineWidth = 4 * L.s; c.setLineDash([14 * L.s, 10 * L.s]); c.stroke(); c.setLineDash([]);
  const AC = rows.filter((q) => q.actual != null).map((q) => ({ x: A.X(q.month), y: A.Y(q.actual as number) }));
  if (AC.length >= 2) { c.beginPath(); smoothPath(c, AC); c.strokeStyle = CVC.teal; c.lineWidth = 6 * L.s; c.stroke(); }
  AC.forEach((pt) => { c.beginPath(); c.arc(pt.x, pt.y, 8 * L.s, 0, Math.PI * 2); c.fillStyle = CVC.teal; c.fill(); });
  c.restore();
  const last = rows[rows.length - 1];
  const actual = last.actual ?? r.value, diff = actual - last.plan;
  callout(c, L, A.left + 30 * L.s, A.top + 90 * L.s, [
    { t: `計画 ${yenFull(last.plan)}`, color: CVC.amber, size: 30, mono: true },
    { t: `実績 ${yenFull(actual)}`, color: CVC.text, size: 30, bold: true, mono: true },
    { t: `差 ${yenSigned(diff)}`, color: diff >= 0 ? CVC.teal : CVC.rust, size: 30, bold: true, mono: true },
  ], easeOut(sub(p, 0.72, 0.85)), 'left');
  text(c, '灰色の棒：元本（入金の合計）', R.x + 110 * L.s, L.content.y + L.content.h + 26 * L.s, 22 * L.s, CVC.dim, { alpha: easeOut(sub(p, 0.3, 0.5)) });
};

const drawRoad: DrawFn = (c, L, r, _sc, p, t) => {
  const R = { ...L.content, y: L.content.y + 50 * L.s, h: L.content.h - 50 * L.s };
  const months = r.road.months;
  const ticks = [0, 25_000_000, 50_000_000, 75_000_000, 100_000_000, 125_000_000];
  const labels = [0, 3, 6, 9, 12, 15].filter((y) => y * 12 <= months).map((y) => ({ x: y * 12, label: `${y}年` }));
  const A = axes(c, L, R, 0, months, ticks, labels, easeOut(p / 0.15));
  const items: { label: string; color: string; dash?: boolean }[] = [{ label: `計画（年率${(r.road.rate * 100).toFixed(1)}%）`, color: CVC.teal }, { label: '元本', color: CVC.amber, dash: true }];
  if (r.road.spx) items.push({ label: `S&P500の平均（年率${(r.road.spx.rate * 100).toFixed(1)}%）`, color: CVC.blue });
  legend(c, L, R.x + 110 * L.s, L.content.y + 20 * L.s, L.portrait ? items.slice(0, 2) : items, easeOut(p / 0.2));
  if (L.portrait && items[2]) legend(c, L, R.x + 110 * L.s, L.content.y + 70 * L.s, [items[2]], easeOut(p / 0.2));
  // 目標ライン
  const gk = easeOut(sub(p, 0.05, 0.25));
  c.save(); c.globalAlpha *= gk; c.strokeStyle = CVC.amber; c.lineWidth = 3 * L.s; c.beginPath(); c.moveTo(A.left, A.Y(r.goal)); c.lineTo(A.right, A.Y(r.goal)); c.stroke(); c.restore();
  text(c, `目標 ${yenShort(r.goal)}`, A.left + 16 * L.s, A.Y(r.goal) - 16 * L.s, 32 * L.s, CVC.amber, { bold: true, alpha: gk });
  const rv = easeInOut(sub(p, 0.12, 0.7));
  const cut = (arr: { month: number; value: number }[]) => arr.filter((q) => q.month <= months * rv + 1).map((q) => ({ x: A.X(q.month), y: A.Y(Math.min(q.value, ticks[ticks.length - 1])) }));
  c.lineJoin = 'round'; c.lineCap = 'round';
  const PR = cut(r.road.curve.map((q) => ({ month: q.month, value: q.principal })));
  if (PR.length >= 2) { c.beginPath(); smoothPath(c, PR); c.strokeStyle = CVC.amber; c.lineWidth = 4 * L.s; c.setLineDash([12 * L.s, 10 * L.s]); c.stroke(); c.setLineDash([]); }
  if (r.road.spx) { const S = cut(r.road.spx.curve); if (S.length >= 2) { c.beginPath(); smoothPath(c, S); c.strokeStyle = CVC.blue; c.lineWidth = 4 * L.s; c.stroke(); } }
  const PL = cut(r.road.curve);
  if (PL.length >= 2) { c.beginPath(); smoothPath(c, PL); c.strokeStyle = CVC.teal; c.lineWidth = 6 * L.s; c.stroke(); }
  // 今ここ
  const nk = easeOut(sub(p, 0.6, 0.75));
  if (nk > 0) {
    const nx = A.X(Math.min(months, r.road.nowMonth)), ny = A.Y(r.value);
    const pulse = 1 + 0.35 * (0.5 + 0.5 * Math.sin(t * 4));
    c.save(); c.globalAlpha *= nk * 0.35; c.beginPath(); c.arc(nx, ny, 26 * L.s * pulse, 0, Math.PI * 2); c.fillStyle = CVC.rust; c.fill(); c.restore();
    c.save(); c.globalAlpha *= nk; c.beginPath(); c.arc(nx, ny, 13 * L.s, 0, Math.PI * 2); c.fillStyle = CVC.rust; c.fill(); c.restore();
    callout(c, L, nx + 40 * L.s, ny - 120 * L.s, [
      { t: `今ここ：${r.road.nowMonth}か月目`, color: CVC.rust, size: 32, bold: true },
      { t: `評価額 ${yenShort(r.value)}（目標の${r.goalPct.toFixed(2)}%）`, color: CVC.text, size: 28, mono: true },
    ], nk, 'left');
  }
  if (r.road.spx?.years) text(c, `S&P500の${r.road.spx.period}の平均なら、約${r.road.spx.years.toFixed(1)}年で${yenShort(r.goal)}`, R.x + 110 * L.s, L.content.y + L.content.h + 26 * L.s, 24 * L.s, CVC.dim, { alpha: easeOut(sub(p, 0.7, 0.85)) });
};

const drawOutro: DrawFn = (c, L, r, _sc, p, t) => {
  const cx = L.W / 2, y0 = L.portrait ? L.H * 0.33 : L.H * 0.3;
  const k = easeOut(p / 0.25);
  text(c, '今回のまとめ', cx, y0, 44 * L.s, CVC.muted, { align: 'center', alpha: k });
  const lines = [
    { t: `評価額 ${yenFull(r.value)}`, color: CVC.text },
    { t: `損益 ${yenSigned(r.pl)}（${pctSigned(r.plPct)}）`, color: r.pl >= 0 ? CVC.teal : CVC.rust },
    { t: `1億円まで ${r.goalPct.toFixed(2)}%`, color: CVC.amber },
  ];
  lines.forEach((l, i) => text(c, l.t, cx, y0 + (110 + i * 96) * L.s, (L.portrait ? 56 : 64) * L.s, l.color, { align: 'center', bold: true, mono: true, alpha: easeOut(sub(p, 0.1 + i * 0.08, 0.3 + i * 0.08)) }));
  const bk = easeOut(sub(p, 0.4, 0.6));
  const by = y0 + (110 + 3 * 96 + 40) * L.s, sc = 1 + 0.03 * Math.sin(t * 3);
  font(c, 44 * L.s, true); const bw = c.measureText('チャンネル登録で続きをチェック').width + 90 * L.s;
  c.save(); c.globalAlpha *= bk; c.translate(cx, by); c.scale(sc, sc);
  rr(c, -bw / 2, -50 * L.s, bw, 100 * L.s, 50 * L.s); c.fillStyle = '#E04B4B'; c.fill();
  text(c, 'チャンネル登録で続きをチェック', 0, 16 * L.s, 44 * L.s, '#FFFFFF', { bold: true, align: 'center' });
  c.restore();
  text(c, '※投資の判断はご自身でお願いします。過去の実績は将来の成果を保証しません。', cx, L.portrait ? L.H * 0.7 : L.H * 0.84, 24 * L.s, CVC.dim, { align: 'center', alpha: bk });
};

const DRAW: Record<string, DrawFn> = { title: drawTitle, rules: drawRules, stats: drawStats, value: drawValue, stack: drawStack, holdings: drawHoldings, plan: drawPlan, road: drawRoad, outro: drawOutro };

export interface CVFrame { report: AssetReport; scenes: CVScene[]; durs: number[]; subtitles: boolean }

/** 場面の開始時刻・長さから、ある時刻の場面と進み具合を求める */
export function sceneAt(durs: number[], time: number): { i: number; local: number; dur: number } {
  let acc = 0;
  for (let i = 0; i < durs.length; i++) { if (time < acc + durs[i] || i === durs.length - 1) return { i, local: Math.max(0, time - acc), dur: durs[i] }; acc += durs[i]; }
  return { i: 0, local: 0, dur: durs[0] || 1 };
}

/** 1コマを描く（time：動画の先頭からの秒数） */
export function drawCVFrame(c: Ctx, W: number, H: number, f: CVFrame, time: number): void {
  const L = layout(W, H);
  const total = f.durs.reduce((a, b) => a + b, 0) || 1;
  // 背景
  const g = c.createLinearGradient(0, 0, W * 0.3, H); g.addColorStop(0, CVC.bg1); g.addColorStop(1, CVC.bg0);
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  c.save(); c.strokeStyle = 'rgba(133,146,172,0.05)'; c.lineWidth = 1;
  for (let x = 0; x < W; x += 64 * L.s) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
  for (let y = 0; y < H; y += 64 * L.s) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
  c.restore();
  if (!f.scenes.length) return;
  const { i, local, dur } = sceneAt(f.durs, time);
  const sc = f.scenes[i];
  const p = clamp(local / Math.max(0.1, dur));
  // 上の帯：チャンネル名・時点
  text(c, f.report.channel, L.pad, L.top, 28 * L.s, CVC.teal, { bold: true, maxW: L.portrait ? W - L.pad * 2 : W * 0.6 });
  if (!L.portrait) text(c, `資産形成レポート ｜ ${f.report.asOf.replace(/-/g, '/')} 時点`, W - L.pad, L.top, 26 * L.s, CVC.muted, { align: 'right' });
  else text(c, `資産形成レポート ｜ ${f.report.asOf.replace(/-/g, '/')} 時点`, L.pad, L.top + 46 * L.s, 26 * L.s, CVC.muted);
  // 場面の切り替え：0.35秒で浮かび上がる
  const fade = easeOut(local / 0.35);
  c.save(); c.globalAlpha = fade;
  if (sc.kind !== 'title' && sc.kind !== 'outro') {
    const hk = easeOut(local / 0.6);
    const hs = (L.portrait ? 64 : 58) * L.s;
    const hy = L.portrait ? 250 * L.s : 160 * L.s;
    const lines = wrap(c, sc.heading, W - L.pad * 2, hs, true).slice(0, 2);
    c.save(); c.translate((1 - hk) * -30 * L.s, 0);
    c.fillStyle = CVC.teal; c.fillRect(L.pad, hy - hs * 0.85, 10 * L.s, hs * 0.95 + (lines.length - 1) * hs * 1.15);
    lines.forEach((ln, j) => text(c, ln, L.pad + 30 * L.s, hy + j * hs * 1.15, hs, CVC.text, { bold: true }));
    c.restore();
  }
  try { DRAW[sc.kind]?.(c, L, f.report, sc, p, time); } catch (e) { console.error('グラフ動画の描画エラー', sc.kind, e); }
  c.restore();
  // 字幕（ナレーションを文ごとに）
  if (f.subtitles && sc.narration) {
    const sents = sc.narration.match(/[^。！？!?]+[。！？!?]?/g)?.map((x) => x.trim()).filter(Boolean) ?? [sc.narration];
    const narrP = clamp(local / Math.max(0.5, dur - 0.9));
    const lens = sents.map((x) => x.length), sum = lens.reduce((a, b) => a + b, 0) || 1;
    let acc = 0, k = 0;
    for (; k < sents.length - 1; k++) { acc += lens[k] / sum; if (narrP < acc) break; }
    const size = (L.portrait ? 44 : 40) * L.s;
    const lines = wrap(c, sents[k], W - L.pad * 2 - 60 * L.s, size, true).slice(0, 3);
    const bh = lines.length * size * 1.35 + 36 * L.s;
    let bw = 0; font(c, size, true); lines.forEach((ln) => { bw = Math.max(bw, c.measureText(ln).width); });
    bw += 60 * L.s;
    c.save(); c.globalAlpha = fade;
    rr(c, (W - bw) / 2, L.subY, bw, bh, 16 * L.s); c.fillStyle = 'rgba(5,9,18,0.78)'; c.fill();
    lines.forEach((ln, j) => text(c, ln, W / 2, L.subY + 18 * L.s + size * 1.05 + j * size * 1.35, size, '#FFFFFF', { bold: true, align: 'center' }));
    c.restore();
  }
  // 全体の進み具合
  const elapsed = f.durs.slice(0, i).reduce((a, b) => a + b, 0) + local;
  c.fillStyle = 'rgba(133,146,172,0.18)'; c.fillRect(0, H - 6 * L.s, W, 6 * L.s);
  c.fillStyle = CVC.teal; c.fillRect(0, H - 6 * L.s, W * clamp(elapsed / total), 6 * L.s);
}

/** 場面ごとの長さ（ナレーションの長さ＋前後の余白。ナレーションが無ければ最低秒数） */
export function sceneDurations(scenes: CVScene[], narrSecs: (number | null)[]): number[] {
  return scenes.map((s, i) => Math.max(s.minSec, narrSecs[i] ? 0.4 + (narrSecs[i] as number) + 0.9 : 0));
}
export type { CVFormat };
