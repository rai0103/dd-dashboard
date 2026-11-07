// 解説動画の図解（Canvas）。場面の visual 指定を、動きのある図表・イラストとして描く。
// 長尺は 640×400、ショートは 500×430 の仮想サイズで描き、呼び出し側（renderer.ts）が画面上の枠に合わせて拡大する。
// 外部の画像は使わず（ユーザーが追加した画像を除く）、すべて自作の図形・アイコンで構成する。
import { drawIcon } from './icons';
import { parseValue } from './scriptModel';
import type { ExplainerScene, VisualItem, FanRole } from './types';

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
  // [Stage E-16] 背景の推移（例：全期間の指数）をうっすら描く
  if (v.background && v.background.length > 1) {
    const bg = v.background;
    const bxLo = bg[0].x, bxHi = bg[bg.length - 1].x;
    const byLo = Math.min(...bg.map((p) => p.y)), byHi = Math.max(...bg.map((p) => p.y));
    const BX = (x: number) => 10 + ((e.W - 20) * (x - bxLo)) / Math.max(1e-9, bxHi - bxLo);
    const BY = (y: number) => e.H * 0.92 - ((y - byLo) / Math.max(1e-9, byHi - byLo)) * e.H * 0.6;
    const bk = ease(sub(e.p, 0, 0.5));
    const cut = bxLo + (bxHi - bxLo) * bk;
    const vis = bg.filter((p) => p.x <= cut);
    if (vis.length > 1) {
      const g2 = c.createLinearGradient(0, e.H * 0.3, 0, e.H);
      g2.addColorStop(0, `rgba(${e.accent},0.16)`); g2.addColorStop(1, `rgba(${e.accent},0)`);
      c.beginPath(); c.moveTo(BX(vis[0].x), e.H); vis.forEach((p) => c.lineTo(BX(p.x), BY(p.y))); c.lineTo(BX(vis[vis.length - 1].x), e.H); c.closePath(); c.fillStyle = g2; c.fill();
      c.beginPath(); c.moveTo(BX(vis[0].x), BY(vis[0].y)); vis.forEach((p) => c.lineTo(BX(p.x), BY(p.y)));
      c.strokeStyle = `rgba(${e.accent},0.4)`; c.lineWidth = 2; c.stroke();
    }
  }
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
  // [Stage E-16] 下部の注意書き（任意）
  if (v.titleNote) textBlock(c, v.titleNote, cx, e.H - 14, e.W - 40, 11, WHITE, { align: 'center', alpha: 0.6 * ease(sub(e.p, 0.25, 0.45)), maxLines: 1 });
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

