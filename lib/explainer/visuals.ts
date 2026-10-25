// 解説動画の図解（Canvas）。場面の visual 指定を、動きのある図表・イラストとして描く。
// 長尺は 640×400、ショートは 500×430 の仮想サイズで描き、呼び出し側（renderer.ts）が画面上の枠に合わせて拡大する。
// 外部の画像は使わず（ユーザーが追加した画像を除く）、すべて自作の図形・アイコンで構成する。
import { drawIcon } from './icons';
import { parseValue } from './scriptModel';
import type { ExplainerScene, VisualItem } from './types';

type Ctx = CanvasRenderingContext2D;

export const FONT = '"Zen Kaku Gothic New", "Yu Gothic", "Meiryo", "Hiragino Sans", sans-serif';
export const PALETTE = ['69,196,176', '217,162,75', '91,144,199', '192,101,75', '139,127,199', '242,211,91', '230,120,150'];
export const TEAL = PALETTE[0], AMBER = PALETTE[1], BLUE = PALETTE[2], RUST = PALETTE[3], WHITE = '255,255,255', INK = '11,18,34';

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const sub = (p: number, a: number, b: number) => clamp01((p - a) / Math.max(1e-6, b - a));
export const ease = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);
export const back = (x: number) => { const k = clamp01(x), s = 1.6; return 1 + (s + 1) * Math.pow(k - 1, 3) + s * Math.pow(k - 1, 2); };

export interface VisualEnv {
  W: number; H: number;
  /** 場面の進み具合（0〜1） */
  p: number;
  /** 場面が始まってからの秒数 */
  t: number;
  portrait: boolean;
  image?: HTMLImageElement | null;
  accent: string;
  /** スライド内に「出典：…」を表示するか（既定は表示しない。出典は概要欄に記載） */
  showSource?: boolean;
}

// ---------- 文字 ----------
export function font(c: Ctx, size: number, bold = false) { c.font = `${bold ? '700 ' : '500 '}${size}px ${FONT}`; }
export function text(c: Ctx, s: string, x: number, y: number, size: number, rgb = WHITE, o: { bold?: boolean; align?: CanvasTextAlign; alpha?: number; maxW?: number; base?: CanvasTextBaseline; shadow?: boolean } = {}) {
  if (!s) return;
  c.save();
  let sz = size;
  font(c, sz, o.bold);
  if (o.maxW) while (sz > 8 && c.measureText(s).width > o.maxW) { sz -= 1; font(c, sz, o.bold); }
  c.textAlign = o.align ?? 'left';
  c.textBaseline = o.base ?? 'alphabetic';
  c.globalAlpha *= o.alpha ?? 1;
  if (o.shadow) { c.shadowColor = 'rgba(0,0,0,0.55)'; c.shadowBlur = 8; c.shadowOffsetY = 2; }
  c.fillStyle = `rgb(${rgb})`;
  c.fillText(s, x, y);
  c.restore();
}
/** 日本語向けの折り返し（文字単位。句読点・閉じ括弧で行頭が始まらないよう調整） */
export function wrap(c: Ctx, s: string, maxW: number, size: number, bold = false): string[] {
  font(c, size, bold);
  const out: string[] = [];
  for (const para of String(s || '').split('\n')) {
    let cur = '';
    for (const ch of Array.from(para)) {
      if (c.measureText(cur + ch).width > maxW && cur) {
        if (/[、。，．）」』！？ー]/.test(ch)) { cur += ch; out.push(cur); cur = ''; continue; }
        out.push(cur); cur = ch;
      } else cur += ch;
    }
    if (cur) out.push(cur);
  }
  return out;
}
/** 枠に収まる大きさを探しながら複数行で描く。描いた高さを返す */
export function textBlock(c: Ctx, s: string, x: number, y: number, maxW: number, size: number, rgb = WHITE, o: { bold?: boolean; align?: CanvasTextAlign; alpha?: number; maxLines?: number; lh?: number; reveal?: number; shadow?: boolean } = {}): number {
  let sz = size, lines = wrap(c, s, maxW, sz, o.bold);
  const maxLines = o.maxLines ?? 3;
  while (lines.length > maxLines && sz > 10) { sz -= 1; lines = wrap(c, s, maxW, sz, o.bold); }
  const lh = sz * (o.lh ?? 1.35);
  const total = lines.join('').length;
  let shown = o.reveal == null ? Infinity : Math.floor(total * clamp01(o.reveal));
  lines.slice(0, maxLines).forEach((ln, i) => {
    const part = shown === Infinity ? ln : Array.from(ln).slice(0, Math.max(0, shown)).join('');
    if (shown !== Infinity) shown -= Array.from(ln).length;
    text(c, part, x, y + i * lh, sz, rgb, { bold: o.bold, align: o.align, alpha: o.alpha, shadow: o.shadow });
  });
  return Math.min(lines.length, maxLines) * lh;
}

export function rr(c: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const k = Math.max(0, Math.min(r, w / 2, h / 2));
  c.beginPath();
  c.moveTo(x + k, y); c.arcTo(x + w, y, x + w, y + h, k); c.arcTo(x + w, y + h, x, y + h, k); c.arcTo(x, y + h, x, y, k); c.arcTo(x, y, x + w, y, k); c.closePath();
}
function card(c: Ctx, x: number, y: number, w: number, h: number, rgb = WHITE, a = 0.07, border?: string) {
  rr(c, x, y, w, h, 14);
  c.fillStyle = `rgba(${rgb},${a})`; c.fill();
  if (border) { c.strokeStyle = `rgba(${border},0.55)`; c.lineWidth = 1.5; c.stroke(); }
}
function glowCircle(c: Ctx, x: number, y: number, r: number, rgb: string, a = 0.35) {
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(1, `rgba(${rgb},0)`);
  c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
}
function arrow(c: Ctx, x1: number, y1: number, x2: number, y2: number, rgb: string, k: number, t: number, w = 3) {
  if (k <= 0) return;
  const ex = x1 + (x2 - x1) * k, ey = y1 + (y2 - y1) * k;
  c.save();
  c.strokeStyle = `rgba(${rgb},0.9)`; c.lineWidth = w; c.setLineDash([8, 6]); c.lineDashOffset = -t * 30;
  c.beginPath(); c.moveTo(x1, y1); c.lineTo(ex, ey); c.stroke();
  c.setLineDash([]);
  const a = Math.atan2(y2 - y1, x2 - x1);
  c.fillStyle = `rgb(${rgb})`;
  c.beginPath(); c.moveTo(ex, ey); c.lineTo(ex - Math.cos(a - 0.45) * 12, ey - Math.sin(a - 0.45) * 12); c.lineTo(ex - Math.cos(a + 0.45) * 12, ey - Math.sin(a + 0.45) * 12); c.closePath(); c.fill();
  c.restore();
}
/** マーカーで線を引いたような強調（文字の下に半透明の帯） */
function marker(c: Ctx, x: number, y: number, w: number, h: number, rgb: string, k: number) {
  if (k <= 0) return;
  c.save(); c.fillStyle = `rgba(${rgb},0.38)`; rr(c, x, y, w * k, h, h / 2); c.fill(); c.restore();
}
function fmtNum(v: number, digits?: number): string {
  const d = digits ?? (Math.abs(v) >= 100 || Number.isInteger(v) ? 0 : Math.abs(v) >= 10 ? 1 : 2);
  return v.toLocaleString('ja-JP', { minimumFractionDigits: d, maximumFractionDigits: d });
}
function decimalsOf(s: string): number { const m = /\.(\d+)/.exec(String(s).normalize('NFKC')); return m ? Math.min(2, m[1].length) : 0; }

