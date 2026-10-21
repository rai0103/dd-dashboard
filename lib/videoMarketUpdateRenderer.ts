// [dd-dashboard移植版] investment-shorts (lib/marketUpdateRenderer.ts) を無改変で移植（import先のみvideo*プレフィックスに変更）。
// S&P500の近況動画の描画。シーンごとに動くチャートで見せる（評価額は表示せず、%・日数・回数のみ）
import { UpdateStats, UpdateScene, fmtPct, crashList } from './videoMarketUpdate';
import { DISCLAIMERS } from './videoDisclaimer';

export interface MarketUpdateConfig {
  stats: UpdateStats;
  scenes: UpdateScene[];
  backgroundPattern: 'none' | 'image';
  backgroundOpacity: number;
  backgroundImage?: HTMLImageElement | null;
  label?: string; // 既定は「近況まとめ」
  fontScale?: number; // 横長用：文字を大きくする倍率
}

const FONT = '"Segoe UI", "Yu Gothic", "Meiryo", sans-serif';
const UP = '255, 107, 107';
const DOWN = '90, 169, 255';
const GREEN = '46, 230, 184';
const WHITE = '255, 255, 255';
const AMBER = '255, 190, 80';

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const sub = (p: number, a: number, b: number) => clamp01((p - a) / (b - a));
const ease = (x: number) => 1 - Math.pow(1 - x, 3);
const rgbOf = (v: number) => (v >= 0 ? UP : DOWN);

export class MarketUpdateRenderer {
  private ctx: CanvasRenderingContext2D;
  private W: number;
  private H: number;
  private durs: number[];