// [Stage E-9] yearCompare：複数の系列（線）を1つの横軸（例：年初からの経過日数）に重ねて描く。
// v.itemsは「系列ごとにグループ化したVisualItemの寄せ集め」（item.seriesKey/x/seriesEmphasisを使う。
// lib/explainer/stockCatalog.tsのresolveYearCompareItemsが組み立てる）。強調系列（seriesEmphasis）は
// アクセントカラーで太く、それ以外は白の細線・低めの不透明度で背景として重ねる（ダッシュボード本体の
// 「年比較」チャートと同じ考え方：今年や注目の系列だけを目立たせ、他は参考として薄く見せる）。
const drawOverlay: Draw = (c, sc, e) => {
  const v = sc.visual;
  const top = heading(c, e, v.heading, v.subheading, e.accent) + 6;
  const groups = new Map<string, { label: string; emphasis: boolean; tone?: 'warn'; pts: { x: number; n: number; markerLabel?: string }[] }>();
  v.items.forEach((it, idx) => {
    const n = parseValue(it.value);
    if (n === null) return;
    const key = it.seriesKey || it.seriesLabel || it.label || `s${idx}`;
    const g = groups.get(key) ?? { label: it.seriesLabel || it.label || key, emphasis: !!it.seriesEmphasis, tone: it.seriesTone, pts: [] };
    const x = Number.isFinite(it.x) ? (it.x as number) : g.pts.length;
    g.pts.push({ x, n, markerLabel: it.markerLabel });
    if (it.seriesTone) g.tone = it.seriesTone;
    groups.set(key, g);
  });
  const series = [...groups.values()].map((g) => ({ ...g, pts: [...g.pts].sort((a, b) => a.x - b.x) })).filter((g) => g.pts.length >= 2);
  if (!series.length) { sourceNote(c, e, v.source); return; }
  const allX = series.flatMap((g) => g.pts.map((p) => p.x));
  const allN = series.flatMap((g) => g.pts.map((p) => p.n));
  const xLo = Math.min(...allX), xHi = Math.max(...allX) || 1;
  const lo0 = Math.min(...allN), hi0 = Math.max(...allN);
  const pad = (hi0 - lo0) * 0.12 || Math.abs(hi0) * 0.1 || 1;
  const lo = lo0 - pad, hi = hi0 + pad;
  const legendRows = Math.max(1, Math.ceil(series.length / (e.portrait ? 2 : 3)));
  const legendH = legendRows * 17 + 6;
  const x0 = 54, x1 = e.W - 20, y0 = top + 6, y1 = e.H - 36 - legendH;
  const X = (x: number) => x0 + ((x1 - x0) * (x - xLo)) / Math.max(1, xHi - xLo);
  const Y = (n: number) => y1 - ((n - lo) / Math.max(1e-6, hi - lo)) * (y1 - y0);
  c.save();
  for (let g = 0; g <= 4; g++) {
    const gv = lo + ((hi - lo) * g) / 4, gy = Y(gv);
    c.fillStyle = 'rgba(255,255,255,0.08)'; c.fillRect(x0, gy, x1 - x0, 1);
    text(c, fmtNum(gv), x0 - 8, gy + 4, 11, WHITE, { align: 'right', alpha: 0.5 });
  }
  const k = ease(sub(e.p, 0.08, 0.8));
  const drawSeries = (g: { pts: { x: number; n: number; markerLabel?: string }[] }, rgb: string, alpha: number, lw: number, glow: boolean) => {
    const n = g.pts.length;
    const upto = k * (n - 1);
    const fi = Math.floor(upto), fr = upto - fi;
    c.beginPath();
    c.moveTo(X(g.pts[0].x), Y(g.pts[0].n));
    for (let i = 1; i <= fi; i++) c.lineTo(X(g.pts[i].x), Y(g.pts[i].n));
    if (fi < n - 1) {
      const hx = g.pts[fi].x + (g.pts[fi + 1].x - g.pts[fi].x) * fr;
      const hn = g.pts[fi].n + (g.pts[fi + 1].n - g.pts[fi].n) * fr;
      c.lineTo(X(hx), Y(hn));
    }
    c.strokeStyle = `rgba(${rgb},${alpha})`; c.lineWidth = lw; c.lineJoin = 'round';
    if (glow) { c.shadowColor = `rgba(${rgb},0.7)`; c.shadowBlur = 10; }
    c.stroke();
    c.shadowBlur = 0;
    // [Stage E-10] この点に注釈（markerLabel）があり、線がそこまで届いていれば丸印とラベルを添える
    g.pts.forEach((p, i) => {
      if (!p.markerLabel || i > upto + 1e-6) return;
      const mx = X(p.x), my = Y(p.n);
      c.beginPath(); c.arc(mx, my, 5, 0, Math.PI * 2); c.fillStyle = `rgb(${rgb})`; c.fill();
      c.lineWidth = 1.5; c.strokeStyle = '#05080f'; c.stroke();
      const above = i % 2 === 0;
      font(c, 11, true); const w = c.measureText(p.markerLabel).width + 12;
      const by = above ? my - 26 : my + 10;
      rr(c, mx - w / 2, by, w, 18, 9); c.fillStyle = 'rgba(6,10,19,0.88)'; c.fill();
      c.strokeStyle = `rgba(${rgb},0.7)`; c.lineWidth = 1; c.stroke();
      text(c, p.markerLabel, mx, by + 13, 11, rgb, { bold: true, align: 'center' });
    });
  };
  series.filter((g) => !g.emphasis && g.tone !== 'warn').forEach((g) => drawSeries(g, WHITE, 0.26, 2, false));
  series.filter((g) => !g.emphasis && g.tone === 'warn').forEach((g) => drawSeries(g, RUST, 0.55, 2.5, false));
  series.filter((g) => g.emphasis).forEach((g) => drawSeries(g, e.accent, 0.95, 4, true));
  text(c, fmtNum(xLo), x0, y1 + 20, 11, WHITE, { alpha: 0.5 });
  text(c, fmtNum(xHi), x1, y1 + 20, 11, WHITE, { align: 'right', alpha: 0.5 });
  if (v.unit) text(c, v.unit, x1, y0 - 10, 11, WHITE, { align: 'right', alpha: 0.45 });
  let lx = x0, ly = y1 + 36;
  series.forEach((g) => {
    const rgb = g.emphasis ? e.accent : g.tone === 'warn' ? RUST : WHITE;
    const alpha = g.emphasis || g.tone === 'warn' ? 1 : 0.7;
    c.beginPath(); c.moveTo(lx, ly - 4); c.lineTo(lx + 14, ly - 4);
    c.strokeStyle = `rgba(${rgb},${alpha})`; c.lineWidth = g.emphasis ? 4 : 2; c.stroke();
    font(c, 11); const w = c.measureText(g.label).width;
    text(c, g.label, lx + 18, ly, 11, rgb, { alpha: g.emphasis ? 1 : 0.8 });
    lx += 18 + w + 16;
    if (lx > e.W - 70) { lx = x0; ly += 17; }
  });
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
  // [Stage E-12] ダッシュボードのスクショ等、枠（16:10相当）と縦横比が大きく異なる画像をcoverで
  // 敷き詰めると、端（グラフの凡例・軸ラベル・最新の日付など）が大きく切れてしまう
  // （ユーザー報告：「まだ見切れていますね」）。coverに必要なクロップ量が大きい場合だけ、
  // 画像全体が収まるcontain表示に切り替える（背景はぼかし拡大したcoverコピーで余白を埋める）。
  const coverScale = Math.max(e.W / img.naturalWidth, e.H / img.naturalHeight);
  const containScale = Math.min(e.W / img.naturalWidth, e.H / img.naturalHeight);
  const needsContain = coverScale > containScale * 1.3;
  if (needsContain) {
    c.save();
    // @ts-ignore: CanvasRenderingContext2D.filterはTS libには含まれるが、念のため存在確認してから使う
    if ('filter' in c) (c as any).filter = 'blur(18px) brightness(0.5)';
    const bw = img.naturalWidth * coverScale * 1.08, bh = img.naturalHeight * coverScale * 1.08;
    c.drawImage(img, (e.W - bw) / 2, (e.H - bh) / 2, bw, bh);
    // @ts-ignore
    if ('filter' in c) (c as any).filter = 'none';
    c.restore();
    const dw = img.naturalWidth * containScale, dh = img.naturalHeight * containScale;
    c.drawImage(img, (e.W - dw) / 2, (e.H - dh) / 2, dw, dh);
  } else {
    // ゆっくり寄りながら少し動く（Ken Burns）
    const z = 1.06 + 0.08 * e.p, sc0 = coverScale * z;
    const dw = img.naturalWidth * sc0, dh = img.naturalHeight * sc0;
    const dir = (sc.id.charCodeAt(sc.id.length - 1) % 2) ? 1 : -1;
    c.drawImage(img, (e.W - dw) / 2 + dir * (e.p - 0.5) * 30, (e.H - dh) / 2 - (e.p - 0.5) * 16, dw, dh);
  }
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

// [Stage E-10] 'branch'：ある時点（分岐点）までの実績パス（白い太線）から、複数の結末（色分けした破線＋
// 統計パネル）へ分岐する図。sc.visual.branch（types.tsのBranchSpec）を直接描く。AI生成では使わず、
// lib/explainer/の固定場面ビルダー（例：accelIntroScene.ts）からのみ使う。
const drawBranch: Draw = (c, sc, e) => {
  const v = sc.visual;
  const top = heading(c, e, v.heading, v.subheading, e.accent) + 4;
  const br = v.branch;
  if (!br || !br.lead?.length) { sourceNote(c, e, v.source); return; }
  // 統計パネルは専用の右側レーンに固定し、分岐の線・ラベルと重ならないようにする
  const hasPanels = br.outcomes.some((o) => o.stat);
  const panelW = hasPanels ? Math.min(e.W * 0.4, 230) : 0;
  const x0 = 54, x1 = e.W - 20 - (hasPanels ? panelW + 16 : 0), y0 = top + 6, y1 = e.H - 34;
  const allPts = [...br.lead, ...br.outcomes.flatMap((o) => o.path)];
  const xs = allPts.map((p) => p.x), ns = allPts.map((p) => p.n);
  const xLo = Math.min(...xs), xHi = Math.max(...xs) || 1;
  const nVals = br.thresholdY != null ? [...ns, br.thresholdY] : ns;
  const nLo0 = Math.min(...nVals), nHi0 = Math.max(...nVals);
  const pad = (nHi0 - nLo0) * 0.12 || 1;
  const nLo = nLo0 - pad, nHi = nHi0 + pad;
  const X = (x: number) => x0 + ((x1 - x0) * (x - xLo)) / Math.max(1e-6, xHi - xLo);
  const Y = (n: number) => y1 - ((n - nLo) / Math.max(1e-6, nHi - nLo)) * (y1 - y0);
  c.save();
  const bt = niceTicks(nLo, nHi, 4), bstep = bt.length > 1 ? bt[1] - bt[0] : 1; // [Stage E-16] きりのよい目盛り
  bt.forEach((gv) => {
    const gy = Y(gv);
    c.fillStyle = 'rgba(255,255,255,0.08)'; c.fillRect(x0, gy, x1 - x0, 1);
    text(c, `${tickText(gv, bstep)}${br.unit ?? ''}`, x0 - 8, gy + 4, 11, WHITE, { align: 'right', alpha: 0.5 });
  });
  if (br.thresholdY != null) {
    const ty = Y(br.thresholdY);
    c.save(); c.setLineDash([4, 5]); c.strokeStyle = `rgba(${AMBER},0.85)`; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(x0, ty); c.lineTo(x1, ty); c.stroke(); c.restore();
    if (br.thresholdLabel) text(c, br.thresholdLabel, x0 + 4, ty - 6, 11, AMBER, { bold: true, alpha: 0.9 });
  }
  const leadN = br.lead.length;
  const leadK = ease(sub(e.p, 0.06, 0.45));
  const leadUpto = leadK * (leadN - 1);
  const leadFi = Math.min(leadN - 1, Math.floor(leadUpto)), leadFr = leadUpto - leadFi;
  c.beginPath(); c.moveTo(X(br.lead[0].x), Y(br.lead[0].n));
  for (let i = 1; i <= leadFi; i++) c.lineTo(X(br.lead[i].x), Y(br.lead[i].n));
  if (leadFi < leadN - 1) {
    const bx = br.lead[leadFi].x + (br.lead[leadFi + 1].x - br.lead[leadFi].x) * leadFr;
    const bn = br.lead[leadFi].n + (br.lead[leadFi + 1].n - br.lead[leadFi].n) * leadFr;
    c.lineTo(X(bx), Y(bn));
  }
  c.strokeStyle = `rgb(${WHITE})`; c.lineWidth = 4.5; c.lineJoin = 'round'; c.lineCap = 'round'; c.stroke();
  if (leadK >= 0.999) {
    const lp = br.lead[leadN - 1];
    c.beginPath(); c.arc(X(lp.x), Y(lp.n), 7, 0, Math.PI * 2); c.fillStyle = `rgb(${AMBER})`; c.fill();
    c.lineWidth = 2; c.strokeStyle = '#05080f'; c.stroke();
  }

  const brK = ease(sub(e.p, 0.4, 0.85));
  let panelY = top;
  br.outcomes.forEach((o, i) => {
    const rgb = o.tone === 'up' ? TEAL : RUST;
    const n = o.path.length;
    if (n < 1) return;
    const upto = brK * (n - 1);
    const fi = Math.min(n - 1, Math.floor(upto)), fr = upto - fi;
    c.save(); c.globalAlpha *= clamp01(brK * 1.3); c.setLineDash([7, 6]);
    c.beginPath(); c.moveTo(X(o.path[0].x), Y(o.path[0].n));
    for (let k2 = 1; k2 <= fi; k2++) c.lineTo(X(o.path[k2].x), Y(o.path[k2].n));
    let hx = o.path[fi].x, hn = o.path[fi].n;
    if (fi < n - 1) { hx = o.path[fi].x + (o.path[fi + 1].x - o.path[fi].x) * fr; hn = o.path[fi].n + (o.path[fi + 1].n - o.path[fi].n) * fr; }
    c.lineTo(X(hx), Y(hn));
    c.strokeStyle = `rgba(${rgb},0.9)`; c.lineWidth = 3; c.lineJoin = 'round'; c.stroke();
    c.setLineDash([]);
    c.beginPath(); c.arc(X(hx), Y(hn), 6, 0, Math.PI * 2); c.fillStyle = `rgb(${rgb})`; c.fill();
    const labelAlign: CanvasTextAlign = X(hx) > x1 - 70 ? 'right' : 'center';
    text(c, o.label, Math.min(X(hx), x1), Y(hn) + (o.tone === 'up' ? -14 : 22), 13, rgb, { bold: true, align: labelAlign, maxW: 170 });
    c.restore();
    if (o.stat && brK > 0.3) {
      const ph = 22 + o.stat.lines.length * 18 + 8;
      const px = e.W - 20 - panelW;
      c.save(); c.globalAlpha *= ease(sub(e.p, 0.5 + i * 0.1, 0.75 + i * 0.1));
      rr(c, px, panelY, panelW, ph, 12); c.fillStyle = 'rgba(6,10,19,0.92)'; c.fill();
      c.strokeStyle = `rgba(${rgb},0.6)`; c.lineWidth = 1.5; c.stroke();
      text(c, o.stat.title, px + 14, panelY + 20, 13, rgb, { bold: true, maxW: panelW - 24 });
      o.stat.lines.forEach((ln, j) => text(c, ln, px + 14, panelY + 40 + j * 18, 12, WHITE, { alpha: 0.85, maxW: panelW - 24 }));
      c.restore();
      panelY += ph + 10;
    }
  });
  c.restore();
  sourceNote(c, e, v.source);
};

// [Stage E-10] 'histogram'：区間ごとの棒グラフ（更新間隔など分布の形を見せる）。items[i].seriesEmphasis=true の
// 1項目を「現在」として強調する。
const drawHistogram: Draw = (c, sc, e) => {
  const v = sc.visual;
  let top = heading(c, e, v.heading, v.subheading, e.accent);
  top += chipsRow(c, e, v.chips, top - 4); // [Stage E-16] 数値チップ（任意）
  const items = v.items.map((it) => ({ ...it, n: Math.max(0, parseValue(it.value) ?? 0) }));
  const n = items.length;
  if (!n) { sourceNote(c, e, v.source); return; }
  const maxN = Math.max(1e-9, ...items.map((x) => x.n));
  const curIdx = items.findIndex((it) => it.seriesEmphasis);
  const bottom = e.H - (e.showSource ? 36 : 30), x0 = 16, aw = e.W - 32, slot = aw / n, bw = Math.max(3, slot * 0.78);
  const hMax = Math.max(10, bottom - top - 24);
  c.fillStyle = 'rgba(255,255,255,0.08)';
  for (let g = 1; g <= 3; g++) c.fillRect(x0, bottom - (hMax * g) / 3, aw, 1);
  items.forEach((it, i) => {
    const k = ease(sub(e.p, 0.06 + (i * 0.6) / n, 0.3 + (i * 0.6) / n));
    const h = (it.n / maxN) * hMax * k;
    const x = x0 + slot * i + (slot - bw) / 2;
    const isCur = i === curIdx;
    const rgb = isCur ? e.accent : '150,165,190';
    if (isCur) glowCircle(c, x + bw / 2, bottom - h, 50, e.accent, 0.22 * k);
    rr(c, x, bottom - h, bw, Math.max(2, h), Math.min(4, bw / 2)); c.fillStyle = `rgb(${rgb})`; c.fill();
    if (isCur) text(c, '現在', x + bw / 2, bottom - h - 10, 12, e.accent, { bold: true, align: 'center' });
  });
  const step = Math.max(1, Math.ceil(n / (e.portrait ? 6 : 12)));
  items.forEach((it, i) => {
    // 現在の区分のラベルは必ず出し、その両隣は重なるので省く
    const nearCur = curIdx >= 0 && Math.abs(i - curIdx) === 1;
    if ((i % step === 0 || (i === n - 1 && (n - 1) % step === 0) || i === curIdx) && (!nearCur || i === curIdx)) {
      text(c, it.label, x0 + slot * i + slot / 2, bottom + 16, 10, i === curIdx ? e.accent : WHITE, { align: 'center', alpha: i === curIdx ? 1 : 0.6, maxW: slot * (i === curIdx ? 2 : step) - 2, bold: i === curIdx });
    }
  });
  c.fillStyle = 'rgba(255,255,255,0.4)'; c.fillRect(x0, bottom, aw, 1.5);
  sourceNote(c, e, v.source);
};

// [Stage E-10] 'distribution'：カテゴリごとの個別サンプルをドット1つずつ（ビーズウォーム）で示し、
// 平均をアクセント色の丸で重ねる。sc.visual.distribution（types.tsのDistributionSpec）を直接描く。
const drawDistribution: Draw = (c, sc, e) => {
  const v = sc.visual;
  const top = heading(c, e, v.heading, v.subheading, e.accent);
  const dist = v.distribution;
  const groups = (dist?.groups ?? []).filter((g) => g.samples.length);
  const n = groups.length;
  if (!n) { sourceNote(c, e, v.source); return; }
  const allVals = groups.flatMap((g) => g.samples);
  const lo0 = Math.min(...allVals), hi0 = Math.max(...allVals);
  const pad = (hi0 - lo0) * 0.12 || Math.abs(hi0) * 0.1 || 1;
  const logScale = !!dist!.logScale && lo0 > 0;
  const lo = logScale ? Math.max(lo0 * 0.85, 1e-6) : lo0 - pad;
  const hi = hi0 + pad;
  const bottom = e.H - 42, x0 = 54, aw = e.W - 70, slot = aw / n; // 下に区分ラベル＋出典の2段を確保する（28だと出典行と重なっていた）
  const y1 = bottom, y0 = top + 10;
  const toLog = (val: number) => Math.log(Math.max(val, 1e-6));
  const Y = logScale
    ? (val: number) => y1 - ((toLog(Math.max(val, lo)) - toLog(lo)) / Math.max(1e-6, toLog(hi) - toLog(lo))) * (y1 - y0)
    : (val: number) => y1 - ((val - lo) / Math.max(1e-6, hi - lo)) * (y1 - y0);
  c.save();
  // [Stage E-16] 目盛りはきりのよい値に（対数目盛のときは従来どおり等分）
  const dTicks = logScale ? [0.25, 0.5, 1, 2, 5, 10, 20, 50, 100].filter((v2) => v2 >= lo && v2 <= hi) : niceTicks(lo, hi, 5);
  const dStep = dTicks.length > 1 ? Math.abs(dTicks[1] - dTicks[0]) : 1;
  dTicks.forEach((gv) => {
    const gy = Y(gv);
    c.fillStyle = 'rgba(255,255,255,0.07)'; c.fillRect(x0 - 6, gy, aw + 12, 1);
    text(c, `${logScale ? fmtNum(gv) : tickText(gv, dStep)}${dist?.unit || ''}`, x0 - 12, gy + 4, 10, WHITE, { align: 'right', alpha: 0.45 });
  });
  if (lo < 0 && hi > 0) { c.fillStyle = 'rgba(255,255,255,0.3)'; c.fillRect(x0 - 6, Y(0), aw + 12, 1.5); }
  const k = ease(sub(e.p, 0.1, 0.8));
  groups.forEach((g, gi) => {
    const cx = x0 + slot * gi + slot / 2;
    const shown = Math.floor(g.samples.length * clamp01(k - gi * 0.05));
    const r = Math.max(1.6, Math.min(4, slot / 16));
    for (let i = 0; i < shown; i++) {
      const val = g.samples[i];
      const jitter = (((i * 92821 + gi * 71) % 1000) / 1000 - 0.5) * (slot * 0.62);
      c.beginPath(); c.arc(cx + jitter, Y(val), r, 0, Math.PI * 2);
      c.fillStyle = `rgba(${WHITE},0.45)`; c.fill();
    }
    const mean = g.mean ?? g.samples.reduce((a, b) => a + b, 0) / g.samples.length;
    const mk = ease(sub(e.p, 0.55 + gi * 0.03, 0.8 + gi * 0.03));
    if (mk > 0) {
      c.beginPath(); c.arc(cx, Y(mean), 7 * mk, 0, Math.PI * 2);
      c.fillStyle = `rgb(${e.accent})`; c.fill();
      c.lineWidth = 2; c.strokeStyle = '#fff'; c.stroke();
    }
    text(c, g.label, cx, bottom + 18, 12, WHITE, { align: 'center', alpha: 0.85, maxW: slot - 4, bold: true });
  });
  c.restore();
  sourceNote(c, e, v.source);
};

// [Stage E-13] 'groupedBar'：同じカテゴリ内で複数系列（例：翌営業日・20営業日後）を棒で並べて比較する。
// drawBarと違い、items内で同じlabel（カテゴリ）を持つ複数のVisualItemを、seriesKey/seriesLabelで束ねて
// 横に並べる（yearCompareと同じ要領でseriesKey等を流用。専用のSpecは持たない）。
const drawGroupedBar: Draw = (c, sc, e) => {
  const v = sc.visual;
  let top = heading(c, e, v.heading, v.subheading, e.accent);
  top += chipsRow(c, e, v.chips, top - 4); // [Stage E-16] 数値チップ（任意）
  const unit = unitOf(c, e, v.unit, top);
  // カテゴリ（label）の出現順を保ったまま、その中の系列（seriesKey）も出現順でまとめる
  const catOrder: string[] = [];
  const seriesOrder: string[] = [];
  const seriesLabelOf = new Map<string, string>();
  const table = new Map<string, Map<string, number>>(); // category -> seriesKey -> value
  v.items.forEach((it, idx) => {
    const n = parseValue(it.value);
    if (n === null) return;
    const cat = it.label || `c${idx}`;
    const sk = it.seriesKey || it.seriesLabel || 's0';
    if (!catOrder.includes(cat)) catOrder.push(cat);
    if (!seriesOrder.includes(sk)) { seriesOrder.push(sk); seriesLabelOf.set(sk, it.seriesLabel || sk); }
    const row = table.get(cat) ?? new Map<string, number>();
    row.set(sk, n);
    table.set(cat, row);
  });
  if (!catOrder.length || !seriesOrder.length) { sourceNote(c, e, v.source); return; }
  const allVals = [...table.values()].flatMap((row) => [...row.values()]);
  const maxAbs = Math.max(1e-9, ...allVals.map((x) => Math.abs(x)));
  const hasNeg = allVals.some((x) => x < 0);
  const legendRows = Math.max(1, Math.ceil(seriesOrder.length / (e.portrait ? 2 : 4)));
  const legendH = legendRows * 17;
  // 下に「区分ラベル行(20)＋余白(16)＋凡例(legendH)＋出典の余白(16)」の4段を確保する
  // （24+legendHだけだと区分ラベル行の分が足りず、区分ラベル・凡例・出典が重なっていた）
  const bottom = e.H - 20 - 16 - legendH - 16;
  const x0 = 16, aw = e.W - 32, nCat = catOrder.length, slot = aw / nCat;
  const baseY = hasNeg ? top + 16 + (bottom - top - 16) / 2 : bottom;
  const hMax = hasNeg ? (bottom - top - 16) / 2 - 20 : bottom - top - 30;
  const nSeries = seriesOrder.length;
  const groupW = Math.min(slot * 0.82, 26 * nSeries + 8 * (nSeries - 1));
  const barW = Math.max(4, (groupW - 8 * (nSeries - 1)) / nSeries);
  c.save();
  c.fillStyle = 'rgba(255,255,255,0.08)';
  for (let g = 1; g <= 3; g++) {
    const gy = hasNeg ? baseY - (hMax * g) / 3 : baseY - (hMax * g) / 3;
    c.fillRect(x0, gy, aw, 1);
  }
  catOrder.forEach((cat, ci) => {
    const row = table.get(cat)!;
    const gx = x0 + slot * ci + (slot - groupW) / 2;
    seriesOrder.forEach((sk, si) => {
      const val = row.get(sk);
      if (val == null) return;
      const k = ease(sub(e.p, 0.08 + (ci * 0.5) / nCat, 0.4 + (ci * 0.5) / nCat));
      const h = (Math.abs(val) / maxAbs) * hMax * k;
      const x = gx + si * (barW + 8);
      const rgb = colorAt(si);
      rr(c, x, val < 0 ? baseY : baseY - h, barW, Math.max(2, h), Math.min(4, barW / 2));
      c.fillStyle = `rgb(${rgb})`; c.fill();
      if (ci === 0 || nCat <= 4) {
        text(c, `${fmtNum(val, decimalsOf(String(val)))}${unit}`, x + barW / 2, val < 0 ? baseY + h + 14 : baseY - h - 6, 10, WHITE, { align: 'center', alpha: ease(sub(e.p, 0.3, 0.5)), bold: true, maxW: barW + 10 });
      }
    });
    text(c, cat, x0 + slot * ci + slot / 2, bottom + 16, 12, WHITE, { align: 'center', alpha: 0.85, maxW: slot - 4, bold: true });
  });
  c.fillStyle = 'rgba(255,255,255,0.4)'; c.fillRect(x0, baseY, aw, 1.5);
  // 凡例（系列名＋色）
  let lx = x0, ly = bottom + 36;
  seriesOrder.forEach((sk, si) => {
    const rgb = colorAt(si);
    const label = seriesLabelOf.get(sk) || sk;
    rr(c, lx, ly - 10, 12, 12, 3); c.fillStyle = `rgb(${rgb})`; c.fill();
    font(c, 12, false); const w = c.measureText(label).width;
    text(c, label, lx + 18, ly, 12, WHITE, { alpha: 0.85 });
    lx += 18 + w + 18;
    if (lx > e.W - 60 && si < seriesOrder.length - 1) { lx = x0; ly += 17; }
  });
  c.restore();
  sourceNote(c, e, v.source);
};

// ======================================================================
// [Stage E-16] S&P500動画（モックアップ25枚）の固定場面専用の図解。仕様データ（visual.fan等）を直接描く。
// ======================================================================
/** 目盛り用のきりのよい値（1・2・2.5・5×10^k刻み） */
function niceTicks(lo: number, hi: number, count = 4): number[] {
  const raw = (hi - lo) / Math.max(1, count);
  if (!(raw > 0)) return [lo];
  const p10 = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p10).find((st) => st >= raw) ?? 10 * p10;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6 || 0); // −0を0に
  return out;
}
const tickText = (v: number, step: number) => fmtNum(v, step >= 1 ? 0 : step >= 0.1 ? 1 : 2);
/** 札の幅（pillと同じ寸法） */
function pillW(c: Ctx, s: string, size = 10) { font(c, size, true); return c.measureText(s).width + 10; }
/** 暗い角丸の札に文字を描く（線や塗りの上でも読めるように） */
function pill(c: Ctx, s: string, x: number, y: number, rgb: string, align: 'left' | 'right' | 'center' = 'left', size = 10) {
  font(c, size, true); const w = c.measureText(s).width + 10;
  const bx = align === 'left' ? x : align === 'right' ? x - w : x - w / 2;
  rr(c, bx, y - size - 2, w, size + 7, (size + 7) / 2); c.fillStyle = 'rgba(6,10,19,0.85)'; c.fill();
  text(c, s, bx + w / 2, y + 1, size, rgb, { bold: true, align: 'center' });
}