function heading(c: Ctx, e: VisualEnv, title: string, subtitle: string, rgb: string): number {
  if (!title && !subtitle) return 6;
  const k = ease(sub(e.p, 0, 0.12));
  c.save();
  c.globalAlpha *= k;
  c.translate((1 - k) * -16, 0);
  const size = e.portrait ? 26 : 26;
  const used = title ? textBlock(c, title, 8, 30, e.W - 16, size, WHITE, { bold: true, maxLines: 2, lh: 1.25 }) : 0;
  rr(c, 8, 30 + used - size * 0.95 + 8, Math.min(120, e.W * 0.25) * ease(sub(e.p, 0.04, 0.2)), 4, 2);
  c.fillStyle = `rgb(${rgb})`; c.fill();
  let y = 30 + used - size * 0.95 + 14;
  if (subtitle) { y += 16; textBlock(c, subtitle, 8, y, e.W - 16, 14, WHITE, { alpha: 0.68, maxLines: 2 }); y += 18; }
  c.restore();
  return y + 10;
}
function sourceNote(c: Ctx, e: VisualEnv, src: string) {
  if (!src || !e.showSource) return;
  text(c, `出典：${src}`, 8, e.H - 6, 11, WHITE, { alpha: 0.55 * ease(sub(e.p, 0.15, 0.3)), maxW: e.W - 16 });
}
const colorAt = (i: number) => PALETTE[i % PALETTE.length];
/** 単位が長い（「修正版以上」など）ときは各値に付けず、右上に「単位：…」として1回だけ出す */
function unitOf(c: Ctx, e: VisualEnv, unit: string, top: number): string {
  const u = (unit || '').trim();
  if (Array.from(u).length <= 4) return u;
  text(c, `単位：${u}`, e.W - 8, top - 6, 12, WHITE, { align: 'right', alpha: 0.6 * ease(sub(e.p, 0.1, 0.25)), maxW: e.W * 0.5 });
  return '';
}

// ---------- 種類ごとの描画 ----------
type Draw = (c: Ctx, sc: ExplainerScene, e: VisualEnv) => void;

const drawTitle: Draw = (c, sc, e) => {
  const v = sc.visual, cx = e.W / 2;
  // 回るリングと浮かぶアイコン
  c.save();
  c.translate(cx, e.H * 0.48);
  for (let i = 0; i < 3; i++) {
    c.beginPath(); c.arc(0, 0, (e.portrait ? 120 : 150) + i * 34, e.t * (0.3 + i * 0.15), e.t * (0.3 + i * 0.15) + Math.PI * (0.6 + i * 0.3));
    c.strokeStyle = `rgba(${colorAt(i)},${0.25 * ease(sub(e.p, 0.05 * i, 0.3))})`; c.lineWidth = 3; c.stroke();
  }
  c.restore();
  const icons = v.items.length ? v.items : [{ label: '', value: '', text: '', icon: 'news' } as VisualItem];
  const shown = icons.slice(0, 3), gapX = e.portrait ? 110 : 150;
  shown.forEach((it, i) => {
    const x = cx + (i - (shown.length - 1) / 2) * gapX, y = e.H * 0.8 + Math.sin(e.t * 1.6 + i) * 4;
    const k = back(sub(e.p, 0.18 + i * 0.06, 0.38 + i * 0.06));
    if (k <= 0) return;
    glowCircle(c, x, y, 46 * k, colorAt(i), 0.3);
    drawIcon(c, it.icon, x, y, 52 * k, colorAt(i), e.t);
  });
  const kick = v.emphasis || '';
  const kk = ease(sub(e.p, 0, 0.15));
  if (kick) {
    font(c, 16, true);
    const w = c.measureText(kick).width + 28;
    c.save(); c.globalAlpha *= kk; rr(c, cx - w / 2, e.H * 0.2 - 22, w, 32, 16); c.fillStyle = `rgb(${e.accent})`; c.fill(); c.restore();
    text(c, kick, cx, e.H * 0.2, 16, INK, { bold: true, align: 'center', alpha: kk });
  }
  const tk = ease(sub(e.p, 0.06, 0.28));
  c.save(); c.globalAlpha *= tk; c.translate(0, (1 - tk) * 20);
  const used = textBlock(c, v.heading || sc.title, cx, e.H * 0.4, e.W - 40, e.portrait ? 36 : 44, WHITE, { bold: true, align: 'center', maxLines: 3, lh: 1.25, shadow: true });
  c.restore();
  if (v.subheading) textBlock(c, v.subheading, cx, e.H * 0.4 + used + 6, e.W - 60, 18, WHITE, { align: 'center', alpha: 0.78 * ease(sub(e.p, 0.2, 0.4)), maxLines: 2 });
  // 光が横切る
  const sx = ((e.t * 0.35) % 1.6 - 0.3) * e.W;
  const g = c.createLinearGradient(sx - 80, 0, sx + 80, 0);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,0.06)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.fillRect(0, 0, e.W, e.H);
};

const drawChapter: Draw = (c, sc, e) => {
  const v = sc.visual, n = String(v.emphasis || '1').padStart(2, '0');
  const k = ease(sub(e.p, 0, 0.35));
  const x0 = e.portrait ? e.W / 2 : 40, align: CanvasTextAlign = e.portrait ? 'center' : 'left';
  c.save();
  font(c, e.portrait ? 150 : 190, true);
  c.textAlign = align; c.textBaseline = 'alphabetic';
  c.strokeStyle = `rgba(${e.accent},${0.9 * k})`; c.lineWidth = 3;
  c.setLineDash([1400]); c.lineDashOffset = 1400 * (1 - k);
  c.strokeText(n, x0, e.H * (e.portrait ? 0.5 : 0.52));
  c.fillStyle = `rgba(${e.accent},${0.12 * k})`; c.fillText(n, x0, e.H * (e.portrait ? 0.5 : 0.52));
  c.restore();
  text(c, 'CHAPTER', x0, e.H * (e.portrait ? 0.5 : 0.52) - (e.portrait ? 150 : 185), 16, e.accent, { bold: true, align, alpha: k });
  const tk = ease(sub(e.p, 0.15, 0.45));
  c.save(); c.globalAlpha *= tk; c.translate((1 - tk) * 30, 0);
  const ty = e.H * (e.portrait ? 0.68 : 0.72);
  const used = textBlock(c, v.heading, x0, ty, e.W - 60, e.portrait ? 32 : 36, WHITE, { bold: true, align, maxLines: 2, lh: 1.2 });
  c.restore();
  const lw = (e.portrait ? e.W * 0.5 : e.W * 0.6) * ease(sub(e.p, 0.25, 0.6));
  c.fillStyle = `rgb(${e.accent})`;
  c.fillRect(e.portrait ? e.W / 2 - lw / 2 : x0, ty + used - 18, lw, 3);
  if (v.subheading) textBlock(c, v.subheading, x0, ty + used + 14, e.W - 60, 16, WHITE, { align, alpha: 0.7 * ease(sub(e.p, 0.35, 0.6)), maxLines: 2 });
};

