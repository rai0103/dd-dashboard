// 解説動画の画面全体の描画（長尺16:9・ショート9:16）。
// 長尺は長尺動画作成（DD戦略ダッシュボード）と同じ配置：左に図解、右の縦長の領域に背景画像＋アバター（MP4）。
// ショートは上に図解、下に背景画像＋アバター、その間に大きな字幕。
// API（setDurations・getSceneIndexAt・draw(progress)など）は LongAnalysisRenderer と同じ形にしてあり、
// 再生・書き出しの仕組み（AudioMixer・VideoExporter）をそのまま使える。
import type { VideoAvatar } from '../videoAvatarRender';
import { drawVisual, text, textBlock, wrap, font, rr, clamp01, ease, sub, PALETTE, WHITE, INK } from './visuals';
import { drawIcon } from './icons';
import type { ExplainerScene, IconName } from './types';

export type ExplainerFormat = 'long' | 'short';

export interface ExplainerRenderConfig {
  format: ExplainerFormat;
  scenes: ExplainerScene[];
  videoTitle: string;
  kicker: string;
  chapterTitles: string[];
  avatar: VideoAvatar | null;
  backgroundImage?: HTMLImageElement | null;
  backgroundOpacity: number; // 0〜1
  images?: Record<string, HTMLImageElement>;
  showSubtitles: boolean;
}

const LONG = { W: 960, H: 540, colX: 672 };
const SHORT = { W: 540, H: 960 };
// 図解の仮想サイズと、画面上の枠
const LONG_VIS = { W: 640, H: 400, x: 16, y: 58, w: 646, h: 404 };
const SHORT_VIS = { W: 420, H: 361, x: 20, y: 150, w: 500, h: 430 };

/** 字幕：ナレーションを句点で区切り、文字数の割合で表示時間を割り当てる */
export function subtitleAt(narration: string, localT: number, narrDur: number, maxChars: number): string {
  if (!narration) return '';
  const parts = narration.split(/(?<=[。！？!?])/).map((s) => s.trim()).filter(Boolean);
  // 長い文は読点で分ける
  const chunks: string[] = [];
  for (const p of parts) {
    if (p.length <= maxChars) { chunks.push(p); continue; }
    let cur = '';
    for (const seg of p.split(/(?<=、)/)) {
      if ((cur + seg).length > maxChars && cur) { chunks.push(cur); cur = seg; } else cur += seg;
    }
    if (cur) chunks.push(cur);
  }
  if (!chunks.length) return '';
  const total = chunks.reduce((a, b) => a + b.length, 0);
  const dur = narrDur > 0 ? narrDur : 0;
  if (dur <= 0) return chunks[0];
  const pos = clamp01((localT - 0.3) / dur) * total;
  let acc = 0;
  for (const ch of chunks) { acc += ch.length; if (pos < acc) return ch; }
  return chunks[chunks.length - 1];
}

export class ExplainerRenderer {
  private ctx: CanvasRenderingContext2D;
  private cfg: ExplainerRenderConfig;
  private k: number;
  private durs: number[];
  private narrDurs: number[] = [];
  private off: HTMLCanvasElement;
  private offCtx: CanvasRenderingContext2D;
  private LW: number;
  private LH: number;