const ROLE_RGB = (role: FanRole | undefined, accent: string): string =>
  role === 'focus' ? accent : role === 'median' ? AMBER : role === 'avg' ? BLUE : role === 'warn' ? RUST : WHITE;

/** 数値チップ（ラベル＋値）を横に並べる。描いた高さを返す */
function chipsRow(c: Ctx, e: VisualEnv, chips: { label: string; value: string; role?: FanRole }[] | undefined, y: number): number {
  if (!chips || !chips.length) return 0;
  const gap = 6, h = 34;
  const perRow = Math.min(4, chips.length);
  const w = (e.W - 16 - gap * (perRow - 1)) / perRow;
  chips.forEach((ch, i) => {
    const row = Math.floor(i / perRow), col = i % perRow;
    const x = 8 + col * (w + gap), yy = y + row * (h + gap);
    const k = ease(sub(e.p, 0.1 + i * 0.05, 0.25 + i * 0.05));
    if (k <= 0) return;
    const rgb = ch.role ? ROLE_RGB(ch.role, e.accent) : WHITE;
    c.save(); c.globalAlpha *= k;
    rr(c, x, yy, w, h, 9); c.fillStyle = `rgba(${rgb},${ch.role ? 0.14 : 0.07})`; c.fill();
    if (ch.role) { c.strokeStyle = `rgba(${rgb},0.6)`; c.lineWidth = 1.2; c.stroke(); }
    text(c, ch.label, x + 8, yy + 13, e.portrait ? 9 : 10, WHITE, { alpha: 0.7, maxW: w - 14 });
    text(c, ch.value, x + 8, yy + 29, e.portrait ? 13 : 14, ch.role ? rgb : WHITE, { bold: true, maxW: w - 14 });
    c.restore();
  });
  return Math.ceil(chips.length / perRow) * (h + gap);
}