const drawKeyword: Draw = (c, sc, e) => {
  const v = sc.visual, cx = e.W / 2;
  const k = back(sub(e.p, 0, 0.2));
  text(c, 'キーワード', cx, 40, 15, e.accent, { bold: true, align: 'center', alpha: ease(sub(e.p, 0, 0.15)) });
  c.save(); c.translate(cx, e.H * 0.34); c.scale(k, k);
  font(c, 54, true);
  const term = v.heading || sc.title;
  let sz = e.portrait ? 50 : 58; font(c, sz, true);
  while (c.measureText(term).width > e.W - 50 && sz > 20) { sz -= 2; font(c, sz, true); }
  const tw = c.measureText(term).width;
  marker(c, -tw / 2 - 6, sz * 0.05, tw + 12, sz * 0.32, AMBER, ease(sub(e.p, 0.15, 0.4)));
  text(c, term, 0, 0, sz, WHITE, { bold: true, align: 'center', shadow: true });
  c.restore();
  if (v.subheading) text(c, v.subheading, cx, e.H * 0.34 + 36, 16, WHITE, { align: 'center', alpha: 0.7 * ease(sub(e.p, 0.15, 0.3)), maxW: e.W - 40 });
  const dk = ease(sub(e.p, 0.25, 0.45));
  if (v.emphasis) {
    const bw = e.W - (e.portrait ? 30 : 90), bx = cx - bw / 2, by = e.H * 0.5;
    c.save(); c.globalAlpha *= dk; c.translate(0, (1 - dk) * 16);
    card(c, bx, by, bw, e.portrait ? 120 : 100, e.accent, 0.12, e.accent);
    text(c, 'ひとことで言うと', bx + 18, by + 26, 13, e.accent, { bold: true });
    textBlock(c, v.emphasis, bx + 18, by + 58, bw - 36, e.portrait ? 21 : 22, WHITE, { bold: true, maxLines: 2 });
    c.restore();
  }
  v.items.slice(0, 3).forEach((it, i, arr) => {
    const kk = back(sub(e.p, 0.45 + i * 0.07, 0.6 + i * 0.07));
    if (kk <= 0) return;
    const w = e.portrait ? (e.W - 40) / arr.length - 8 : 170, x = cx + (i - (arr.length - 1) / 2) * (w + 12) - w / 2, y = e.H - 70;
    c.save(); c.globalAlpha *= clamp01(kk);
    card(c, x, y, w, 46, colorAt(i + 1), 0.14);
    drawIcon(c, it.icon, x + 24, y + 23, 26, colorAt(i + 1), e.t);
    text(c, it.label, x + 44, y + 29, 15, WHITE, { bold: true, maxW: w - 52 });
    c.restore();
  });
};

const drawPoints: Draw = (c, sc, e) => {
  const v = sc.visual;
  const top = heading(c, e, v.heading, v.subheading, e.accent);
  const items = v.items.length ? v.items : [{ label: v.emphasis || sc.caption, value: '', text: '', icon: 'bulb' } as VisualItem];
  const n = items.length;
  const cols = e.portrait ? 1 : n === 4 ? 2 : n;
  const rows = Math.ceil(n / cols);
  const gap = 12, aw = e.W - 16, ah = e.H - top - 16;
  const cw = (aw - gap * (cols - 1)) / cols, ch = Math.min(e.portrait ? 92 : 190, (ah - gap * (rows - 1)) / rows);
  const active = Math.min(n - 1, Math.floor(sub(e.p, 0.15, 0.95) * n));
  const y0 = top + Math.max(0, (ah - (rows * ch + gap * (rows - 1))) / 2);
  items.forEach((it, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const x = 8 + col * (cw + gap), y = y0 + row * (ch + gap);
    const k = back(sub(e.p, 0.06 + i * 0.08, 0.26 + i * 0.08));
    if (k <= 0) return;
    const rgb = colorAt(i);
    const on = i === active && e.p > 0.15;
    c.save(); c.globalAlpha *= clamp01(k * 1.4); c.translate(x + cw / 2, y + ch / 2); c.scale(0.92 + 0.08 * k, 0.92 + 0.08 * k); c.translate(-(x + cw / 2), -(y + ch / 2));
    card(c, x, y, cw, ch, on ? rgb : WHITE, on ? 0.16 : 0.07, on ? rgb : undefined);
    if (e.portrait || cols >= 3 && ch < 130) {
      const is = Math.min(56, ch - 24);
      glowCircle(c, x + 14 + is / 2, y + ch / 2, is * 0.9, rgb, on ? 0.35 : 0.15);
      drawIcon(c, it.icon, x + 14 + is / 2, y + ch / 2, is, rgb, e.t);
      text(c, it.label, x + 28 + is, y + (it.text ? ch / 2 - 6 : ch / 2 + 7), 19, WHITE, { bold: true, maxW: cw - is - 40 });
      if (it.text) textBlock(c, it.text, x + 28 + is, y + ch / 2 + 18, cw - is - 40, 13, WHITE, { alpha: 0.75, maxLines: 2 });
    } else {
      const is = Math.min(64, ch * 0.36);
      glowCircle(c, x + cw / 2, y + 14 + is / 2, is, rgb, on ? 0.35 : 0.15);
      drawIcon(c, it.icon, x + cw / 2, y + 14 + is / 2, is, rgb, e.t);
      text(c, it.label, x + cw / 2, y + 34 + is, 19, WHITE, { bold: true, align: 'center', maxW: cw - 20 });
      if (it.text) textBlock(c, it.text, x + cw / 2, y + 58 + is, cw - 24, 13, WHITE, { align: 'center', alpha: 0.75, maxLines: 3 });
    }
    text(c, String(i + 1), x + 12, y + 22, 13, rgb, { bold: true, alpha: 0.9 });
    c.restore();
  });
};

const drawNumber: Draw = (c, sc, e) => {
  const v = sc.visual, it = v.items[0];
  const top = heading(c, e, v.heading, v.subheading, e.accent);
  const val = parseValue(it?.value) ?? 0;
  const k = ease(sub(e.p, 0.1, 0.55));
  const d = decimalsOf(it?.value || '');
  const cy = top + (e.H - top) * 0.45;
  const icx = e.portrait ? e.W / 2 : e.W * 0.2;
  if (!e.portrait) { glowCircle(c, icx, cy, 120, e.accent, 0.25 + 0.08 * Math.sin(e.t * 2)); drawIcon(c, it?.icon || 'chartUp', icx, cy, 120 * back(sub(e.p, 0, 0.25)), e.accent, e.t); }
  const nx = e.portrait ? e.W / 2 : e.W * 0.62, align: CanvasTextAlign = 'center';
  text(c, it?.label || '', nx, cy - 70, 20, WHITE, { bold: true, align, alpha: 0.85 * ease(sub(e.p, 0.05, 0.2)), maxW: e.portrait ? e.W - 30 : e.W * 0.6 });
  const numStr = fmtNum(val * k, d);
  let sz = e.portrait ? 84 : 96; font(c, sz, true);
  const unitSz = 30;
  const maxW = (e.portrait ? e.W - 30 : e.W * 0.6) - 10;
  const bigUnit = Array.from(v.unit || '').length <= 6 ? v.unit : '';
  if (!bigUnit && v.unit) text(c, v.unit, nx, cy + 46, 16, e.accent, { bold: true, align: 'center', maxW: e.portrait ? e.W - 30 : e.W * 0.6 });
  while (sz > 30) { font(c, sz, true); const w = c.measureText(numStr).width; font(c, unitSz, true); if (w + c.measureText(bigUnit).width + 8 <= maxW) break; sz -= 4; }
  font(c, sz, true); const nw = c.measureText(numStr).width; font(c, unitSz, true); const uw = c.measureText(bigUnit).width;
  const sx = nx - (nw + uw + 8) / 2;
  marker(c, sx - 6, cy + 2, nw + uw + 20, 18, e.accent, ease(sub(e.p, 0.5, 0.7)));
  text(c, numStr, sx, cy + 10, sz, WHITE, { bold: true, shadow: true });
  text(c, bigUnit, sx + nw + 8, cy + 10, unitSz, e.accent, { bold: true });
  if (it?.text) textBlock(c, it.text, nx, cy + (bigUnit || !v.unit ? 56 : 80), e.portrait ? e.W - 30 : e.W * 0.6, 17, WHITE, { align, alpha: 0.8 * ease(sub(e.p, 0.45, 0.65)), maxLines: 2 });
  if (e.portrait) drawIcon(c, it?.icon || 'chartUp', e.W / 2, Math.min(cy + 150, e.H - 40), 60 * back(sub(e.p, 0.5, 0.7)), e.accent, e.t, 0.9);
  sourceNote(c, e, v.source);
};