  constructor(canvas: HTMLCanvasElement, private cfg: MarketUpdateConfig) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get canvas context');
    this.ctx = ctx;
    this.W = canvas.width;
    this.H = canvas.height;
    this.durs = cfg.scenes.map(s => s.minSec);
  }

  setDurations(d: number[]): void {
    if (d.length === this.cfg.scenes.length) this.durs = d.slice();
  }
  get totalSeconds(): number { return this.durs.reduce((a, b) => a + b, 0); }
  getDurations(): number[] { return this.durs.slice(); }
  /** サムネイルの既定位置：オープニングの文字がすべて表示された画面 */
  thumbProgress(): number { return (this.durs[0] * 0.9) / Math.max(1e-6, this.totalSeconds); }

  draw(progress: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.W, this.H);
    this.drawBackground();
    let t = clamp01(progress) * this.totalSeconds;
    let i = 0;
    while (i < this.durs.length - 1 && t >= this.durs[i]) { t -= this.durs[i]; i++; }
    const dur = this.durs[i];
    const p = clamp01(t / dur);
    const last = i === this.durs.length - 1;
    const fadeIn = clamp01(t / 0.25);
    const fadeOut = last ? 1 : clamp01((dur - t) / 0.25);
    ctx.save();
    ctx.globalAlpha = Math.min(fadeIn, fadeOut);
    ctx.textBaseline = 'alphabetic';
    this.scene(this.cfg.scenes[i].id, p);
    ctx.restore();
  }

  /** 長尺用：背景なし（透明）で1つのシーンだけを描く */
  renderScene(id: UpdateScene['id'], p: number): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.W, this.H);
    ctx.textBaseline = 'alphabetic';
    this.scene(id, p);
  }

  private scene(id: UpdateScene['id'], p: number): void {
    switch (id) {
      case 'open': return this.sOpen(p);
      case 'ytd': return this.sYtd(p);
      case 'ytdvs': return this.sYtdVs(p);
      case 'ath': return this.sAth(p);
      case 'athcount': return this.sAthCount(p);
      case 'updown': return this.sUpDown(p);
      case 'outlook': return this.sOutlook(p);
      case 'crash': return this.sCrash(p);
      case 'end': return this.sEnd(p);
    }
  }

  // ---------- 共通部品 ----------

  private drawBackground(): void {
    const { backgroundPattern, backgroundOpacity, backgroundImage: img } = this.cfg;
    if (backgroundPattern !== 'image' || !img || !img.complete || img.naturalWidth <= 0) return;
    const sc = Math.max(this.W / img.naturalWidth, this.H / img.naturalHeight);
    const dw = img.naturalWidth * sc, dh = img.naturalHeight * sc;
    this.ctx.save();
    this.ctx.globalAlpha = clamp01(backgroundOpacity / 100);
    this.ctx.drawImage(img, (this.W - dw) / 2, (this.H - dh) / 2, dw, dh);
    this.ctx.restore();
  }

  private font(size: number, bold = false): void { this.ctx.font = `${bold ? 'bold ' : ''}${size * (this.cfg.fontScale ?? 1)}px ${FONT}`; }

  private fit(text: string, base: number, maxW: number, bold = true, min = 8): void {
    let s = base;
    this.font(s, bold);
    while (s > min && this.ctx.measureText(text).width > maxW) { s -= 1; this.font(s, bold); }
  }

  private text(t: string, x: number, y: number, size: number, color: string, opts: { bold?: boolean; align?: CanvasTextAlign; maxW?: number; alpha?: number } = {}): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.textAlign = opts.align ?? 'left';
    if (opts.maxW) this.fit(t, size, opts.maxW, opts.bold ?? false); else this.font(size, opts.bold ?? false);
    ctx.fillStyle = `rgba(${color}, ${opts.alpha ?? 1})`;
    ctx.fillText(t, x, y);
    ctx.restore();
  }

  private header(title: string, subtitle?: string): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.7)';
    ctx.shadowBlur = 4;
    this.text(title, 12, 34, 20, WHITE, { bold: true, maxW: this.W - 24 });
    if (subtitle) this.text(subtitle, 12, 52, 10, WHITE, { alpha: 0.65, maxW: this.W - 24 });
    ctx.restore();
  }

  private line(pts: [number, number][], rgb: string, width: number, alpha = 1, glow = false): void {
    if (pts.length < 2) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.strokeStyle = `rgba(${rgb}, ${alpha})`;
    ctx.lineWidth = width;
    if (glow) { ctx.shadowColor = `rgba(${rgb}, 0.5)`; ctx.shadowBlur = 6; }
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
    ctx.restore();
  }

  private panel(L: number, T: number, R: number, B: number): void {
    this.ctx.fillStyle = 'rgba(255,255,255,0.035)';
    this.ctx.fillRect(L, T, R - L, B - T);
  }

  private hGrid(L: number, R: number, T: number, B: number, lo: number, hi: number, step: number, fmt: (v: number) => string, base?: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    this.font(8);
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) {
      const y = B - ((v - lo) / (hi - lo)) * (B - T);
      ctx.strokeStyle = base !== undefined && Math.abs(v - base) < 1e-9 ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.1)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(R, y); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillText(fmt(v), L - 3, y);
    }
    ctx.restore();
  }

  private monthTicks(L: number, R: number, B: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    this.font(8);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    for (let m = 0; m < 12; m++) ctx.fillText(`${m + 1}月`, L + ((m + 0.5) / 12) * (R - L), B + 5);
    ctx.restore();
  }

  private niceRange(lo: number, hi: number, step: number): [number, number] {
    return [Math.floor(lo / step) * step, Math.ceil(hi / step) * step];
  }

  private dateJa(): string { const s = this.cfg.stats; return `${s.year}年${s.month}月${s.day}日`; }

  private asOfNote(): string { return `${this.cfg.stats.asOf.replace(/-/g, '/')} 時点（米国時間）`; }

  // ---------- シーン ----------

  private sOpen(p: number): void {
    const s = this.cfg.stats;
    const ctx = this.ctx;
    // 背景に直近1年の値動きをうっすら描く
    const pts = s.ytdPath;
    const L = 10, R = this.W - 10, T = 300, B = 440;
    const vs = pts.map(q => q.v);
    const lo = Math.min(...vs), hi = Math.max(...vs);
    const k = ease(sub(p, 0.05, 0.9));
    const xy: [number, number][] = pts.filter(q => q.t <= k * pts[pts.length - 1].t).map(q => [L + q.t * (R - L), B - ((q.v - lo) / Math.max(1e-6, hi - lo)) * (B - T)]);
    this.line(xy, GREEN, 2, 0.5, true);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0, 200, 255, 0.5)';
    ctx.shadowBlur = 8;
    const a = ease(sub(p, 0, 0.3));
    this.text(this.dateJa(), this.W / 2, 122, 22, WHITE, { bold: true, align: 'center', alpha: a, maxW: this.W - 20 });
    this.text('S&P500', this.W / 2, 170, 40, WHITE, { bold: true, align: 'center', alpha: a });
    this.text(this.cfg.label ?? '近況まとめ', this.W / 2, 210, 26, GREEN, { bold: true, align: 'center', alpha: a });
    ctx.restore();
    this.text('（米国時間・VOOのデータより）', this.W / 2, 232, 10, WHITE, { align: 'center', alpha: ease(sub(p, 0.15, 0.45)) * 0.7 });
    const tags = ['年初来の騰落率', '最高値（ATH）からの下落', '年末までの過去実績', '調整〜暴落の頻度'];
    tags.forEach((t, i) => this.text(`・${t}`, this.W / 2, 252 + i * 18, 12, WHITE, { align: 'center', alpha: ease(sub(p, 0.3 + i * 0.1, 0.5 + i * 0.1)) * 0.85 }));
  }

  private sYtd(p: number): void {
    const s = this.cfg.stats;
    this.header('年初来の騰落率', `${s.year}年・前年末=100・${this.asOfNote()}`);
    const L = 34, R = (this.W - 12), T = 130, B = 340;
    this.panel(L, T, R, B);
    const vs = s.ytdPath.map(q => q.v);
    const [lo, hi] = this.niceRange(Math.min(...vs, 100) - 1, Math.max(...vs, 100) + 1, 5);
    this.hGrid(L, R, T, B, lo, hi, 5, v => String(v), 100);
    this.monthTicks(L, R, B);
    const tEnd = s.ytdPath[s.ytdPath.length - 1].t;
    const k = ease(sub(p, 0.05, 0.68));
    const tNow = k * tEnd;
    const xy: [number, number][] = [];
    let head = s.ytdPath[0];
    for (let i = 0; i < s.ytdPath.length; i++) {
      const q = s.ytdPath[i];
      if (q.t <= tNow) { xy.push([L + q.t * (R - L), B - ((q.v - lo) / (hi - lo)) * (B - T)]); head = q; }
      else {
        const a = s.ytdPath[i - 1];
        const f = q.t > a.t ? (tNow - a.t) / (q.t - a.t) : 0;
        const v = a.v + (q.v - a.v) * f;
        xy.push([L + tNow * (R - L), B - ((v - lo) / (hi - lo)) * (B - T)]);
        head = { t: tNow, v, date: '' };
        break;
      }
    }
    this.line(xy, GREEN, 2.4, 0.95, true);
    if (xy.length) { const h = xy[xy.length - 1]; this.ctx.fillStyle = `rgba(${GREEN},1)`; this.ctx.beginPath(); this.ctx.arc(h[0], h[1], 3.2, 0, Math.PI * 2); this.ctx.fill(); }
    // 走りながら変わる年初来の数値
    const cur = head.v - 100;
    this.text(fmtPct(cur), 12, 106, 34, rgbOf(cur), { bold: true });
    // 昨日比・直近1年
    const a2 = ease(sub(p, 0.72, 0.85));
    this.text('昨日比', (this.W - 12), 84, 10, WHITE, { align: 'right', alpha: a2 * 0.8 });
    this.text(fmtPct(s.dayChange, 2), (this.W - 12), 100, 15, rgbOf(s.dayChange), { bold: true, align: 'right', alpha: a2 });
    if (s.oneYear !== null) {
      const wide = (this.cfg.fontScale ?? 1) > 1;
      const x1 = wide ? this.W - 12 - 150 : this.W - 12, ya = wide ? 84 : 118, yb = wide ? 100 : 134;
      this.text('直近1年', x1, ya, 10, WHITE, { align: 'right', alpha: a2 * 0.8 });
      this.text(fmtPct(s.oneYear), x1, yb, 15, rgbOf(s.oneYear), { bold: true, align: 'right', alpha: a2 });
    }
    // 直近10営業日の日次騰落率
    const ctx = this.ctx;
    const bT = 372, bB = 448, bL = 34, bR = (this.W - 12);
    this.text('直近10営業日の日次騰落率', 12, 366, 10, WHITE, { alpha: 0.75 * ease(sub(p, 0.45, 0.6)) });
    const mx = Math.max(1, ...s.last10.map(Math.abs));
    const mid = (bT + bB + 10) / 2;
    const bw = (bR - bL) / 10;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.beginPath(); ctx.moveTo(bL, mid); ctx.lineTo(bR, mid); ctx.stroke();
    s.last10.forEach((v, i) => {
      const f = ease(sub(p, 0.5 + i * 0.03, 0.62 + i * 0.03));
      const h = (Math.abs(v) / mx) * ((bB - bT) / 2 - 6) * f;
      ctx.fillStyle = `rgba(${rgbOf(v)}, 0.9)`;
      const x = bL + i * bw + 2;
      if (v >= 0) ctx.fillRect(x, mid - h, bw - 4, h); else ctx.fillRect(x, mid, bw - 4, h);
      ctx.fillStyle = `rgba(${WHITE}, ${0.75 * f})`;
      ctx.textAlign = 'center';
      this.font(7);
      ctx.fillText(v.toFixed(1), x + (bw - 4) / 2, v >= 0 ? mid - h - 2 : mid + h + 8);
    });
    ctx.restore();
  }

  private barPanel(opts: { L: number; R: number; T: number; B: number; values: { label: string; v: number; cur?: boolean }[]; lo: number; hi: number; step: number; p: number; fmt: (v: number) => string; avg?: number; avgLabel?: string; labelEvery?: number; zero?: number }): void {
    const { L, R, T, B, values, lo, hi, step, p, fmt, avg, avgLabel, labelEvery } = opts;
    const ctx = this.ctx;
    this.panel(L, T, R, B);
    this.hGrid(L, R, T, B, lo, hi, step, fmt, opts.zero ?? 0);
    const n = values.length;
    const bw = (R - L) / n;
    const yv = (v: number) => B - ((v - lo) / (hi - lo)) * (B - T);
    const y0 = yv(Math.max(lo, Math.min(hi, opts.zero ?? 0)));
    const regular = n - 1;
    const kAll = ease(sub(p, 0, 0.7)) * regular;
    ctx.save();
    values.forEach((q, i) => {
      let f: number;
      if (q.cur) f = ease(sub(p, 0.72, 0.9)); else f = clamp01(kAll - i);
      if (f <= 0) return;
      const y = y0 + (yv(q.v) - y0) * f;
      const x = L + i * bw + Math.min(1, bw * 0.15);
      const w = Math.max(1.2, bw - Math.min(2, bw * 0.3));
      ctx.fillStyle = q.cur ? `rgba(${GREEN},1)` : `rgba(${rgbOf(q.v - (opts.zero ?? 0))}, ${q.cur ? 1 : 0.7})`;
      ctx.fillRect(x, Math.min(y, y0), w, Math.max(1, Math.abs(y - y0)));
      if (q.cur) {
        ctx.shadowColor = `rgba(${GREEN},0.8)`; ctx.shadowBlur = 8;
        ctx.fillRect(x, Math.min(y, y0), w, Math.max(1, Math.abs(y - y0)));
        ctx.shadowBlur = 0;
      }
    });
    // 年の目盛り
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.textAlign = 'center';
    this.font(7);
    values.forEach((q, i) => {
      if (labelEvery && (i % labelEvery === 0 || q.cur)) ctx.fillText(q.label, L + i * bw + bw / 2, B + 9);
    });
    if (avg !== undefined) {
      const ya = yv(avg);
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = `rgba(${AMBER}, ${ease(sub(p, 0.7, 0.9)) * 0.9})`;
      ctx.beginPath(); ctx.moveTo(L, ya); ctx.lineTo(R, ya); ctx.stroke();
      ctx.setLineDash([]);
      ctx.textAlign = 'left';
      this.font(8, true);
      ctx.fillStyle = `rgba(${AMBER}, ${ease(sub(p, 0.7, 0.9))})`;
      ctx.fillText(avgLabel ?? '', L + 3, ya - 3);
    }
    ctx.restore();
  }

  private sYtdVs(p: number): void {
    const s = this.cfg.stats;
    this.header('過去の同時期と比較', `各年の${s.md}時点の年初来騰落率`);
    const N = s.pastYtd.length;
    const all = [...s.pastYtd.map(q => ({ label: String(q.year), v: q.ret })), { label: String(s.year), v: s.ytd, cur: true }];
    const mxAbs = Math.max(...all.map(q => Math.abs(q.v)));
    const lim = Math.ceil(mxAbs / 10) * 10;
    const a = ease(sub(p, 0.75, 0.9));
    this.text(`過去${N + 1}年中`, 12, 84, 11, WHITE, { alpha: a * 0.85 });
    this.text(`${s.ytdRank}位`, 12, 112, 30, GREEN, { bold: true, alpha: a });
    this.text(`今年 ${fmtPct(s.ytd)}`, (this.W - 12), 84, 12, GREEN, { bold: true, align: 'right', alpha: a });
    this.text(`過去の中央値 ${fmtPct(s.ytdMedian)}`, (this.W - 12), 102, 10, AMBER, { align: 'right', alpha: a });
    this.barPanel({ L: 36, R: (this.W - 12), T: 130, B: 380, values: all, lo: -lim, hi: lim, step: lim >= 40 ? 20 : 10, p, fmt: v => `${v}%`, avg: s.ytdMedian, avgLabel: '中央値', labelEvery: 10 });
    this.text('（上位ほど、この時期までの上昇が大きい年）', this.W / 2, 408, 9, WHITE, { align: 'center', alpha: 0.55 });
  }

  private sAth(p: number): void {
    const s = this.cfg.stats;
    this.header('最高値（ATH）からの下落率', `${s.year}年・${this.asOfNote()}`);
    const L = 34, R = (this.W - 12), T = 140, B = 320;
    const lo = Math.min(-5, Math.floor((s.ddMin * 1.15) / 2) * 2);
    this.panel(L, T, R, B);
    this.hGrid(L, R, T, B, lo, 0, lo < -12 ? 5 : 2, v => `${v}%`, 0);
    this.monthTicks(L, R, B);
    const ctx = this.ctx;
    const tEnd = s.ddPath[s.ddPath.length - 1].t;
    const tNow = ease(sub(p, 0.05, 0.62)) * tEnd;
    const yv = (v: number) => T + (v / lo) * (B - T);
    let headDd = 0;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(L, T);
    const pts: [number, number][] = [];
    for (const q of s.ddPath) {
      if (q.t > tNow) break;
      pts.push([L + q.t * (R - L), yv(q.dd)]);
      headDd = q.dd;
    }
    pts.forEach(([x, y]) => ctx.lineTo(x, y));
    if (pts.length) ctx.lineTo(pts[pts.length - 1][0], T);
    ctx.closePath();
    ctx.fillStyle = `rgba(${DOWN}, 0.35)`;
    ctx.fill();
    ctx.restore();
    this.line(pts, DOWN, 1.6, 0.95, true);
    // 更新日（0%の線上に表示）
    s.athEvents.forEach(ev => {
      if (ev.t > tNow) return;
      const x = L + ev.t * (R - L);
      ctx.fillStyle = `rgba(${GREEN},0.95)`;
      ctx.beginPath(); ctx.moveTo(x, T + 1); ctx.lineTo(x - 2.2, T - 5); ctx.lineTo(x + 2.2, T - 5); ctx.closePath(); ctx.fill();
    });
    this.text('▼ ATH更新日', (this.W - 12), 136, 8, GREEN, { align: 'right', alpha: 0.9 });
    this.text('ATHから', 12, 84, 11, WHITE, { alpha: 0.8 });
    this.text(fmtPct(headDd), 12, 118, 34, headDd < -0.005 ? DOWN : GREEN, { bold: true });
    const a = ease(sub(p, 0.68, 0.85));
    if (s.dd < -0.005) {
      this.text(`最高値更新（${s.athDate.slice(5).replace('-', '/')}）から`, 12, 350, 12, WHITE, { alpha: a });
      this.text(`${s.athDays}日経過（${s.athTradingDays}営業日）`, 12, 376, 22, AMBER, { bold: true, alpha: a, maxW: this.W - 24 });
    } else {
      this.text('本日、最高値を更新しました', 12, 366, 16, GREEN, { bold: true, alpha: a });
    }
    const a2 = ease(sub(p, 0.78, 0.92));
    this.text(`今年の最大下落 ${fmtPct(s.ddMin)}（${s.ddMinDate.slice(5).replace('-', '/')}）`, 12, 408, 12, WHITE, { alpha: a2, maxW: this.W - 24 });
  }

  private sAthCount(p: number): void {
    const s = this.cfg.stats;
    this.header('今年の最高値（ATH）更新', `${s.year}年・終値ベースで最高値を更新した日`);
    const ctx = this.ctx;
    const L = 20, R = (this.W - 12), Y = 150;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath(); ctx.moveTo(L, Y); ctx.lineTo(R, Y); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.textAlign = 'center';
    this.font(8);
    for (let m = 0; m < 12; m += 1) ctx.fillText(`${m + 1}`, L + ((m + 0.5) / 12) * (R - L), Y + 12);
    const tEnd = s.ytdPath[s.ytdPath.length - 1].t;
    const tNow = ease(sub(p, 0.05, 0.55)) * tEnd;
    let cnt = 0;
    s.athEvents.forEach((ev) => {
      if (ev.t > tNow) return;
      cnt++;
      const x = L + ev.t * (R - L);
      ctx.strokeStyle = `rgba(${GREEN},0.95)`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, Y); ctx.lineTo(x, Y - 26); ctx.stroke();
    });
    ctx.restore();
    this.text(`${cnt}`, 12, 112, 40, GREEN, { bold: true });
    this.ctx.save(); this.font(40, true); const w = this.ctx.measureText(`${cnt}`).width; this.ctx.restore();
    this.text('回', 12 + w + 4, 112, 18, GREEN, { bold: true });
    if (s.athLastIsThisYear && p > 0.55) this.text(`最新のATH更新は${s.athCount}回目（${s.athDate.slice(5).replace('-', '/')}）`, (this.W - 12), 100, 10, WHITE, { align: 'right', alpha: ease(sub(p, 0.55, 0.7)) });

    // 過去の同時期との比較
    const past = s.pastAthCounts.slice(-20);
    const values = [...past.map(q => ({ label: String(q.year).slice(2), v: q.count })), { label: String(s.year).slice(2), v: s.athCount, cur: true }];
    const mx = Math.max(...values.map(q => q.v), Math.ceil(s.athAvg));
    const hi = Math.ceil((mx + 1) / 5) * 5;
    const a = ease(sub(p, 0.5, 0.65));
    this.text(`過去${past.length}年の同じ時期（〜${s.md}）の更新回数`, 12, 196, 10, WHITE, { alpha: a * 0.8 });
    const pp = sub(p, 0.5, 1);
    this.barPanel({ L: 36, R: (this.W - 12), T: 206, B: 370, values, lo: 0, hi, step: hi > 15 ? 10 : 5, p: pp, fmt: v => String(v), avg: s.athAvg, avgLabel: `平均${s.athAvg.toFixed(1)}回`, labelEvery: 4 });
    this.text('（20年間の同時期との比較・年は下2桁）', this.W / 2, 400, 9, WHITE, { align: 'center', alpha: 0.55 });
  }

  private sUpDown(p: number): void {
    const s = this.cfg.stats;
    this.header('上昇日・下落日', `${s.year}年（〜${s.md}）の営業日の内訳`);
    const ctx = this.ctx;
    const L = 12, R = (this.W - 12), T = 124, H = 30;
    const total = s.up + s.down;
    const k = ease(sub(p, 0.05, 0.5));
    const wUp = (R - L) * (s.up / total) * k;
    const wDown = (R - L) * (s.down / total) * k;
    ctx.save();
    ctx.fillStyle = `rgba(${UP},0.9)`; ctx.fillRect(L, T, wUp, H);
    ctx.fillStyle = `rgba(${DOWN},0.9)`; ctx.fillRect(L + wUp, T, wDown, H);
    ctx.restore();
    const a = ease(sub(p, 0.4, 0.55));
    this.text(`上昇 ${Math.round(s.up * k)}日`, L + 4, T + 20, 13, WHITE, { bold: true, alpha: a });
    this.text(`下落 ${Math.round(s.down * k)}日`, R - 4, T + 20, 13, WHITE, { bold: true, align: 'right', alpha: a });
    this.text('上昇日の割合', 12, 84, 11, WHITE, { alpha: 0.8 });
    const shown = (s.upRatio * k);
    this.text(`${shown.toFixed(1)}%`, 12, 112, 28, rgbOf(s.upRatio - 50), { bold: true, alpha: 1 });
    this.text(`過去平均 ${s.upRatioAvg.toFixed(1)}%`, (this.W - 12), 100, 12, AMBER, { bold: true, align: 'right', alpha: ease(sub(p, 0.55, 0.7)) });

    const past = s.pastUpRatios.slice(-25);
    const values = [...past.map(q => ({ label: String(q.year).slice(2), v: q.ratio })), { label: String(s.year).slice(2), v: s.upRatio, cur: true }];
    const mn = Math.min(...values.map(q => q.v)), mxv = Math.max(...values.map(q => q.v));
    const lo = Math.floor((mn - 2) / 5) * 5, hi = Math.ceil((mxv + 2) / 5) * 5;
    this.text(`過去${past.length}年の同じ時期の上昇日の割合`, 12, 186, 10, WHITE, { alpha: ease(sub(p, 0.5, 0.65)) * 0.8 });
    this.barPanel({ L: 36, R: (this.W - 12), T: 196, B: 370, values, lo, hi, step: 5, p: sub(p, 0.5, 1), fmt: v => `${v}%`, avg: s.upRatioAvg, avgLabel: '平均', labelEvery: 5, zero: 50 });
    this.text(`今年 上昇${s.up}日／下落${s.down}日（過去平均 上昇${s.upAvg.toFixed(0)}日／下落${s.downAvg.toFixed(0)}日）`, this.W / 2, 400, 9, WHITE, { align: 'center', alpha: 0.7 * ease(sub(p, 0.7, 0.85)), maxW: this.W - 20 });
  }

  private sOutlook(p: number): void {
    const s = this.cfg.stats;
    const o = s.outlook;
    this.header('年末までの過去実績', `過去の各年の ${s.md} → 12/31（${s.md}を100とする）`);
    const ctx = this.ctx;
    const L = 34, R = (this.W - 12), T = 130, B = 330;
    this.panel(L, T, R, B);
    const vs = o.paths.flatMap(q => q.pts.map(x => x.v));
    const [lo, hi] = this.niceRange(Math.max(60, Math.min(...vs, 100)) - 1, Math.min(140, Math.max(...vs, 100)) + 1, 10);
    this.hGrid(L, R, T, B, lo, hi, 10, v => String(v), 100);
    const xy = (t: number, v: number): [number, number] => [L + t * (R - L), B - ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (B - T)];
    const k = ease(sub(p, 0.05, 0.62)) * o.paths.length;
    o.paths.forEach((q, i) => {
      const f = clamp01(k - i);
      if (f <= 0) return;
      const pts: [number, number][] = [];
      for (const pt of q.pts) { if (pt.t <= f) pts.push(xy(pt.t, pt.v)); }
      this.line(pts, rgbOf(q.end), 1, 0.28 + (f < 1 ? 0.3 : 0));
      if (f >= 1) { const e = xy(1, q.pts[q.pts.length - 1].v); ctx.fillStyle = `rgba(${rgbOf(q.end)},0.8)`; ctx.beginPath(); ctx.arc(e[0], e[1], 1.6, 0, Math.PI * 2); ctx.fill(); }
    });
    // 現在地
    this.text('いま', L, B + 12, 9, GREEN, { align: 'center', bold: true });
    this.text('12/31', R, B + 12, 9, WHITE, { align: 'right', alpha: 0.7 });
    ctx.fillStyle = `rgba(${GREEN},1)`; ctx.beginPath(); ctx.arc(...xy(0, 100), 3.5, 0, Math.PI * 2); ctx.fill();
    // 中央値の線
    const a = ease(sub(p, 0.65, 0.8));
    const med = xy(1, 100 + o.median);
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = `rgba(${AMBER},${a * 0.95})`;
    ctx.beginPath(); ctx.moveTo(...xy(0, 100)); ctx.lineTo(med[0], med[1]); ctx.stroke();
    ctx.restore();
    this.text(`中央値 ${fmtPct(o.median)}`, R - 2, med[1] - 4, 9, AMBER, { align: 'right', bold: true, alpha: a });

    this.text('この時期から年末まで上昇した年', 12, 84, 11, WHITE, { alpha: ease(sub(p, 0.62, 0.75)) * 0.85 });
    this.text(`${o.posCount}/${o.n}年`, 12, 114, 28, GREEN, { bold: true, alpha: ease(sub(p, 0.62, 0.78)) });
    this.text(`${o.posProb.toFixed(1)}%`, (this.W - 12), 114, 28, GREEN, { bold: true, align: 'right', alpha: ease(sub(p, 0.62, 0.78)) });

    const a2 = ease(sub(p, 0.78, 0.92));
    this.text(`四分位 ${fmtPct(o.p25)} 〜 ${fmtPct(o.p75)}`, 12, 372, 11, WHITE, { alpha: a2, maxW: this.W - 24 });
    this.text(`今年のプラスを年末まで維持できた割合 ${o.keepPlusProb.toFixed(1)}%`, 12, 394, 11, AMBER, { bold: true, alpha: a2, maxW: this.W - 24 });
    if (o.simN >= 8) this.text(`※年初来が同程度（±6pt）の${o.simN}年では、上昇 ${o.simPos}年`, 12, 414, 9, WHITE, { alpha: a2 * 0.7, maxW: this.W - 24 });
    this.text('過去の実績であり、将来の予想ではありません', this.W / 2, 440, 9, WHITE, { align: 'center', alpha: 0.5 });
  }

  private sCrash(p: number): void {
    const s = this.cfg.stats;
    const rows = crashList(s);
    this.header('調整〜暴落の頻度', 'S&P500の約70年の実績から');
    const ctx = this.ctx;
    const top = 70;
    const rowH = Math.min(84, 340 / Math.max(1, rows.length));
    const y0 = 1957, y1 = s.year;
    rows.forEach((r, i) => {
      const f = ease(sub(p, 0.05 + i * 0.12, 0.35 + i * 0.12));
      const y = top + i * rowH;
      const rgb = r.level >= 50 ? '178,124,255' : r.level >= 30 ? DOWN : r.level >= 20 ? '255,150,90' : AMBER;
      ctx.save(); ctx.globalAlpha *= f;
      ctx.fillStyle = `rgba(${rgb},0.12)`; ctx.fillRect(8, y, this.W - 16, rowH - 8);
      ctx.fillStyle = `rgba(${rgb},1)`; ctx.fillRect(8, y, 3, rowH - 8);
      ctx.restore();
      this.text(`-${r.level}%`, 18, y + 26, 24, rgb, { bold: true, alpha: f });
      this.text(r.name, 18, y + 44, 11, WHITE, { alpha: f * 0.75 });
      this.text(r.interval, this.W - 14, y + 26, 17, WHITE, { bold: true, align: 'right', alpha: f });
      this.text(r.lastYear ? `前回 ${r.lastYear}年` : '', this.W - 14, y + 46, 12, rgb, { bold: true, align: 'right', alpha: f });
      if (r.years.length) {
        const x0 = 18, x1 = this.W - 18, ly = y + rowH - 20;
        ctx.save(); ctx.globalAlpha *= f;
        ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(x0, ly, x1 - x0, 1);
        ctx.fillStyle = `rgba(${rgb},1)`;
        r.years.forEach(yy => { ctx.beginPath(); ctx.arc(x0 + (x1 - x0) * (yy - y0) / (y1 - y0), ly, 2.6, 0, Math.PI * 2); ctx.fill(); });
        ctx.restore();
      }
    });
    this.text('過去の実績であり、将来の予想ではありません', this.W / 2, top + rows.length * rowH + 10, 9, WHITE, { align: 'center', alpha: 0.5 });
  }

  private disclaimerLayout(fs: number): { top: number; lh: number; wrapped: string[][]; bw: number } {
    const ctx = this.ctx;
    const lh = fs * (this.cfg.fontScale ?? 1) + 3;
    ctx.save();
    this.font(fs);
    const bw = ctx.measureText('・').width;
    const notes = [`S&P500（VOO）の米国時間${this.cfg.stats.asOf.replace(/-/g, '/')}時点のデータ。評価額は表示せず、騰落率で表現しています。`, ...DISCLAIMERS];
    const wrapped = notes.map(t => {
      const lines: string[] = [];
      let line = '';
      for (const ch of t) { if (line && ctx.measureText(line + ch).width > this.W - 24 - bw) { lines.push(line); line = ch; } else line += ch; }
      if (line) lines.push(line);
      return lines;
    });
    ctx.restore();
    const total = wrapped.reduce((n, w) => n + w.length, 0);
    return { top: this.H - 12 - (lh * (total + 1) + 6) + 2, lh, wrapped, bw };
  }

  private sEnd(p: number): void {
    const s = this.cfg.stats;
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, this.W, this.H);
    ctx.restore();
    {
      // 「S&P500 近況まとめ」の後ろに日付
      ctx.save();
      this.font(16, true);
      const w1 = ctx.measureText(`S&P500 ${this.cfg.label ?? '近況まとめ'}`).width;
      this.font(11, false);
      const w2 = ctx.measureText(this.dateJa()).width;
      ctx.restore();
      const x0 = (this.W - (w1 + 6 + w2)) / 2;
      this.text(`S&P500 ${this.cfg.label ?? '近況まとめ'}`, x0, 34, 16, GREEN, { bold: true });
      this.text(this.dateJa(), x0 + w1 + 6, 34, 11, WHITE, { alpha: 0.85 });
    }
    const o = s.outlook;
    const sgn = (v: number) => `${v >= 0 ? '+' : '-'}${Math.abs(v).toFixed(1)}%`;
    const md = (d: string) => `${parseInt(d.slice(5, 7), 10)}/${parseInt(d.slice(8, 10), 10)}`;
    // [項目, 実績, 色, （過去平均／発生日／直近発生）]
    const items: [string, string, string, string][] = [
      ['年初来', fmtPct(s.ytd), rgbOf(s.ytd), `過去平均 ${sgn(s.ytdAvg)}`],
      ['ATHから', fmtPct(s.dd), s.dd < -0.005 ? DOWN : GREEN, s.dd < -0.005 ? `直近 ${md(s.athDate)}・${s.athDays}日経過` : '本日ATH更新'],
      ['今年のATH更新', `${s.athCount}回`, GREEN, `過去平均 ${s.athAvg.toFixed(1)}回`],
      ['上昇日', `${s.up}日`, UP, `過去平均 ${s.upAvg.toFixed(0)}日`],
      ['下落日', `${s.down}日`, DOWN, `過去平均 ${s.downAvg.toFixed(0)}日`],
      ['年末まで上昇する確率', `${o.posProb.toFixed(1)}%`, AMBER, `過去${o.n}年中${o.posCount}年`],
    ];
    const rowH = 24;
    // 注釈が重ならないよう、文字サイズを決める
    let fs = 10;
    let showQ = true;
    const qH = 84;
    const need = items.length * rowH + 40;
    for (const f of [10, 9, 8]) {
      fs = f;
      if (this.disclaimerLayout(f).top - 6 - need - qH >= 0) break;
      if (f === 8) showQ = false;
    }
    let y = 66;
    items.forEach(([label, val, rgb, note], i) => {
      const a = ease(sub(p, 0.05 + i * 0.08, 0.22 + i * 0.08));
      this.text(label, 12, y, 11, WHITE, { alpha: a * 0.9, maxW: 100 * (this.cfg.fontScale ?? 1) });
      this.font(16, true);
      const vw = ctx.measureText(val).width;
      this.text(val, 116 * (this.cfg.fontScale ?? 1), y + 1, 16, rgb, { bold: true, alpha: a });
      if (note) this.text(`（${note}）`, 116 * (this.cfg.fontScale ?? 1) + vw + 4, y, 9, WHITE, { alpha: a * 0.75, maxW: this.W - 12 - (116 * (this.cfg.fontScale ?? 1) + vw + 4) });
      y += rowH;
    });
    if (showQ) {
      ['あなたは', `${s.year}年末のS&P500は`, 'どうなると思いますか？'].forEach((line, i) => {
        this.text(line, this.W / 2, y + 28 + i * 24, 18, WHITE, { bold: true, align: 'center', maxW: this.W - 24, alpha: ease(sub(p, 0.55, 0.75)) });
      });
    }
    const d = this.disclaimerLayout(fs);
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath(); ctx.moveTo(12, d.top); ctx.lineTo(this.W - 12, d.top); ctx.stroke();
    let yy = d.top + d.lh - 2;
    this.text('【ご留意事項】', 12, yy, fs, WHITE, { bold: true, alpha: 0.75 });
    yy += d.lh + 2;
    d.wrapped.forEach(ls => ls.forEach((l, i) => {
      if (i === 0) this.text('・', 12, yy, fs, WHITE, { alpha: 0.6 });
      this.text(l, 12 + d.bw, yy, fs, WHITE, { alpha: 0.6 });
      yy += d.lh;
    }));
    ctx.restore();
  }
}