const drawFan: Draw = (c, sc, e) => {
  const v = sc.visual, f = v.fan;
  let top = heading(c, e, v.heading, v.subheading, e.accent);
  if (!f) { sourceNote(c, e, v.source); return; }
  top += chipsRow(c, e, f.chips, top - 4);
  const fg = f.series.filter((s) => s.role !== 'bg');
  const bgCount = f.series.length - fg.length;
  const legendItems = [...fg.map((s) => ({ label: s.label, rgb: ROLE_RGB(s.role, e.accent), w: s.role === 'focus' ? 4 : 2.5, band: false })),
    ...(f.band ? [{ label: f.band.label, rgb: BLUE, w: 10, band: true }] : []),
    ...(bgCount && f.bgLegend ? [{ label: f.bgLegend, rgb: WHITE, w: 1.2, band: false }] : [])];
  // 凡例の行数（実際の幅で折り返しを数える）
  let legendRows = 1;
  { let lx = 48; font(c, 10); legendItems.forEach((it) => { const w = 20 + c.measureText(it.label).width + 14; if (lx + w > e.W - 8) { legendRows++; lx = 48; } lx += w; }); }
  const legendH = legendRows * 15;
  const hasEnd = fg.some((s) => s.endLabel);
  // 下から：出典(14)・凡例・目盛り(16)
  const x0 = 46, x1 = e.W - (hasEnd ? 80 : 14), y0 = top + 8, y1 = e.H - (e.showSource ? 16 : 6) - legendH - 18;
  const xs: number[] = [], ys: number[] = [];
  f.series.forEach((s) => s.points.forEach((p) => { xs.push(p.x); ys.push(p.y); }));
  f.band?.points.forEach((p) => { xs.push(p.x); ys.push(p.lo, p.hi); });
  f.markers?.forEach((m) => { xs.push(m.x); ys.push(m.y); });
  f.hLines?.forEach((h) => ys.push(h.y));
  if (!xs.length) { sourceNote(c, e, v.source); return; }
  const xLo = Math.min(...xs), xHi = Math.max(...xs);
  let lo0 = Math.min(...ys), hi0 = Math.max(...ys);
  if (f.clipBg) {
    // 背景の細線は外れ値で縦軸が広がりすぎないよう5〜95%の範囲だけを軸に含める（はみ出した分は枠で切る）
    const fgY: number[] = [];
    fg.forEach((s2) => s2.points.forEach((p) => fgY.push(p.y)));
    f.band?.points.forEach((p) => fgY.push(p.lo, p.hi));
    const bgY = f.series.filter((s2) => s2.role === 'bg').flatMap((s2) => s2.points.map((p) => p.y)).sort((a, b) => a - b);
    const q = (t: number) => bgY[Math.min(bgY.length - 1, Math.max(0, Math.round((bgY.length - 1) * t)))];
    lo0 = Math.min(...fgY, bgY.length ? q(0.03) : Infinity); hi0 = Math.max(...fgY, bgY.length ? q(0.97) : -Infinity);
  }
  const pad = (hi0 - lo0) * 0.08 || 1;
  const lo = lo0 - pad, hi = hi0 + pad;
  const X = (x: number) => x0 + ((x1 - x0) * (x - xLo)) / Math.max(1e-9, xHi - xLo);
  const Y = (y: number) => y1 - ((y - lo) / Math.max(1e-9, hi - lo)) * (y1 - y0);
  const u = f.yUnit ?? '';
  c.save();
  const yt = niceTicks(lo, hi, 5), ystep = yt.length > 1 ? yt[1] - yt[0] : 1;
  yt.forEach((gv) => {
    const gy = Y(gv);
    c.fillStyle = 'rgba(255,255,255,0.07)'; c.fillRect(x0, gy, x1 - x0, 1);
    text(c, `${tickText(gv, ystep)}${u}`, x0 - 6, gy + 4, 10, WHITE, { align: 'right', alpha: 0.5 });
  });
  c.save(); c.beginPath(); c.rect(x0 - 1, y0 - 4, x1 - x0 + 2, y1 - y0 + 8); c.clip();
  if (lo < 0 && hi > 0) { c.fillStyle = 'rgba(255,255,255,0.28)'; c.fillRect(x0, Y(0), x1 - x0, 1); }
  const ticks = f.xTicks ?? [xLo, (xLo + xHi) / 2, xHi].map((x) => ({ x: Math.round(x), label: `${fmtNum(Math.round(x))}${f.xUnit ?? ''}` }));

  f.hLines?.forEach((h) => {
    c.save(); c.setLineDash([5, 5]); c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(x0, Y(h.y)); c.lineTo(x1, Y(h.y)); c.stroke(); c.restore();
  });
  const k = ease(sub(e.p, 0.08, 0.7));
  const xCut = xLo + (xHi - xLo) * k;
  if (f.band && f.band.points.length > 1) {
    const pts = f.band.points.filter((p) => p.x <= xCut + 1e-9);
    if (pts.length > 1) {
      c.beginPath(); c.moveTo(X(pts[0].x), Y(pts[0].hi));
      pts.forEach((p) => c.lineTo(X(p.x), Y(p.hi)));
      [...pts].reverse().forEach((p) => c.lineTo(X(p.x), Y(p.lo)));
      c.closePath(); c.fillStyle = `rgba(${BLUE},0.2)`; c.fill();
    }
  }
  const drawPath = (pts: { x: number; y: number }[], rgb: string, alpha: number, lw: number, glow: boolean, dash = false) => {
    const vis = pts.filter((p) => p.x <= xCut + 1e-9);
    if (vis.length < 2) return null;
    c.save();
    c.beginPath(); c.moveTo(X(vis[0].x), Y(vis[0].y));
    for (let i = 1; i < vis.length; i++) c.lineTo(X(vis[i].x), Y(vis[i].y));
    c.strokeStyle = `rgba(${rgb},${alpha})`; c.lineWidth = lw; c.lineJoin = 'round';
    if (dash) c.setLineDash([6, 5]);
    if (glow) { c.shadowColor = `rgba(${rgb},0.75)`; c.shadowBlur = 10; }
    c.stroke(); c.restore();
    return vis[vis.length - 1];
  };
  if (f.predictBox && f.predictBox.fromX < xHi) {
    // 「予測」の枠（実績線の先を赤枠で囲む）
    const bx = X(Math.max(xLo, f.predictBox.fromX)) + 2;
    c.save(); rr(c, bx, y0 - 2, x1 - bx + 2, y1 - y0 + 4, 10);
    c.fillStyle = `rgba(${RUST},0.06)`; c.fill(); c.setLineDash([]); c.strokeStyle = `rgba(${RUST},0.85)`; c.lineWidth = 1.6; c.stroke(); c.restore();
  }
  f.series.filter((s) => s.role === 'bg').forEach((s) => drawPath(s.points, WHITE, Math.max(0.1, Math.min(0.3, 4 / Math.max(1, bgCount))), 1.1, false));
  const order: FanRole[] = ['lead', 'avg', 'warn', 'median', 'focus'];
  const ends: { x: number; y: number; label: string; rgb: string }[] = [];
  order.forEach((role) => f.series.filter((s) => s.role === role).forEach((s) => {
    const rgb = ROLE_RGB(role, e.accent);
    const end = drawPath(s.points, rgb, role === 'focus' || role === 'lead' ? 1 : 0.92, s.dash ? 1.8 : role === 'focus' ? 3.6 : role === 'lead' ? 3 : 2.4, role === 'focus' && !s.dash, !!s.dash);
    if (end && s.endLabel && k > 0.97) ends.push({ x: X(end.x), y: Y(end.y), label: s.endLabel, rgb });
  }));
  c.restore(); // クリップ解除
  ticks.forEach((t) => { if (t.x >= xLo && t.x <= xHi) text(c, t.label, Math.min(x1 - 12, Math.max(x0 + 12, X(t.x))), y1 + 15, 10, WHITE, { align: 'center', alpha: 0.6 }); });
  f.hLines?.forEach((h) => pill(c, h.label, x1 - 2, Y(h.y) - 3, WHITE, 'right'));
  if (f.predictBox && f.predictBox.fromX < xHi) pill(c, f.predictBox.label, X(Math.max(xLo, f.predictBox.fromX)) + 8, y0 + 12, RUST, 'left', 11);
  if (f.note) textBlock(c, f.note, x0 + 4, f.notePos === 'bottom' ? y1 - 30 : y0 + (f.predictBox ? 30 : 12), Math.min(x1 - x0 - 8, e.portrait ? 300 : 340), 10, WHITE, { alpha: 0.8 * ease(sub(e.p, 0.4, 0.6)), maxLines: 3 });
  // 右端のラベル（重ならないよう縦に押し下げる）
  ends.sort((a, b) => a.y - b.y);
  let lastY = -Infinity;
  ends.forEach((en) => {
    const ey = Math.min(y1 + 4, Math.max(y0 + 4, en.y));
    const y = Math.max(ey + 4, lastY + 14); lastY = y;
    c.beginPath(); c.arc(en.x, ey, 3.5, 0, Math.PI * 2); c.fillStyle = `rgb(${en.rgb})`; c.fill();
    text(c, en.label, en.x + 6, y, 11, en.rgb, { bold: true, maxW: e.W - en.x - 8 });
  });
  if (f.nowX != null && f.nowX >= xLo && f.nowX <= xHi) {
    const nx = X(f.nowX);
    c.save(); c.setLineDash([4, 4]); c.strokeStyle = `rgba(${AMBER},0.8)`; c.lineWidth = 1.2;
    c.beginPath(); c.moveTo(nx, y0); c.lineTo(nx, y1); c.stroke(); c.restore();
    text(c, f.nowLabel ?? '現在', nx, y0 + 10, 10, AMBER, { align: 'center', bold: true });
  }
  f.markers?.forEach((m, i) => {
    if (m.x > xCut + 1e-9) return;
    const rgb = ROLE_RGB(m.role ?? 'median', e.accent);
    const mx = X(m.x), my = Y(m.y);
    c.beginPath(); c.arc(mx, my, 4.5, 0, Math.PI * 2); c.fillStyle = `rgb(${rgb})`; c.fill();
    c.lineWidth = 1.5; c.strokeStyle = '#05080f'; c.stroke();
    font(c, 10, true); const w = c.measureText(m.label).width + 10;
    const above = i % 2 === 0;
    const bx = Math.min(e.W - w - 4, Math.max(4, mx - w / 2)), by = above ? my - 24 : my + 8;
    rr(c, bx, by, w, 16, 8); c.fillStyle = 'rgba(6,10,19,0.88)'; c.fill();
    c.strokeStyle = `rgba(${rgb},0.7)`; c.lineWidth = 1; c.stroke();
    text(c, m.label, bx + w / 2, by + 12, 10, rgb, { bold: true, align: 'center' });
  });
  // 凡例
  let lx = 48, ly = y1 + 30;
  legendItems.forEach((it) => {
    font(c, 10); const w = c.measureText(it.label).width;
    if (lx + 20 + w + 14 > e.W - 8) { lx = 48; ly += 15; }
    if (it.band) { c.fillStyle = `rgba(${BLUE},0.35)`; c.fillRect(lx, ly - 8, 16, 7); }
    else { c.beginPath(); c.moveTo(lx, ly - 4); c.lineTo(lx + 16, ly - 4); c.strokeStyle = `rgba(${it.rgb},${it.rgb === WHITE && it.w < 2 ? 0.5 : 1})`; c.lineWidth = Math.min(4, it.w); c.stroke(); }
    text(c, it.label, lx + 20, ly, 10, it.rgb, { alpha: 0.85 });
    lx += 20 + w + 14;
  });
  c.restore();
  sourceNote(c, e, v.source);
};