const drawBar: Draw = (c, sc, e) => {
  const v = sc.visual;
  const top = heading(c, e, v.heading, v.subheading, e.accent);
  const unit = unitOf(c, e, v.unit, top);
  const items = v.items.map((it) => ({ ...it, n: parseValue(it.value) ?? 0 }));
  const n = items.length;
  const valText = (x: { n: number; value: string }, k = 1) => `${fmtNum(x.n * k, decimalsOf(x.value))}${unit}`;
  const maxAbs = Math.max(1e-9, ...items.map((x) => Math.abs(x.n)));
  const hasNeg = items.some((x) => x.n < 0);
  const maxIdx = items.reduce((b, x, i) => (x.n > items[b].n ? i : b), 0);
  const horizontal = e.portrait || n > 6 || items.some((x) => x.label.length > 6);
  const bottom = e.H - 22;
  if (horizontal) {
    const lw = Math.min(e.W * 0.32, 150), x0 = 8 + lw + 8;
    font(c, 14, true);
    // 値の文字が枠からはみ出さないよう、いちばん長い値の幅だけ右（負の値があれば左右）に空けておく
    const valW = Math.min(e.W * 0.3, Math.max(...items.map((x) => c.measureText(valText(x)).width)) + 10);
    const aw = e.W - x0 - valW - 8 - (hasNeg ? valW : 0);
    // 正と負の最大値の比で0の位置を決め、棒の長さを同じ縮尺にそろえる
    const posMax = Math.max(0, ...items.map((x) => x.n)), negMax = Math.max(0, ...items.map((x) => -x.n));
    const span = Math.max(1e-9, posMax + negMax);
    const zero = hasNeg ? x0 + valW + (aw * negMax) / span : x0;
    const unitW = hasNeg ? aw / span : aw / Math.max(1e-9, maxAbs);
    const bh = Math.min(40, (bottom - top - 8) / n - 10);
    items.forEach((it, i) => {
      const y = top + 4 + i * (bh + 10);
      const k = ease(sub(e.p, 0.1 + i * 0.06, 0.5 + i * 0.06));
      const w = Math.abs(it.n) * unitW * k;
      const rgb = i === maxIdx ? e.accent : it.n < 0 ? BLUE : '150,165,190';
      text(c, it.label, x0 - 10, y + bh / 2 + 5, 14, WHITE, { align: 'right', alpha: 0.9, maxW: lw, bold: i === maxIdx });
      rr(c, it.n < 0 ? zero - w : zero, y, Math.max(2, w), bh, 6); c.fillStyle = `rgb(${rgb})`; c.fill();
      text(c, valText(it, k), it.n < 0 ? zero - w - 6 : zero + w + 6, y + bh / 2 + 5, 14, WHITE, { bold: true, align: it.n < 0 ? 'right' : 'left', alpha: ease(sub(e.p, 0.3, 0.5)), maxW: valW - 6 });
    });
    if (hasNeg) { c.fillStyle = 'rgba(255,255,255,0.4)'; c.fillRect(zero, top, 1.5, bottom - top); }
  } else {
    const x0 = 20, aw = e.W - 40, slot = aw / n, bw = Math.min(70, slot * 0.6);
    const baseY = hasNeg ? top + (bottom - 30 - top) / 2 + 10 : bottom - 30;
    const hMax = hasNeg ? (bottom - 30 - top) / 2 - 24 : baseY - top - 30;
    c.fillStyle = 'rgba(255,255,255,0.08)';
    for (let g = 1; g <= 3; g++) c.fillRect(x0, baseY - (hMax * g) / 3, aw, 1);
    items.forEach((it, i) => {
      const k = ease(sub(e.p, 0.1 + i * 0.07, 0.5 + i * 0.07));
      const h = (Math.abs(it.n) / maxAbs) * hMax * k;
      const x = x0 + slot * i + (slot - bw) / 2;
      const rgb = i === maxIdx ? e.accent : it.n < 0 ? BLUE : '150,165,190';
      if (i === maxIdx) glowCircle(c, x + bw / 2, baseY - h, 60, e.accent, 0.18 * k);
      rr(c, x, it.n < 0 ? baseY : baseY - h, bw, Math.max(2, h), 8); c.fillStyle = `rgb(${rgb})`; c.fill();
      text(c, valText(it, k), x + bw / 2, it.n < 0 ? baseY + h + 18 : baseY - h - 8, 15, WHITE, { bold: true, align: 'center', alpha: ease(sub(e.p, 0.3, 0.5)), maxW: slot - 4 });
      text(c, it.label, x + bw / 2, bottom - 10, 14, WHITE, { align: 'center', alpha: 0.85, maxW: slot - 4, bold: i === maxIdx });
    });
    c.fillStyle = 'rgba(255,255,255,0.4)'; c.fillRect(x0, baseY, aw, 1.5);
  }
  sourceNote(c, e, v.source);
};

const drawLine: Draw = (c, sc, e) => {
  const v = sc.visual;
  const top = heading(c, e, v.heading, v.subheading, e.accent) + 6;
  const pts = v.items.map((it) => ({ label: it.label, n: parseValue(it.value) ?? 0, raw: it.value }));
  const n = pts.length;
  const lo0 = Math.min(...pts.map((p) => p.n)), hi0 = Math.max(...pts.map((p) => p.n));
  const pad = (hi0 - lo0) * 0.15 || Math.abs(hi0) * 0.1 || 1;
  const lo = lo0 - pad, hi = hi0 + pad;
  const x0 = 52, x1 = e.W - 60, y0 = top + 10, y1 = e.H - 44;
  const X = (i: number) => x0 + ((x1 - x0) * i) / Math.max(1, n - 1);
  const Y = (v2: number) => y1 - ((v2 - lo) / (hi - lo)) * (y1 - y0);
  c.save();
  for (let g = 0; g <= 4; g++) {
    const gv = lo + ((hi - lo) * g) / 4, gy = Y(gv);
    c.fillStyle = 'rgba(255,255,255,0.08)'; c.fillRect(x0, gy, x1 - x0, 1);
    text(c, fmtNum(gv), x0 - 8, gy + 4, 11, WHITE, { align: 'right', alpha: 0.5 });
  }
  const step = Math.ceil(n / (e.portrait ? 4 : 7));
  pts.forEach((p, i) => { if (i % step === 0 || i === n - 1) text(c, p.label, X(i), y1 + 20, 12, WHITE, { align: 'center', alpha: 0.7, maxW: (x1 - x0) / Math.min(n, 7) }); });
  const k = ease(sub(e.p, 0.1, 0.75));
  const upto = k * (n - 1);
  const head = { x: X(0), y: Y(pts[0].n) };
  // 面の塗り
  const grad = c.createLinearGradient(0, y0, 0, y1);
  grad.addColorStop(0, `rgba(${e.accent},0.35)`); grad.addColorStop(1, `rgba(${e.accent},0)`);
  c.beginPath(); c.moveTo(X(0), y1); c.lineTo(X(0), Y(pts[0].n));
  for (let i = 1; i <= Math.floor(upto); i++) c.lineTo(X(i), Y(pts[i].n));
  const fi = Math.floor(upto), fr = upto - fi;
  if (fi < n - 1) { head.x = X(fi) + (X(fi + 1) - X(fi)) * fr; head.y = Y(pts[fi].n + (pts[fi + 1].n - pts[fi].n) * fr); c.lineTo(head.x, head.y); }
  else { head.x = X(n - 1); head.y = Y(pts[n - 1].n); }
  c.lineTo(head.x, y1); c.closePath(); c.fillStyle = grad; c.fill();
  c.beginPath(); c.moveTo(X(0), Y(pts[0].n));
  for (let i = 1; i <= fi; i++) c.lineTo(X(i), Y(pts[i].n));
  c.lineTo(head.x, head.y);
  c.strokeStyle = `rgb(${e.accent})`; c.lineWidth = 4; c.lineJoin = 'round'; c.shadowColor = `rgba(${e.accent},0.8)`; c.shadowBlur = 12; c.stroke();
  c.shadowBlur = 0;
  pts.forEach((p, i) => { if (i <= upto + 1e-6) { c.beginPath(); c.arc(X(i), Y(p.n), 4, 0, Math.PI * 2); c.fillStyle = '#fff'; c.fill(); } });
  glowCircle(c, head.x, head.y, 24 + 4 * Math.sin(e.t * 6), e.accent, 0.5);
  c.beginPath(); c.arc(head.x, head.y, 6, 0, Math.PI * 2); c.fillStyle = `rgb(${e.accent})`; c.fill();
  if (k > 0.98) {
    const last = pts[n - 1];
    const lu = Array.from(v.unit || '').length <= 4 ? v.unit : '';
    const lbl = `${last.raw}${lu && !String(last.raw).includes(lu) ? lu : ''}`;
    font(c, 16, true); const w = c.measureText(lbl).width + 16;
    const bx = Math.min(e.W - w - 4, head.x - w / 2), by = Math.max(top, head.y - 40);
    rr(c, bx, by, w, 26, 8); c.fillStyle = `rgb(${e.accent})`; c.fill();
    text(c, lbl, bx + w / 2, by + 18, 16, INK, { bold: true, align: 'center' });
  }
  c.restore();
  sourceNote(c, e, v.source);
};