  constructor(canvas: HTMLCanvasElement, cfg: ExplainerRenderConfig) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvasを初期化できません');
    this.ctx = ctx;
    this.cfg = cfg;
    this.LW = cfg.format === 'long' ? LONG.W : SHORT.W;
    this.LH = cfg.format === 'long' ? LONG.H : SHORT.H;
    this.k = canvas.width / this.LW;
    this.durs = cfg.scenes.map((s) => s.minSec || 5);
    // 図解は別のCanvasに仮想サイズで描いてから貼る（場面の切り替え効果をまとめてかけるため）
    const vis = this.vis();
    this.off = document.createElement('canvas');
    this.off.width = Math.round(vis.w * this.k);
    this.off.height = Math.round(vis.h * this.k);
    this.offCtx = this.off.getContext('2d')!;
  }

  private vis() { return this.cfg.format === 'long' ? LONG_VIS : SHORT_VIS; }

  setDurations(d: number[]): void { if (d.length === this.cfg.scenes.length) this.durs = d.slice(); }
  /** 各場面のナレーション音声の長さ（秒）。字幕の切り替えに使う */
  setNarration(bufs: (AudioBuffer | null)[]): void { this.narrDurs = bufs.map((b) => (b ? b.duration : 0)); }
  setNarrationDurations(d: number[]): void { this.narrDurs = d.slice(); }
  get totalSeconds(): number { return this.durs.reduce((a, b) => a + b, 0); }

  private locate(progress: number) {
    const gt = clamp01(progress) * this.totalSeconds;
    let t = gt, i = 0;
    while (i < this.durs.length - 1 && t >= this.durs[i]) { t -= this.durs[i]; i++; }
    return { i, t, gt };
  }
  getSceneIndexAt(progress: number): number { return this.locate(progress).i; }
  getSceneLocalTimeAt(progress: number): number { return this.locate(progress).t; }

  async prepare(progress: number): Promise<void> {
    const av = this.cfg.avatar;
    if (av) { av.ensureSchedule(this.totalSeconds); await av.prepare(clamp01(progress) * this.totalSeconds); }
  }
  pauseAvatar(): void { this.cfg.avatar?.pauseAll(); }

  // ---------- 背景 ----------
  private drawBackdrop(gt: number, chapter: number) {
    const c = this.ctx, W = this.LW, H = this.LH;
    const g = c.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#070c18'); g.addColorStop(1, '#0d1830');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    // ゆっくり動く色のにじみ（章ごとに色味を変える）
    const base = PALETTE[chapter % PALETTE.length], second = PALETTE[(chapter + 2) % PALETTE.length];
    const blobs = [
      { x: 0.2 + 0.08 * Math.sin(gt * 0.13), y: 0.3 + 0.1 * Math.cos(gt * 0.11), r: 0.55, rgb: base, a: 0.13 },
      { x: 0.55 + 0.1 * Math.cos(gt * 0.09), y: 0.8 + 0.08 * Math.sin(gt * 0.12), r: 0.5, rgb: second, a: 0.1 },
    ];
    for (const b of blobs) {
      const rg = c.createRadialGradient(b.x * W, b.y * H, 0, b.x * W, b.y * H, b.r * Math.max(W, H));
      rg.addColorStop(0, `rgba(${b.rgb},${b.a})`); rg.addColorStop(1, `rgba(${b.rgb},0)`);
      c.fillStyle = rg; c.fillRect(0, 0, W, H);
    }
    // 細かい格子（ゆっくり流れる）
    c.save();
    c.strokeStyle = 'rgba(255,255,255,0.035)'; c.lineWidth = 1;
    const step = 32, off = (gt * 6) % step;
    c.beginPath();
    for (let x = -step + off; x < W; x += step) { c.moveTo(x, 0); c.lineTo(x, H); }
    for (let y = -step + off; y < H; y += step) { c.moveTo(0, y); c.lineTo(W, y); }
    c.stroke();
    c.restore();
  }

  /** アバターの後ろの背景画像（長尺は右の縦長の領域、ショートは下半分） */
  private drawPersonArea(x: number, y: number, w: number, h: number, gt: number) {
    const c = this.ctx, img = this.cfg.backgroundImage;
    c.save();
    c.beginPath(); c.rect(x, y, w, h); c.clip();
    if (img && img.complete && img.naturalWidth > 0) {
      const s = Math.max(w / img.naturalWidth, h / img.naturalHeight) * 1.04;
      const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
      c.globalAlpha = clamp01(this.cfg.backgroundOpacity);
      c.drawImage(img, x + (w - dw) / 2 + Math.sin(gt * 0.05) * w * 0.015, y + (h - dh) / 2, dw, dh);
      c.globalAlpha = 1;
    } else {
      const g = c.createLinearGradient(x, y, x + w, y + h);
      g.addColorStop(0, '#0a1630'); g.addColorStop(1, '#14305a');
      c.fillStyle = g; c.fillRect(x, y, w, h);
    }
    c.restore();
    if (this.cfg.avatar) {
      this.cfg.avatar.ensureSchedule(this.totalSeconds);
      c.save();
      this.cfg.avatar.draw(c, x, y, w, h, gt);
      c.restore();
    }
  }

  // ---------- 共通の部品 ----------
  private titleBar(sc: ExplainerScene, chapterIdx: number) {
    const c = this.ctx;
    const long = this.cfg.format === 'long';
    const W = long ? LONG.colX : this.LW;
    if (long) {
      c.fillStyle = 'rgba(5,9,20,0.75)'; c.fillRect(0, 0, W, 46);
      const accent = PALETTE[chapterIdx % PALETTE.length];
      c.fillStyle = `rgb(${accent})`; c.fillRect(0, 44, W, 2);
      font(c, 12, true);
      const kick = this.cfg.kicker || '解説';
      const kw = c.measureText(kick).width + 18;
      rr(c, 14, 12, kw, 22, 11); c.fillStyle = `rgb(${accent})`; c.fill();
      text(c, kick, 14 + kw / 2, 27, 12, INK, { bold: true, align: 'center' });
      const ch = this.cfg.chapterTitles[chapterIdx] || '';
      font(c, 13);
      const chW = ch ? Math.min(220, c.measureText(ch).width + 10) : 0;
      text(c, this.cfg.videoTitle, 24 + kw, 29, 17, WHITE, { bold: true, maxW: W - kw - 50 - chW });
      if (ch) text(c, ch, W - 14, 29, 13, WHITE, { align: 'right', alpha: 0.6, maxW: 220 });
    } else {
      c.fillStyle = 'rgba(5,9,20,0.6)'; c.fillRect(0, 0, W, 140);
      const accent = PALETTE[chapterIdx % PALETTE.length];
      const kick = this.cfg.kicker || '解説';
      font(c, 18, true);
      const kw = c.measureText(kick).width + 24;
      rr(c, 20, 20, kw, 32, 16); c.fillStyle = `rgb(${accent})`; c.fill();
      text(c, kick, 20 + kw / 2, 42, 18, INK, { bold: true, align: 'center' });
      textBlock(c, this.cfg.videoTitle, 20, 88, W - 40, 30, WHITE, { bold: true, maxLines: 2, lh: 1.2, shadow: true });
    }
  }

  /** 目次バー（どの章まで進んだか）。長尺の下端に表示 */
  private chapterBar(gt: number) {
    const c = this.ctx;
    const long = this.cfg.format === 'long';
    const W = long ? LONG.colX : this.LW, y = this.LH - (long ? 8 : 10), h = long ? 4 : 6;
    const total = this.totalSeconds || 1;
    // 章ごとの区間
    const spans: { ch: number; start: number; end: number }[] = [];
    let acc = 0;
    this.cfg.scenes.forEach((s, i) => {
      const d = this.durs[i] || 0;
      const last = spans[spans.length - 1];
      if (last && last.ch === s.chapter) last.end = acc + d; else spans.push({ ch: s.chapter, start: acc, end: acc + d });
      acc += d;
    });
    spans.forEach((sp) => {
      const x0 = (sp.start / total) * W + 1, x1 = (sp.end / total) * W - 1;
      c.fillStyle = 'rgba(255,255,255,0.15)'; c.fillRect(x0, y, Math.max(0, x1 - x0), h);
      const fillTo = Math.min(x1, (gt / total) * W);
      if (fillTo > x0) { c.fillStyle = `rgb(${PALETTE[sp.ch % PALETTE.length]})`; c.fillRect(x0, y, fillTo - x0, h); }
    });
  }

  private subtitle(sc: ExplainerScene, i: number, t: number, fade: number) {
    const c = this.ctx;
    const long = this.cfg.format === 'long';
    const W = long ? LONG.colX : this.LW;
    const line = this.cfg.showSubtitles ? subtitleAt(sc.narration, t, this.narrDurs[i] || 0, long ? 34 : 30) : sc.caption;
    if (!line || sc.visual.kind === 'chapter') return;
    const size = long ? 19 : 28;
    const lines = wrap(c, line, W - (long ? 60 : 50), size, true).slice(0, 2);
    const lh = size * 1.32;
    const bh = lines.length * lh + (long ? 14 : 22);
    const by = long ? this.LH - 18 - bh : 600;
    c.save();
    c.globalAlpha *= fade;
    rr(c, long ? 16 : 14, by, W - (long ? 32 : 28), bh, 10);
    c.fillStyle = 'rgba(4,8,18,0.78)'; c.fill();
    lines.forEach((ln, k) => {
      font(c, size, true);
      c.textAlign = 'center'; c.textBaseline = 'alphabetic';
      c.lineWidth = long ? 4 : 6; c.strokeStyle = 'rgba(0,0,0,0.85)'; c.lineJoin = 'round';
      const y = by + (long ? 8 : 12) + size + k * lh - 2;
      c.strokeText(ln, W / 2, y);
      c.fillStyle = '#fff'; c.fillText(ln, W / 2, y);
    });
    c.restore();
  }

  draw(progress: number): void {
    const c = this.ctx;
    c.setTransform(this.k, 0, 0, this.k, 0, 0);
    c.globalAlpha = 1;
    const { i, t, gt } = this.locate(progress);
    const sc = this.cfg.scenes[i];
    if (!sc) { c.fillStyle = '#000'; c.fillRect(0, 0, this.LW, this.LH); return; }
    const dur = this.durs[i] || 1;
    const p = clamp01(t / dur);
    const last = i === this.durs.length - 1;
    const fadeIn = clamp01(t / 0.35), fadeOut = last ? 1 : clamp01((dur - t) / 0.3);
    const accent = PALETTE[(sc.chapter + (sc.visual.kind === 'chapter' ? 0 : 0)) % PALETTE.length];

    this.drawBackdrop(gt, sc.chapter);
    const long = this.cfg.format === 'long';
    if (long) this.drawPersonArea(LONG.colX, 0, LONG.W - LONG.colX, LONG.H, gt);
    else this.drawPersonArea(0, 560, SHORT.W, SHORT.H - 560, gt);

    // 図解（場面ごとに入り方を変える：右から・下から・拡大）
    const vis = this.vis();
    const oc = this.offCtx;
    oc.setTransform(1, 0, 0, 1, 0, 0);
    oc.clearRect(0, 0, this.off.width, this.off.height);
    oc.setTransform((this.k * vis.w) / vis.W, 0, 0, (this.k * vis.h) / vis.H, 0, 0);
    drawVisual(oc, sc, { W: vis.W, H: vis.H, p, t, portrait: !long, image: sc.imageId ? this.cfg.images?.[sc.imageId] ?? null : null, accent });
    const mode = i % 3;
    const ein = ease(fadeIn);
    c.save();
    c.globalAlpha = Math.min(ein, fadeOut);
    let dx = 0, dy = 0, s = 1;
    if (mode === 0) dx = (1 - ein) * 40; else if (mode === 1) dy = (1 - ein) * 30; else s = 0.94 + 0.06 * ein;
    const cx = vis.x + vis.w / 2, cy = vis.y + vis.h / 2;
    c.translate(cx + dx, cy + dy); c.scale(s, s); c.translate(-cx, -cy);
    c.drawImage(this.off, vis.x, vis.y, vis.w, vis.h);
    c.restore();

    this.titleBar(sc, sc.chapter);
    this.subtitle(sc, i, t, Math.min(fadeIn, fadeOut));
    this.chapterBar(gt);
    c.globalAlpha = 1;
  }

  /** サムネイル用の1枚（長尺）。大きな文字＋アイコン＋人物 */
  async drawThumbnail(textMain: string, icon: IconName, atProgress: number): Promise<void> {
    await this.prepare(atProgress);
    const c = this.ctx;
    c.setTransform(this.k, 0, 0, this.k, 0, 0);
    const gt = clamp01(atProgress) * this.totalSeconds;
    const long = this.cfg.format === 'long';
    this.drawBackdrop(gt, 0);
    const W = this.LW, H = this.LH;
    const accent = PALETTE[1];
    if (long) this.drawPersonArea(LONG.colX - 40, 0, LONG.W - LONG.colX + 40, LONG.H, gt);
    else this.drawPersonArea(0, 560, W, H - 560, gt);
    const areaW = long ? LONG.colX - 30 : W - 40;
    // 大きな文字（黄色＋太いふち）
    const msg = textMain || this.cfg.videoTitle;
    let size = long ? 84 : 76, lines = wrap(c, msg, areaW - 40, size, true);
    while ((lines.length > 3 || lines.some((l) => { font(c, size, true); return c.measureText(l).width > areaW - 40; })) && size > 30) { size -= 4; lines = wrap(c, msg, areaW - 40, size, true); }
    const lh = size * 1.12, y0 = long ? H / 2 - ((lines.length - 1) * lh) / 2 + size * 0.35 : 330;
    lines.forEach((ln, k) => {
      font(c, size, true); c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.lineJoin = 'round';
      c.lineWidth = size * 0.2; c.strokeStyle = '#05080f'; c.strokeText(ln, 30, y0 + k * lh);
      c.fillStyle = k === 0 ? `rgb(${PALETTE[5]})` : '#ffffff'; c.fillText(ln, 30, y0 + k * lh);
    });
    font(c, 22, true);
    const kick = this.cfg.kicker || '解説';
    const kw = c.measureText(kick).width + 30;
    rr(c, 30, long ? 34 : 180, kw, 40, 20); c.fillStyle = `rgb(${PALETTE[3]})`; c.fill();
    text(c, kick, 30 + kw / 2, long ? 62 : 208, 22, WHITE, { bold: true, align: 'center' });
    drawIcon(c, icon, long ? areaW - 70 : W - 90, long ? H - 100 : 470, long ? 120 : 110, accent, 0);
  }
}

export const RENDER_SIZE = { long: { w: 1920, h: 1080 }, short: { w: 1080, h: 1920 } } as const;
export { sub, ease };