const drawZoomLine: Draw = (c, sc, e) => {
  const v = sc.visual, z = v.zoomLine;
  let top = heading(c, e, v.heading, v.subheading, e.accent);
  if (!z || z.points.length < 2) { sourceNote(c, e, v.source); return; }
  top += chipsRow(c, e, z.chips, top - 4);
  const n = z.points.length, zf = Math.max(0, Math.min(n - 2, z.zoomFrom));
  const x0 = 56, x1 = e.W - 34, y0 = top + 14, y1 = e.H - (e.showSource ? 34 : 24);
  // 0〜0.45：全体を描く／0.35〜0.45：ズーム範囲の枠／0.5〜0.7：横軸・縦軸をズーム範囲へ／0.7〜：各日の騰落率
  const zk = ease(sub(e.p, 0.5, 0.7));
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const iLo = lerp(0, zf, zk), iHi = n - 1;
  const ysAll = z.points.map((p) => p.y), ysZoom = z.points.slice(zf).map((p) => p.y);
  const pad = (a: number[]) => { const lo = Math.min(...a), hi = Math.max(...a), d = (hi - lo) * 0.15 || 0.5; return [lo - d, hi + d]; };
  const [aLo, aHi] = pad(ysAll), [bLo, bHi] = pad(ysZoom);
  const lo = lerp(aLo, bLo, zk), hi = lerp(aHi, bHi, zk);
  const X = (i: number) => x0 + ((x1 - x0) * (i - iLo)) / Math.max(1e-9, iHi - iLo);
  const Y = (y: number) => y1 - ((y - lo) / Math.max(1e-9, hi - lo)) * (y1 - y0);
  c.save();
  c.beginPath(); c.rect(x0 - 2, y0 - 10, x1 - x0 + 4, y1 - y0 + 20); c.clip();
  const zt = niceTicks(lo, hi, 4), zstep = zt.length > 1 ? zt[1] - zt[0] : 1;
  zt.forEach((gv) => { c.fillStyle = 'rgba(255,255,255,0.07)'; c.fillRect(x0, Y(gv), x1 - x0, 1); });
  if (lo < 0 && hi > 0) { c.fillStyle = 'rgba(255,255,255,0.3)'; c.fillRect(x0, Y(0), x1 - x0, 1); }
  const dk = ease(sub(e.p, 0.06, 0.42));
  const upto = Math.max(1, Math.floor(dk * (n - 1)));
  const grad = c.createLinearGradient(0, y0, 0, y1);
  grad.addColorStop(0, `rgba(${e.accent},0.3)`); grad.addColorStop(1, `rgba(${e.accent},0)`);
  c.beginPath(); c.moveTo(X(0), y1);
  for (let i = 0; i <= upto; i++) c.lineTo(X(i), Y(z.points[i].y));
  c.lineTo(X(upto), y1); c.closePath(); c.fillStyle = grad; c.fill();
  c.beginPath(); c.moveTo(X(0), Y(z.points[0].y));
  for (let i = 1; i <= upto; i++) c.lineTo(X(i), Y(z.points[i].y));
  c.strokeStyle = `rgb(${e.accent})`; c.lineWidth = zk > 0.5 ? 3.5 : 2.6; c.lineJoin = 'round'; c.shadowColor = `rgba(${e.accent},0.7)`; c.shadowBlur = 8; c.stroke(); c.shadowBlur = 0;
  c.restore();
  zt.forEach((gv) => text(c, `${tickText(gv, zstep)}${z.yUnit}`, x0 - 6, Y(gv) + 4, 10, WHITE, { align: 'right', alpha: 0.5 }));
  // ズーム前：範囲の点線枠
  const bk = sub(e.p, 0.35, 0.45) * (1 - sub(e.p, 0.5, 0.58));
  if (bk > 0) {
    const bx = X(zf) - 4, bw = X(n - 1) - X(zf) + 8;
    const zy = ysZoom; const by = Y(Math.max(...zy)) - 12, bh = Y(Math.min(...zy)) - by + 24;
    c.save(); c.globalAlpha *= bk; c.setLineDash([5, 4]); c.strokeStyle = `rgb(${AMBER})`; c.lineWidth = 1.8; c.strokeRect(bx, by, bw, bh); c.restore();
    text(c, z.zoomTitle, Math.min(e.W - 8, bx + bw), by - 6, 11, AMBER, { align: 'right', bold: true, alpha: bk });
  }
  // 横軸：ズーム前は年初・年末付近の日付、ズーム後は各日の日付
  if (zk < 0.5) {
    [0, Math.floor((n - 1) / 2), n - 1].forEach((i) => text(c, z.points[i].label, X(i), y1 + 16, 10, WHITE, { align: 'center', alpha: 0.6 * (1 - zk * 2) }));
  }
  const lk = ease(sub(e.p, 0.7, 0.85));
  if (lk > 0) {
    z.zoomDays.forEach((d, j) => {
      const i = zf + j;
      if (i > n - 1) return;
      const px = X(i), py = Y(z.points[i].y);
      const rgb = d.dayPct > 0 ? TEAL : d.dayPct < 0 ? RUST : WHITE;
      c.save(); c.globalAlpha *= lk;
      c.beginPath(); c.arc(px, py, 4.5, 0, Math.PI * 2); c.fillStyle = '#fff'; c.fill();
      const lbl = `${d.dayPct > 0 ? '+' : ''}${d.dayPct.toFixed(1)}%`;
      font(c, 11, true); const w = c.measureText(lbl).width + 10;
      const by = Math.max(y0 - 8, Math.min(y1 - 18, j % 2 === 0 ? py - 26 : py + 10));
      const bx = Math.min(e.W - w - 4, Math.max(4, px - w / 2));
      rr(c, bx, by, w, 17, 8); c.fillStyle = `rgba(${rgb},0.9)`; c.fill();
      text(c, lbl, bx + w / 2, by + 12.5, 11, INK, { bold: true, align: 'center' });
      text(c, d.label, px, y1 + 16, 10, WHITE, { align: 'center', alpha: 0.75 });
      c.restore();
    });
  }
  sourceNote(c, e, v.source);
};