const drawDonut: Draw = (c, sc, e) => {
  const v = sc.visual;
  const top = heading(c, e, v.heading, v.subheading, e.accent);
  const dUnit = unitOf(c, e, v.unit, top);
  const items = v.items.map((it) => ({ ...it, n: Math.max(0, parseValue(it.value) ?? 0) }));
  const total = items.reduce((a, b) => a + b.n, 0) || 1;
  const r = Math.min(e.portrait ? Math.min(e.W * 0.24, (e.H - top - items.length * 30 - 40) / 2) : (e.H - top) * 0.42, 130);
  const cx = e.portrait ? e.W / 2 : e.W * 0.3, cy = e.portrait ? top + r + 10 : top + (e.H - top) / 2 - 6;
  const k = ease(sub(e.p, 0.1, 0.6));
  let a = -Math.PI / 2;
  const maxI = items.reduce((b, x, i) => (x.n > items[b].n ? i : b), 0);
  items.forEach((it, i) => {
    const span = (it.n / total) * Math.PI * 2 * k;
    const pop = i === maxI ? 6 * ease(sub(e.p, 0.6, 0.75)) : 0;
    const mid = a + span / 2;
    c.beginPath(); c.arc(cx + Math.cos(mid) * pop, cy + Math.sin(mid) * pop, r, a, a + span); c.arc(cx + Math.cos(mid) * pop, cy + Math.sin(mid) * pop, r * 0.58, a + span, a, true); c.closePath();
    c.fillStyle = `rgb(${colorAt(i)})`; c.fill();
    a += span;
  });
  const big = items[maxI];
  text(c, `${fmtNum((big.n / total) * 100 * k, 0)}%`, cx, cy + 8, 30, WHITE, { bold: true, align: 'center' });
  text(c, big.label, cx, cy + 32, 13, WHITE, { align: 'center', alpha: 0.75, maxW: r * 1.1 });
  const lx = e.portrait ? 24 : e.W * 0.58, ly = e.portrait ? cy + r + 30 : cy - (items.length * 40) / 2 + 18;
  items.forEach((it, i) => {
    const kk = ease(sub(e.p, 0.3 + i * 0.07, 0.5 + i * 0.07));
    const y = ly + i * (e.portrait ? 28 : 40);
    c.save(); c.globalAlpha *= kk; c.translate((1 - kk) * 20, 0);
    rr(c, lx, y - 13, 16, 16, 4); c.fillStyle = `rgb(${colorAt(i)})`; c.fill();
    text(c, it.label, lx + 26, y, 16, WHITE, { bold: i === maxI, maxW: e.portrait ? e.W - 150 : e.W * 0.26 });
    text(c, `${fmtNum(it.n, decimalsOf(it.value))}${dUnit}`, e.portrait ? e.W - 24 : e.W - 14, y, 16, colorAt(i), { bold: true, align: 'right', maxW: e.portrait ? 90 : e.W * 0.14 });
    c.restore();
  });
  sourceNote(c, e, v.source);
};

const drawTimeline: Draw = (c, sc, e) => {
  const v = sc.visual;
  const top = heading(c, e, v.heading, v.subheading, e.accent);
  const items = v.items, n = items.length;
  const k = ease(sub(e.p, 0.08, 0.85));
  if (e.portrait) {
    const x = 40, y0 = top + 10, y1 = e.H - 20, step = (y1 - y0) / Math.max(1, n);
    c.fillStyle = 'rgba(255,255,255,0.2)'; c.fillRect(x - 1.5, y0, 3, y1 - y0);
    c.fillStyle = `rgb(${e.accent})`; c.fillRect(x - 1.5, y0, 3, (y1 - y0) * k);
    items.forEach((it, i) => {
      const y = y0 + step * i + step * 0.35;
      const kk = back(sub(k, i / n, i / n + 0.12));
      if (kk <= 0) return;
      c.beginPath(); c.arc(x, y, 9 * kk, 0, Math.PI * 2); c.fillStyle = `rgb(${colorAt(i)})`; c.fill();
      c.save(); c.globalAlpha *= clamp01(kk);
      text(c, it.label, x + 24, y - 6, 15, colorAt(i), { bold: true, maxW: e.W - 80 });
      textBlock(c, it.text, x + 24, y + 16, e.W - 110, 15, WHITE, { maxLines: 2 });
      drawIcon(c, it.icon, e.W - 34, y + 4, 34, colorAt(i), e.t, 0.9);
      c.restore();
    });
  } else {
    const y = top + (e.H - top) * 0.48, x0 = 30, x1 = e.W - 30, step = (x1 - x0) / Math.max(1, n - 1);
    c.fillStyle = 'rgba(255,255,255,0.2)'; c.fillRect(x0, y - 1.5, x1 - x0, 3);
    c.fillStyle = `rgb(${e.accent})`; c.fillRect(x0, y - 1.5, (x1 - x0) * k, 3);
    const w = Math.min(150, step * 0.95 || 150);
    items.forEach((it, i) => {
      const x = n === 1 ? (x0 + x1) / 2 : x0 + step * i;
      const kk = back(sub(k, i / Math.max(1, n - 1) - 0.05, i / Math.max(1, n - 1) + 0.1));
      if (kk <= 0) return;
      const up = i % 2 === 0;
      c.beginPath(); c.arc(x, y, 10 * kk, 0, Math.PI * 2); c.fillStyle = `rgb(${colorAt(i)})`; c.fill();
      c.beginPath(); c.arc(x, y, 16 * kk, 0, Math.PI * 2); c.strokeStyle = `rgba(${colorAt(i)},0.4)`; c.lineWidth = 2; c.stroke();
      c.save(); c.globalAlpha *= clamp01(kk);
      const bx = Math.max(4, Math.min(e.W - w - 4, x - w / 2));
      if (up) {
        drawIcon(c, it.icon, bx + w / 2, y - 110, 40, colorAt(i), e.t);
        text(c, it.label, bx + w / 2, y - 66, 16, colorAt(i), { bold: true, align: 'center', maxW: w });
        textBlock(c, it.text, bx + w / 2, y - 42, w, 13, WHITE, { align: 'center', maxLines: 2, lh: 1.3 });
      } else {
        text(c, it.label, bx + w / 2, y + 40, 16, colorAt(i), { bold: true, align: 'center', maxW: w });
        textBlock(c, it.text, bx + w / 2, y + 62, w, 13, WHITE, { align: 'center', maxLines: 2, lh: 1.3 });
        drawIcon(c, it.icon, bx + w / 2, y + 112, 40, colorAt(i), e.t);
      }
      c.restore();
    });
  }
};