const drawButterfly: Draw = (c, sc, e) => {
  const v = sc.visual, b = v.butterfly;
  const top = heading(c, e, v.heading, v.subheading, e.accent);
  if (!b || !b.rows.length) { sourceNote(c, e, v.source); return; }
  const cx = e.W / 2, labelW = e.portrait ? 0 : 0;
  const maxV = Math.max(1, ...b.rows.map((r) => Math.max(r.left, r.right)));
  const half = e.W / 2 - 70 - labelW;
  text(c, b.leftLabel, cx - 10, top + 6, 13, RUST, { align: 'right', bold: true });
  text(c, b.rightLabel, cx + 10, top + 6, 13, TEAL, { bold: true });
  const noteH = b.note ? (b.note.includes('\n') ? 36 : 22) : 0;
  const areaTop = top + 18, rowH = Math.min(e.portrait ? 70 : 74, (e.H - areaTop - 12 - noteH) / b.rows.length);
  c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(cx - 0.5, areaTop, 1, rowH * b.rows.length);
  b.rows.forEach((r, i) => {
    const y = areaTop + i * rowH;
    const k = ease(sub(e.p, 0.1 + i * 0.12, 0.4 + i * 0.12));
    const em = !!r.emphasis;
    text(c, r.label, cx, y + 14, 12, em ? e.accent : WHITE, { align: 'center', bold: true, alpha: em ? 1 : 0.85 });
    const bh = Math.min(22, rowH * 0.32), by = y + 22;
    const lw = (r.left / maxV) * half * k, rw = (r.right / maxV) * half * k;
    rr(c, cx - 4 - lw, by, lw, bh, 5); c.fillStyle = `rgba(${RUST},${em ? 0.95 : 0.6})`; c.fill();
    rr(c, cx + 4, by, rw, bh, 5); c.fillStyle = `rgba(${TEAL},${em ? 0.95 : 0.6})`; c.fill();
    if (k > 0.9) {
      text(c, `${fmtNum(r.left, Number.isInteger(r.left) ? 0 : 1)}日`, cx - 10 - lw, by + bh - 6, 13, WHITE, { align: 'right', bold: true });
      text(c, `${fmtNum(r.right, Number.isInteger(r.right) ? 0 : 1)}日`, cx + 10 + rw, by + bh - 6, 13, WHITE, { bold: true });
      text(c, r.leftSub, cx - 10, by + bh + 14, 10, RUST, { align: 'right', alpha: 0.9 });
      text(c, r.rightSub, cx + 10, by + bh + 14, 10, TEAL, { alpha: 0.9 });
    }
  });
  if (b.note) textBlock(c, b.note, 8, e.H - noteH - (e.showSource ? 8 : 0), e.W - 16, 11, WHITE, { alpha: 0.75 * ease(sub(e.p, 0.5, 0.7)), maxLines: 2, lh: 1.4 });
  sourceNote(c, e, v.source);
};

const drawDdHistory: Draw = (c, sc, e) => {
  const v = sc.visual, h = v.ddHistory;
  const top = heading(c, e, v.heading, v.subheading, e.accent);
  if (!h || h.points.length < 2) { sourceNote(c, e, v.source); return; }
  const bandH = (e.portrait ? 3 : 3) * 18 + 6; // 暴落ラベルを並べる帯
  const x0 = 44, x1 = e.W - 12, y0 = top + 8, yAxis = e.H - (e.showSource ? 30 : 18), y1 = yAxis - bandH;
  const xLo = h.points[0].x, xHi = h.points[h.points.length - 1].x;
  const lo = Math.min(...h.points.map((p) => p.y), ...h.hLines.map((l) => l.y)) * 1.12, hi = 2;
  const X = (x: number) => x0 + ((x1 - x0) * (x - xLo)) / Math.max(1e-9, xHi - xLo);
  const Y = (y: number) => y0 + ((hi - y) / (hi - lo)) * (y1 - y0);
  c.save();
  [...(h.highlights ?? []), ...(h.highlight ? [h.highlight] : [])].forEach((hl, hi2) => {
    const hk = ease(sub(e.p, 0.72 + hi2 * 0.06, 0.88 + hi2 * 0.06));
    if (hk <= 0) return;
    c.fillStyle = `rgba(${AMBER},${0.12 * hk})`; c.fillRect(X(hl.from), y0, X(hl.to) - X(hl.from), y1 - y0);
  });
  h.hLines.forEach((l) => {
    c.save(); c.setLineDash([5, 5]); c.strokeStyle = 'rgba(255,255,255,0.3)'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(x0, Y(l.y)); c.lineTo(x1, Y(l.y)); c.stroke(); c.restore();
    text(c, `${l.y}%`, x0 - 5, Y(l.y) + 4, 10, WHITE, { align: 'right', alpha: 0.55 });
  });
  c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(x0, Y(0), x1 - x0, 1);
  text(c, '0%', x0 - 5, Y(0) + 4, 10, WHITE, { align: 'right', alpha: 0.55 });
  const k = ease(sub(e.p, 0.06, 0.7));
  const xCut = xLo + (xHi - xLo) * k;
  const vis = h.points.filter((p) => p.x <= xCut);
  if (vis.length > 1) {
    const grad = c.createLinearGradient(0, Y(0), 0, y1);
    grad.addColorStop(0, `rgba(${RUST},0.15)`); grad.addColorStop(1, `rgba(${RUST},0.6)`);
    c.beginPath(); c.moveTo(X(vis[0].x), Y(0));
    vis.forEach((p) => c.lineTo(X(p.x), Y(p.y)));
    c.lineTo(X(vis[vis.length - 1].x), Y(0)); c.closePath(); c.fillStyle = grad; c.fill();
    c.beginPath(); c.moveTo(X(vis[0].x), Y(vis[0].y));
    vis.forEach((p) => c.lineTo(X(p.x), Y(p.y)));
    c.strokeStyle = `rgb(${RUST})`; c.lineWidth = 1.4; c.stroke();
  }
  const decades = [];
  for (let yr = Math.ceil(xLo / 10) * 10; yr <= xHi; yr += 10) decades.push(yr);
  h.hLines.forEach((l) => pill(c, l.label, x1 - 2, Y(l.y) - 3, WHITE, 'right'));
  decades.forEach((yr) => text(c, `${yr}`, X(yr), yAxis + 13, 10, WHITE, { align: 'center', alpha: 0.6 }));
  // 暴落ラベル：グラフの下の帯に、横に重ならない段へ順に置く（谷から引き出し線を下ろす）
  const rowsUsed: [number, number][][] = [[], [], []];
  font(c, 10, true);
  // 縦長では幅が足りないので「1987年 ブラックマンデー −34%」→「1987年 −34%」に縮める
  const shortLabel = (s2: string) => { const parts = s2.split(' '); return parts.length >= 3 ? `${parts[0]} ${parts[parts.length - 1]}` : s2; };
  const placed = h.labels.map((l0) => {
    const l = { ...l0, label: e.portrait ? shortLabel(l0.label) : l0.label };
    const w = c.measureText(l.label).width + 10;
    const px = X(l.x);
    const bx = Math.min(e.W - w - 4, Math.max(4, px - w / 2));
    const row = rowsUsed.findIndex((r) => r.every(([a, b]) => bx + w + 4 < a || bx > b + 4));
    if (row >= 0) rowsUsed[row].push([bx, bx + w]);
    return { l, w, bx, row };
  }).filter((x) => x.row >= 0); // 置き場所が無いラベルは重ねずに省く（深い順に優先されている）
  placed.forEach(({ l, w, bx, row }) => {
    if (l.x > xCut) return;
    const lk = ease(sub(e.p, 0.1 + (0.6 * (l.x - xLo)) / Math.max(1e-9, xHi - xLo), 0.2 + (0.6 * (l.x - xLo)) / Math.max(1e-9, xHi - xLo)));
    const px = X(l.x), py = Y(l.y);
    const by = y1 + 6 + row * 18;
    c.save(); c.globalAlpha *= lk;
    c.strokeStyle = 'rgba(255,255,255,0.45)'; c.lineWidth = 1; c.beginPath(); c.moveTo(px, py); c.lineTo(px, by); c.stroke();
    c.beginPath(); c.arc(px, py, 3, 0, Math.PI * 2); c.fillStyle = '#fff'; c.fill();
    rr(c, bx, by, w, 16, 8); c.fillStyle = 'rgba(6,10,19,0.9)'; c.fill(); c.strokeStyle = `rgba(${RUST},0.8)`; c.stroke();
    text(c, l.label, bx + w / 2, by + 12, 10, WHITE, { bold: true, align: 'center' });
    c.restore();
  });
  // 長い回復期間の札は、DDの線の上に重ねて読めるように最後に描く
  [...(h.highlights ?? []), ...(h.highlight ? [h.highlight] : [])].forEach((hl, hi2) => {
    const hk = ease(sub(e.p, 0.72 + hi2 * 0.06, 0.88 + hi2 * 0.06));
    if (hk <= 0) return;
    c.save(); c.globalAlpha *= hk;
    const pw = pillW(c, hl.label);
    pill(c, hl.label, Math.min(x1 - pw - 2, Math.max(x0 + 2, (X(hl.from) + X(hl.to)) / 2 - pw / 2)), Y(0) + 22 + (hi2 % 2) * 16, AMBER, 'left');
    c.restore();
  });
  c.restore();
  sourceNote(c, e, v.source);
};

const DRAWERS: Record<string, Draw> = {
  title: drawTitle, chapter: drawChapter, keyword: drawKeyword, points: drawPoints, number: drawNumber,
  bar: drawBar, line: drawLine, donut: drawDonut, timeline: drawTimeline, flow: drawFlow, compare: drawCompare,
  cycle: drawCycle, illustration: drawIllustration, image: drawImage, point: drawPoint, qa: drawQa,
  summary: drawSummary, cta: drawCta, sources: drawSources,
  yearCompare: drawOverlay, // [Stage E-9]
  branch: drawBranch, histogram: drawHistogram, distribution: drawDistribution, // [Stage E-10]
  groupedBar: drawGroupedBar, // [Stage E-13]
  fan: drawFan, zoomLine: drawZoomLine, butterfly: drawButterfly, ddHistory: drawDdHistory, // [Stage E-16]
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