const drawFlow: Draw = (c, sc, e) => {
  const v = sc.visual;
  const top = heading(c, e, v.heading, v.subheading, e.accent);
  const items = v.items, n = items.length;
  const k = sub(e.p, 0.06, 0.8);
  if (e.portrait) {
    const gap = 26, bh = Math.min(84, (e.H - top - 10 - gap * (n - 1)) / n), bw = e.W - 40;
    items.forEach((it, i) => {
      const y = top + i * (bh + gap), kk = back(sub(k, i / n, i / n + 0.15));
      if (i > 0) arrow(c, e.W / 2, y - gap + 2, e.W / 2, y - 4, colorAt(i), ease(sub(k, (i - 0.4) / n, i / n)), e.t);
      if (kk <= 0) return;
      c.save(); c.globalAlpha *= clamp01(kk);
      card(c, 20, y, bw, bh, colorAt(i), 0.13, colorAt(i));
      drawIcon(c, it.icon, 20 + bh / 2 + 4, y + bh / 2, bh * 0.55, colorAt(i), e.t);
      text(c, it.label, 20 + bh + 12, y + (it.text ? bh / 2 - 4 : bh / 2 + 7), 19, WHITE, { bold: true, maxW: bw - bh - 24 });
      if (it.text) text(c, it.text, 20 + bh + 12, y + bh / 2 + 20, 13, WHITE, { alpha: 0.78, maxW: bw - bh - 24 });
      c.restore();
    });
  } else {
    const gap = 34, bw = (e.W - 16 - gap * (n - 1)) / n, bh = Math.min(220, e.H - top - 20), y = top + (e.H - top - bh) / 2;
    items.forEach((it, i) => {
      const x = 8 + i * (bw + gap), kk = back(sub(k, i / n, i / n + 0.15));
      if (i > 0) arrow(c, x - gap + 4, y + bh / 2, x - 4, y + bh / 2, colorAt(i), ease(sub(k, (i - 0.4) / n, i / n)), e.t);
      if (kk <= 0) return;
      c.save(); c.globalAlpha *= clamp01(kk); c.translate(0, (1 - clamp01(kk)) * 20);
      card(c, x, y, bw, bh, colorAt(i), 0.12, colorAt(i));
      text(c, `STEP ${i + 1}`, x + bw / 2, y + 22, 11, colorAt(i), { bold: true, align: 'center' });
      const is = Math.min(70, bw * 0.5);
      glowCircle(c, x + bw / 2, y + 36 + is / 2, is * 0.9, colorAt(i), 0.2);
      drawIcon(c, it.icon, x + bw / 2, y + 36 + is / 2, is, colorAt(i), e.t);
      textBlock(c, it.label, x + bw / 2, y + 62 + is, bw - 14, 17, WHITE, { bold: true, align: 'center', maxLines: 2, lh: 1.2 });
      if (it.text) textBlock(c, it.text, x + bw / 2, y + 108 + is, bw - 16, 12, WHITE, { align: 'center', alpha: 0.78, maxLines: 3 });
      c.restore();
    });
  }
};

const drawCompare: Draw = (c, sc, e) => {
  const v = sc.visual;
  const top = heading(c, e, v.heading, v.subheading, e.accent);
  const [a, b] = v.items;
  const cols = [{ it: a, rgb: TEAL, dir: -1 }, { it: b, rgb: AMBER, dir: 1 }];
  const gap = e.portrait ? 14 : 50, cw = (e.W - 16 - gap) / 2, ch = e.H - top - 14;
  cols.forEach((col, i) => {
    const x = 8 + i * (cw + gap), kk = ease(sub(e.p, 0.06 + i * 0.12, 0.3 + i * 0.12));
    if (kk <= 0 || !col.it) return;
    c.save(); c.globalAlpha *= kk; c.translate(col.dir * (1 - kk) * 40, 0);
    card(c, x, top, cw, ch, col.rgb, 0.1, col.rgb);
    rr(c, x, top, cw, 54, 14); c.fillStyle = `rgba(${col.rgb},0.85)`; c.fill();
    drawIcon(c, col.it.icon, x + 30, top + 27, 34, WHITE, e.t);
    text(c, col.it.label, x + 54, top + 34, 19, INK, { bold: true, maxW: cw - 64 });
    const lines = col.it.text.split(/\n|／|\//).map((s) => s.trim()).filter(Boolean).slice(0, 4);
    lines.forEach((ln, j) => {
      const lk = ease(sub(e.p, 0.3 + i * 0.1 + j * 0.08, 0.45 + i * 0.1 + j * 0.08));
      c.save(); c.globalAlpha *= lk;
      const y = top + 84 + j * ((ch - 90) / Math.max(4, lines.length));
      c.beginPath(); c.arc(x + 20, y - 5, 4, 0, Math.PI * 2); c.fillStyle = `rgb(${col.rgb})`; c.fill();
      textBlock(c, ln, x + 32, y, cw - 44, e.portrait ? 14 : 15, WHITE, { maxLines: 2 });
      c.restore();
    });
    c.restore();
  });
  const vk = back(sub(e.p, 0.25, 0.4));
  if (vk > 0) {
    const vx = e.W / 2, vy = top + (e.portrait ? 27 : ch / 2);
    c.save(); c.translate(vx, vy); c.scale(vk, vk);
    c.beginPath(); c.arc(0, 0, 22, 0, Math.PI * 2); c.fillStyle = `rgb(${RUST})`; c.fill();
    text(c, 'VS', 0, 6, 16, WHITE, { bold: true, align: 'center' });
    c.restore();
  }
};

const drawCycle: Draw = (c, sc, e) => {
  const v = sc.visual;
  const top = heading(c, e, v.heading, v.subheading, e.accent);
  const items = v.items, n = items.length;
  const cx = e.W / 2, cy = top + (e.H - top) / 2;
  const R = Math.min(e.W * (e.portrait ? 0.3 : 0.28), (e.H - top) * 0.32);
  const k = ease(sub(e.p, 0.08, 0.6));
  c.save();
  c.beginPath(); c.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k);
  c.strokeStyle = `rgba(${e.accent},0.5)`; c.lineWidth = 3; c.setLineDash([10, 8]); c.lineDashOffset = -e.t * 30; c.stroke(); c.setLineDash([]);
  // 回り続ける光の点
  if (k >= 1) for (let j = 0; j < 3; j++) { const a = -Math.PI / 2 + e.t * 0.9 + (j * Math.PI * 2) / 3; glowCircle(c, cx + Math.cos(a) * R, cy + Math.sin(a) * R, 14, e.accent, 0.7); }
  c.restore();
  if (v.emphasis) textBlock(c, v.emphasis, cx, cy + 6, R * 0.95, e.portrait ? 14 : 17, WHITE, { bold: true, align: 'center', maxLines: 3, alpha: ease(sub(e.p, 0.4, 0.6)) });
  items.forEach((it, i) => {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / n;
    const x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R;
    const kk = back(sub(e.p, 0.1 + (i / n) * 0.5, 0.25 + (i / n) * 0.5));
    if (kk <= 0) return;
    const r = 38 * kk;
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fillStyle = `rgba(${colorAt(i)},0.95)`; c.fill();
    drawIcon(c, it.icon, x, y, r * 1.15, WHITE, e.t);
    const ly = y + (Math.sin(a) > 0.3 ? (Math.abs(Math.cos(a)) < 0.3 ? 6 : 58) : Math.sin(a) < -0.3 ? (Math.abs(Math.cos(a)) < 0.3 ? 6 : -46) : 6);
    const lx = x + (Math.cos(a) > 0.3 ? 46 : Math.cos(a) < -0.3 ? -46 : 46);
    text(c, it.label, lx, ly, 16, WHITE, { bold: true, align: Math.cos(a) < -0.3 ? 'right' : 'left', alpha: clamp01(kk), maxW: e.portrait ? 120 : 170 });
  });
};

const drawIllustration: Draw = (c, sc, e) => {
  const v = sc.visual;
  const items = v.items.length ? v.items : [{ label: '', value: '', text: '', icon: 'bulb' } as VisualItem];
  const top = v.heading ? heading(c, e, v.heading, '', e.accent) : 10;
  const cx = e.W / 2, cy = top + (e.H - top - 60) / 2 + 10;
  // 浮遊する粒子
  for (let i = 0; i < 26; i++) {
    const px = ((i * 97.13 + e.t * (6 + (i % 5) * 3)) % e.W), py = (e.H - ((i * 53.7 + e.t * (10 + (i % 4) * 4)) % e.H));
    c.beginPath(); c.arc(px, py, 1.5 + (i % 3), 0, Math.PI * 2); c.fillStyle = `rgba(${colorAt(i)},0.25)`; c.fill();
  }
  const sats = items.slice(1);
  const R = Math.min(e.W * (e.portrait ? 0.36 : 0.34), (e.H - top) * 0.36);
  sats.forEach((it, i) => {
    const a = -Math.PI / 2 + (i - (sats.length - 1) / 2) * ((Math.PI * 2) / (sats.length + 1)) + Math.sin(e.t * 0.4) * 0.04;
    const x = cx + Math.cos(a) * R * (e.portrait ? 1 : 1.35), y = cy + Math.sin(a) * R * 0.9;
    const kk = back(sub(e.p, 0.2 + i * 0.08, 0.38 + i * 0.08));
    if (kk <= 0) return;
    c.save(); c.globalAlpha *= clamp01(kk);
    c.setLineDash([4, 6]); c.strokeStyle = `rgba(${colorAt(i + 1)},0.5)`; c.lineWidth = 2;
    c.beginPath(); c.moveTo(cx, cy); c.lineTo(x, y); c.stroke(); c.setLineDash([]);
    const m = (e.t * 0.6 + i * 0.3) % 1;
    glowCircle(c, cx + (x - cx) * m, cy + (y - cy) * m, 9, colorAt(i + 1), 0.9);
    c.beginPath(); c.arc(x, y, 40, 0, Math.PI * 2); c.fillStyle = 'rgba(11,18,34,0.85)'; c.fill(); c.strokeStyle = `rgba(${colorAt(i + 1)},0.8)`; c.lineWidth = 2; c.stroke();
    drawIcon(c, it.icon, x, y + Math.sin(e.t * 1.5 + i) * 2, 48 * clamp01(kk), colorAt(i + 1), e.t);
    text(c, it.label, x, y + 60, 15, WHITE, { bold: true, align: 'center', maxW: 140 });
    c.restore();
  });
  const ck = back(sub(e.p, 0, 0.25));
  const pulse = (e.t % 2) / 2;
  c.beginPath(); c.arc(cx, cy, 70 + pulse * 40, 0, Math.PI * 2); c.strokeStyle = `rgba(${e.accent},${0.4 * (1 - pulse)})`; c.lineWidth = 3; c.stroke();
  glowCircle(c, cx, cy, 120 * ck, e.accent, 0.35);
  drawIcon(c, items[0].icon, cx, cy + Math.sin(e.t * 1.2) * 3, 110 * ck, e.accent, e.t);
  if (items[0].label) text(c, items[0].label, cx, cy + 82, 18, WHITE, { bold: true, align: 'center', alpha: clamp01(ck), maxW: 200 });
  if (v.emphasis) {
    const kk = ease(sub(e.p, 0.45, 0.65));
    font(c, 18, true); const w = Math.min(e.W - 20, c.measureText(v.emphasis).width + 40);
    c.save(); c.globalAlpha *= kk; c.translate(0, (1 - kk) * 14);
    rr(c, cx - w / 2, e.H - 52, w, 38, 19); c.fillStyle = 'rgba(11,18,34,0.85)'; c.fill(); c.strokeStyle = `rgba(${e.accent},0.7)`; c.lineWidth = 1.5; c.stroke();
    text(c, v.emphasis, cx, e.H - 27, 18, WHITE, { bold: true, align: 'center', maxW: w - 24 });
    c.restore();
  }
};

const drawImage: Draw = (c, sc, e) => {
  const img = e.image;
  if (!img || !img.complete || !img.naturalWidth) { drawIllustration(c, sc, e); return; }
  const v = sc.visual;
  const k = ease(sub(e.p, 0, 0.15));
  c.save(); c.globalAlpha *= k;
  rr(c, 0, 0, e.W, e.H, 16); c.clip();
  // ゆっくり寄りながら少し動く（Ken Burns）
  const z = 1.06 + 0.08 * e.p, sc0 = Math.max(e.W / img.naturalWidth, e.H / img.naturalHeight) * z;
  const dw = img.naturalWidth * sc0, dh = img.naturalHeight * sc0;
  const dir = (sc.id.charCodeAt(sc.id.length - 1) % 2) ? 1 : -1;
  c.drawImage(img, (e.W - dw) / 2 + dir * (e.p - 0.5) * 30, (e.H - dh) / 2 - (e.p - 0.5) * 16, dw, dh);
  const g = c.createLinearGradient(0, e.H * 0.45, 0, e.H);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.75)');
  c.fillStyle = g; c.fillRect(0, 0, e.W, e.H);
  c.restore();
  if (v.heading) text(c, v.heading, 20, 36, 22, WHITE, { bold: true, shadow: true, maxW: e.W - 40, alpha: k });
  const msg = v.emphasis || sc.caption;
  if (msg) textBlock(c, msg, 20, e.H - (e.portrait ? 70 : 50), e.W - 40, e.portrait ? 22 : 24, WHITE, { bold: true, maxLines: 2, shadow: true, alpha: ease(sub(e.p, 0.15, 0.35)) });
  text(c, '※イメージ', e.W - 12, 20, 11, WHITE, { align: 'right', alpha: 0.7 });
};

const drawPoint: Draw = (c, sc, e) => {
  const v = sc.visual, cx = e.W / 2;
  const icon = v.items[0]?.icon;
  const k = ease(sub(e.p, 0, 0.25));
  text(c, 'POINT', cx, e.portrait ? 60 : 56, 16, e.accent, { bold: true, align: 'center', alpha: k });
  c.fillStyle = `rgba(${e.accent},${k})`; c.fillRect(cx - 22, (e.portrait ? 60 : 56) + 8, 44, 3);
  text(c, '“', 26, 110, 110, e.accent, { bold: true, alpha: 0.25 * k });
  text(c, '”', e.W - 26, e.H - 30, 110, e.accent, { bold: true, align: 'right', alpha: 0.25 * k });
  const msg = v.emphasis || v.heading || sc.caption;
  const size = e.portrait ? 32 : 36;
  const lines = wrap(c, msg, e.W - 90, size, true).slice(0, 3);
  const lh = size * 1.4, y0 = e.H * 0.48 - ((lines.length - 1) * lh) / 2 + (icon ? -10 : 0);
  lines.forEach((ln, i) => {
    font(c, size, true); const w = c.measureText(ln).width;
    marker(c, cx - w / 2 - 4, y0 + i * lh - size * 0.18, w + 8, size * 0.36, e.accent, ease(sub(e.p, 0.25 + i * 0.1, 0.45 + i * 0.1)));
    const lk = ease(sub(e.p, 0.05 + i * 0.08, 0.25 + i * 0.08));
    c.save(); c.globalAlpha *= lk; c.translate(0, (1 - lk) * 12);
    text(c, ln, cx, y0 + i * lh, size, WHITE, { bold: true, align: 'center', shadow: true });
    c.restore();
  });
  if (v.subheading) textBlock(c, v.subheading, cx, y0 + lines.length * lh + 14, e.W - 100, 16, WHITE, { align: 'center', alpha: 0.72 * ease(sub(e.p, 0.4, 0.6)), maxLines: 2 });
  if (icon) drawIcon(c, icon, cx, e.H - (e.portrait ? 70 : 52), 54 * back(sub(e.p, 0.4, 0.6)), e.accent, e.t);
};

const drawQa: Draw = (c, sc, e) => {
  const v = sc.visual;
  const qk = back(sub(e.p, 0, 0.18));
  const bw = e.W - 40, qh = e.portrait ? 120 : 100;
  c.save(); c.globalAlpha *= clamp01(qk); c.translate(0, (1 - clamp01(qk)) * 20);
  card(c, 20, 30, bw, qh, BLUE, 0.16, BLUE);
  c.beginPath(); c.arc(56, 30 + qh / 2, 24, 0, Math.PI * 2); c.fillStyle = `rgb(${BLUE})`; c.fill();
  text(c, 'Q', 56, 30 + qh / 2 + 9, 26, WHITE, { bold: true, align: 'center' });
  textBlock(c, v.heading || sc.caption, 96, 30 + qh / 2 - 4, bw - 96, e.portrait ? 21 : 22, WHITE, { bold: true, maxLines: 2 });
  c.restore();
  const ak = back(sub(e.p, 0.32, 0.5));
  if (ak > 0) {
    const ay = 30 + qh + 26, ah = e.H - ay - 20;
    c.save(); c.globalAlpha *= clamp01(ak); c.translate(0, (1 - clamp01(ak)) * 20);
    card(c, 20, ay, bw, ah, e.accent, 0.13, e.accent);
    c.beginPath(); c.arc(56, ay + 40, 24, 0, Math.PI * 2); c.fillStyle = `rgb(${e.accent})`; c.fill();
    text(c, 'A', 56, ay + 49, 26, INK, { bold: true, align: 'center' });
    const used = textBlock(c, v.emphasis || '', 96, ay + 48, bw - 110, e.portrait ? 24 : 26, WHITE, { bold: true, maxLines: 3 });
    if (v.subheading) textBlock(c, v.subheading, 96, ay + 48 + used + 6, bw - 110, 15, WHITE, { alpha: 0.78, maxLines: 3 });
    c.restore();
  }
};

const drawSummary: Draw = (c, sc, e) => {
  const v = sc.visual;
  const top = heading(c, e, v.heading || 'まとめ', v.subheading, e.accent);
  const items = v.items, n = items.length;
  const rowH = Math.min(e.portrait ? 84 : 70, (e.H - top - 10) / Math.max(1, n));
  items.forEach((it, i) => {
    const y = top + i * rowH;
    const kk = ease(sub(e.p, 0.08 + i * 0.12, 0.25 + i * 0.12));
    if (kk <= 0) return;
    c.save(); c.globalAlpha *= kk; c.translate((1 - kk) * -30, 0);
    card(c, 8, y, e.W - 16, rowH - 10, WHITE, 0.07);
    const ck = back(sub(e.p, 0.18 + i * 0.12, 0.3 + i * 0.12));
    drawIcon(c, 'check', 8 + (rowH - 10) / 2 + 6, y + (rowH - 10) / 2, (rowH - 26) * ck, colorAt(i), e.t);
    textBlock(c, it.label || it.text, 8 + rowH + 6, y + (rowH - 10) / 2 + 7, e.W - rowH - 40, e.portrait ? 18 : 19, WHITE, { bold: true, maxLines: 2 });
    c.restore();
  });
};

const drawCta: Draw = (c, sc, e) => {
  const v = sc.visual, cx = e.W / 2;
  const k = back(sub(e.p, 0, 0.25));
  glowCircle(c, cx, e.H * 0.38, 160, e.accent, 0.18 + 0.05 * Math.sin(e.t * 2));
  drawIcon(c, v.items[0]?.icon || (e.portrait ? 'arrowDown' : 'megaphone'), cx, e.H * 0.3 + (e.portrait ? Math.sin(e.t * 4) * 6 : 0), 96 * k, e.accent, e.t);
  textBlock(c, v.heading || sc.caption, cx, e.H * 0.56, e.W - 50, e.portrait ? 30 : 32, WHITE, { bold: true, align: 'center', maxLines: 2, shadow: true, alpha: ease(sub(e.p, 0.1, 0.3)) });
  if (v.emphasis) {
    const bk = back(sub(e.p, 0.3, 0.5));
    font(c, 20, true); const w = Math.min(e.W - 40, c.measureText(v.emphasis).width + 56);
    const pulse = 1 + 0.03 * Math.sin(e.t * 5);
    c.save(); c.translate(cx, e.H * 0.78); c.scale(bk * pulse, bk * pulse);
    rr(c, -w / 2, -24, w, 48, 24); c.fillStyle = `rgb(${RUST})`; c.fill();
    text(c, v.emphasis, 0, 8, 20, WHITE, { bold: true, align: 'center', maxW: w - 30 });
    c.restore();
  }
};

const drawSources: Draw = (c, sc, e) => {
  const v = sc.visual;
  const top = heading(c, e, v.heading || '参考資料', v.subheading, e.accent);
  v.items.slice(0, e.portrait ? 6 : 7).forEach((it, i) => {
    const y = top + 8 + i * 42;
    const kk = ease(sub(e.p, 0.05 + i * 0.05, 0.2 + i * 0.05));
    c.save(); c.globalAlpha *= kk;
    drawIcon(c, 'document', 24, y + 2, 24, colorAt(i), e.t);
    text(c, it.label, 46, y + 2, 16, WHITE, { bold: true, maxW: e.W - 60 });
    if (it.text) text(c, it.text, 46, y + 20, 12, WHITE, { alpha: 0.6, maxW: e.W - 60 });
    c.restore();
  });
  text(c, '図解・イラストはオリジナルです。数値は各資料の公表値にもとづきます。', 8, e.H - 6, 11, WHITE, { alpha: 0.55, maxW: e.W - 16 });
};

const DRAWERS: Record<string, Draw> = {
  title: drawTitle, chapter: drawChapter, keyword: drawKeyword, points: drawPoints, number: drawNumber,
  bar: drawBar, line: drawLine, donut: drawDonut, timeline: drawTimeline, flow: drawFlow, compare: drawCompare,
  cycle: drawCycle, illustration: drawIllustration, image: drawImage, point: drawPoint, qa: drawQa,
  summary: drawSummary, cta: drawCta, sources: drawSources,
};

/** 場面の図解を、仮想サイズ（e.W×e.H）の座標で描く */
export function drawVisual(c: Ctx, sc0: ExplainerScene, e: VisualEnv): void {
  let sc = sc0;
  // 数値として扱えない値（バージョン番号・日付など）しかないグラフは、要点カードとして描く（以前に保存した台本にも効くよう描画時にも確認）
  const k0 = sc.visual.kind;
  if (k0 === 'bar' || k0 === 'line' || k0 === 'donut' || k0 === 'number') {
    const nums = sc.visual.items.filter((it) => parseValue(it.value) !== null).length;
    if (nums < (k0 === 'number' ? 1 : 2)) sc = { ...sc, visual: { ...sc.visual, kind: 'points', items: sc.visual.items.slice(0, 4).map((it) => ({ ...it, text: [it.value, it.text].filter(Boolean).join(' ') })) } };
  }
  const fn = DRAWERS[sc.visual.kind] ?? drawPoint;
  c.save();
  c.textBaseline = 'alphabetic';
  try { fn(c, sc, e); } catch (err) { console.error('図解の描画エラー', sc.visual.kind, err); }
  c.restore();
}
