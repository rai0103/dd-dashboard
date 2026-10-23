// [dd-dashboard移植版] investment-shorts (lib/longAnalysisRenderer.ts) を移植。
// SummaryMd（sm）・xScene（buildSummaryScenes由来のx_*シーン）は移植しない（dd-dashboardはLongMdを直接組み立てるため発生しない経路）。
// 長尺（16:9）「S&P500の分析」の描画。論理サイズは 960×540（実際のキャンバスはその倍率）。
// 左：ショート用チャート（縦）＋要点カード／詳細分析は左〜中央を使って大きく描く／右：アナリストと吹き出し
import { UpdateStats, fmtPct } from './videoMarketUpdate';
import { DISCLAIMERS } from './videoDisclaimer';
import { LongMd } from './videoLongMd';
import { LongBasis, valueAt } from './videoLongBasis';
import { LongScene, LongSceneId } from './videoLongAnalysis';
import { ResolvedCustomScene } from './videoCustomScene';
import { MarketUpdateRenderer } from './videoMarketUpdateRenderer';
import { VideoAvatar } from './videoAvatarRender';
import { LONG_COLUMN_X, drawLongBackground } from './videoAnalysts';

export interface LongAnalysisConfig {
  stats: UpdateStats;
  scenes: LongScene[];
  analyst: { kind: 'video'; avatar: VideoAvatar } | null; // 人物アバター（MP4最大3本・ランダム連続再生）。未登録時はnull（人物パネルなし）
  backgroundImage?: HTMLImageElement | null;
  backgroundOpacity: number;
  rolling?: { label: string; v: number }[];
  basis?: LongBasis | null; // 年末見通しの根拠（CSVから算出）
  md?: LongMd | null; // DDダッシュボードの長尺分析データ（あれば内容・数値はこちらを正とする）
  customScenes?: ResolvedCustomScene[]; // Stage D-4：チャットで生成したカスタム場面（系列データ解決済み）
}

const LW = 960, LH = 540;
const FONT = '"Segoe UI", "Yu Gothic", "Meiryo", sans-serif';
const UP = '255, 107, 107', DOWN = '90, 169, 255', GREEN = '46, 230, 184', WHITE = '255, 255, 255', AMBER = '255, 190, 80';
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const sub = (p: number, a: number, b: number) => clamp01((p - a) / (b - a));
const ease = (x: number) => 1 - Math.pow(1 - x, 3);
const rgbOf = (v: number) => (v >= 0 ? UP : DOWN);

// 左パネル（論理座標）
const PX = 20, PY = 58, PW = 646, PH = 480;
const SCENE_W = PW, SCENE_H = PH; // ショート用シーンを横長（646×480）の専用幅で描く

/** 音声の大きさの推移（10msごと・0〜1）。口の開きに使う */
function computeEnvelope(b: AudioBuffer): Float32Array {
  const ch = b.getChannelData(0);
  const hop = Math.max(1, Math.round(b.sampleRate * 0.01));
  const n = Math.floor(ch.length / hop);
  const env = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    const a = i * hop, e = Math.min(ch.length, a + hop * 2);
    for (let j = a; j < e; j++) sum += ch[j] * ch[j];
    env[i] = Math.sqrt(sum / Math.max(1, e - a));
  }
  const sorted = Array.from(env).sort((x, y) => x - y);
  const peak = sorted[Math.floor(sorted.length * 0.95)] || 1e-6;
  for (let i = 0; i < n; i++) env[i] = Math.min(1, env[i] / peak);
  return env;
}

interface Card { label: string; value: string; sub?: string; rgb: string }

export class LongAnalysisRenderer {
  private ctx: CanvasRenderingContext2D;
  private k: number;
  private durs: number[];
  private inner: MarketUpdateRenderer;
  private off: HTMLCanvasElement;
  private offCtx: CanvasRenderingContext2D;
  private envs: (Float32Array | null)[] = [];

  private cfg: LongAnalysisConfig;
  constructor(canvas: HTMLCanvasElement, cfg0: LongAnalysisConfig) {
    this.cfg = cfg0.md ? { ...cfg0, stats: { ...cfg0.stats, year: cfg0.md.y, month: cfg0.md.m, day: cfg0.md.d } } : cfg0;
    const cfg = this.cfg;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get canvas context');
    this.ctx = ctx;
    this.k = canvas.width / LW;
    this.durs = cfg.scenes.map(s => s.minSec);
    this.off = document.createElement('canvas');
    this.off.width = Math.round(SCENE_W * this.k);
    this.off.height = Math.round(SCENE_H * this.k);
    this.offCtx = this.off.getContext('2d')!;
    this.offCtx.scale(this.k, this.k);
    const proxy: any = { width: SCENE_W, height: SCENE_H, getContext: () => this.offCtx };
    this.inner = new MarketUpdateRenderer(proxy, { stats: cfg.stats, scenes: [], backgroundPattern: 'none', backgroundOpacity: 0, label: '分析', fontScale: 1.2 });
  }

  /** 各シーンの読み上げ音声（口パク用）。音声は各シーンの開始から0.3秒後に流れる */
  setNarration(bufs: (AudioBuffer | null)[]): void { this.envs = bufs.map(b => (b ? computeEnvelope(b) : null)); }

  setDurations(d: number[]): void { if (d.length === this.cfg.scenes.length) this.durs = d.slice(); }
  get totalSeconds(): number { return this.durs.reduce((a, b) => a + b, 0); }
  getDurations(): number[] { return this.durs.slice(); }
  /** 動画のアバターが、指定の位置の画面になるまで待つ（サムネ保存用） */
  async prepare(progress: number): Promise<void> {
    if (this.cfg.analyst) {
      this.cfg.analyst.avatar.ensureSchedule(this.totalSeconds);
      await this.cfg.analyst.avatar.prepare(Math.min(1, Math.max(0, progress)) * this.totalSeconds);
    }
  }
  pauseAvatar(): void { if (this.cfg.analyst) this.cfg.analyst.avatar.pauseAll(); }

  thumbProgress(): number { return (this.durs[0] * 0.9) / Math.max(1e-6, this.totalSeconds); }

  /** 指定の進捗（0〜1）の時点で、どの場面（durs配列のインデックス）が表示されるかを返す（draw()と同じ割り当てロジック。副作用なし） */
  getSceneIndexAt(progress: number): number {
    const gt = clamp01(progress) * this.totalSeconds;
    let t = gt, i = 0;
    while (i < this.durs.length - 1 && t >= this.durs[i]) { t -= this.durs[i]; i++; }
    return i;
  }

  /** 指定の進捗（0〜1）の時点で、今の場面が始まってから何秒経過しているか（draw()のtと同じ値。副作用なし） */
  getSceneLocalTimeAt(progress: number): number {
    const gt = clamp01(progress) * this.totalSeconds;
    let t = gt, i = 0;
    while (i < this.durs.length - 1 && t >= this.durs[i]) { t -= this.durs[i]; i++; }
    return t;
  }

  draw(progress: number): void {
    const ctx = this.ctx;
    ctx.setTransform(this.k, 0, 0, this.k, 0, 0);
    ctx.globalAlpha = 1;
    drawLongBackground(ctx, this.cfg.backgroundImage, this.cfg.backgroundOpacity, LW, LH);
    const gt = clamp01(progress) * this.totalSeconds;
    let t = gt, i = 0;
    while (i < this.durs.length - 1 && t >= this.durs[i]) { t -= this.durs[i]; i++; }
    const dur = this.durs[i];
    const p = clamp01(t / dur);
    const sc = this.cfg.scenes[i];
    const last = i === this.durs.length - 1;
    const fade = Math.min(clamp01(t / 0.3), last ? 1 : clamp01((dur - t) / 0.3));

    this.drawTitleBar();
    ctx.fillStyle = 'rgba(255,255,255,0.045)';
    ctx.fillRect(PX - 6, PY - 4, PW + 12, PH + 8);

    ctx.save();
    ctx.globalAlpha = fade;
    if (sc.detail) {
      ctx.save();
      ctx.translate(PX, PY);
      ctx.textBaseline = 'alphabetic';
      this.detailScene(sc.id, p);
      ctx.restore();
    } else {
      this.inner.renderScene(sc.id as any, p);
      ctx.drawImage(this.off, PX, PY, SCENE_W, SCENE_H);
    }
    ctx.restore();

    this.drawAnalystPanel(this.mouthLevel(i, t), gt);
    ctx.globalAlpha = 1;
  }

  // ---------- 共通 ----------
  private font(size: number, bold = false) { this.ctx.font = `${bold ? 'bold ' : ''}${size}px ${FONT}`; }
  private txt(t: string, x: number, y: number, size: number, rgb: string, o: { bold?: boolean; align?: CanvasTextAlign; alpha?: number; maxW?: number } = {}) {
    const ctx = this.ctx;
    ctx.save();
    ctx.textAlign = o.align ?? 'left';
    let s = size;
    this.font(s, o.bold);
    if (o.maxW) while (s > 8 && ctx.measureText(t).width > o.maxW) { s -= 1; this.font(s, o.bold); }
    ctx.fillStyle = `rgba(${rgb}, ${o.alpha ?? 1})`;
    ctx.fillText(t, x, y);
    ctx.restore();
  }
  private wrap(text: string, maxW: number): string[] {
    const lines: string[] = [];
    let cur = '';
    for (const ch of text) {
      if (this.ctx.measureText(cur + ch).width > maxW && cur) { lines.push(cur); cur = ch; } else cur += ch;
    }
    if (cur) lines.push(cur);
    return lines;
  }

  /** 円グラフ（ドーナツ）。中心(cx,cy)・外径r・内径innerR・segments（0時位置から時計回りに割合で並べる）。progress（0〜1）で弧を描き進める */
  private drawDonut(cx: number, cy: number, r: number, innerR: number, segments: { value: number; color: string }[], progress: number, centerLabel?: { text: string; rgb: string }): void {
    const ctx = this.ctx;
    const total = segments.reduce((a, sgm) => a + Math.max(0, sgm.value), 0);
    if (total <= 0) return;
    const k = ease(clamp01(progress));
    const ringR = (r + innerR) / 2;
    const lw = Math.max(1, r - innerR);
    let startAngle = -Math.PI / 2;
    ctx.save();
    ctx.lineCap = 'butt';
    segments.forEach(sgm => {
      const frac = Math.max(0, sgm.value) / total;
      const sweep = frac * Math.PI * 2 * k;
      if (sweep > 0.002) {
        ctx.beginPath();
        ctx.strokeStyle = `rgba(${sgm.color},0.92)`;
        ctx.lineWidth = lw;
        ctx.arc(cx, cy, ringR, startAngle, startAngle + sweep);
        ctx.stroke();
      }
      startAngle += frac * Math.PI * 2;
    });
    ctx.restore();
    if (centerLabel) {
      const a = ease(sub(k, 0.25, 0.95));
      this.txt(centerLabel.text, cx, cy + 7, 20, centerLabel.rgb, { bold: true, align: 'center', alpha: a, maxW: Math.max(10, innerR * 2 - 8) });
    }
  }

  // Stage D-4：カスタム場面（チャットで生成した自由記述の比較チャート）用の汎用オーバーレイ折れ線チャート。
  // basis10/basisCycleシーンの「グリッド＋折れ線＋凡例」の描き方と同じ考え方の汎用版（系列数は可変）。
  // 既存のbasis10/basisCycle自体はこのメソッドを使わず、見た目・コードともに変更しない。
  private drawOverlayChart(title: string, subtitle: string, series: { label: string; pts: { t: number; v: number }[]; style: 'solid' | 'dashed'; emphasis: boolean; rgb: string }[], yUnit: 'index' | 'pct', p: number): void {
    const ctx = this.ctx;
    this.heading(title, subtitle, p);
    if (!series.length) return;
    const L = 46, R = PW - 20, T = 112, B = 340;
    ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fillRect(L, T, R - L, B - T);
    const all = series.flatMap(s => s.pts.map(q => q.v));
    if (!all.length) return;
    const lo = Math.floor(Math.max(40, Math.min(...all, 90)) / 10) * 10;
    const hi = Math.ceil(Math.min(200, Math.max(...all, 110)) / 10) * 10;
    const yv = (v: number) => B - ((Math.min(hi, Math.max(lo, v)) - lo) / Math.max(1, hi - lo)) * (B - T);
    const step = hi - lo > 60 ? 20 : 10;
    for (let v = lo; v <= hi; v += step) {
      ctx.strokeStyle = v === 100 ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.1)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(L, yv(v)); ctx.lineTo(R, yv(v)); ctx.stroke();
      const label = yUnit === 'pct' ? `${v - 100 >= 0 ? '+' : ''}${v - 100}%` : String(v);
      this.txt(label, L - 6, yv(v) + 4, 11, WHITE, { alpha: 0.55, align: 'right' });
    }
    for (let m = 0; m < 12; m++) this.txt(`${m + 1}月`, L + ((m + 0.5) / 12) * (R - L), B + 15, 11, WHITE, { alpha: 0.55, align: 'center' });

    const drawLine = (pts: { t: number; v: number }[], tMax: number, rgb: string, w: number, alpha: number, dash: boolean, glow: boolean) => {
      ctx.save(); ctx.lineJoin = 'round'; ctx.strokeStyle = `rgba(${rgb},${alpha})`; ctx.lineWidth = w;
      if (dash) ctx.setLineDash([6, 4]);
      if (glow) { ctx.shadowColor = `rgba(${rgb},0.55)`; ctx.shadowBlur = 7; }
      ctx.beginPath(); let f = true; let last: { t: number; v: number } | null = null;
      for (const q of pts) { if (q.t > tMax) break; const x = L + q.t * (R - L); if (f) { ctx.moveTo(x, yv(q.v)); f = false; } else ctx.lineTo(x, yv(q.v)); last = q; }
      ctx.stroke(); ctx.restore();
      return last;
    };

    series.forEach((sr, i) => {
      const delay = i * 0.04;
      const k = ease(sub(p, 0.08 + delay, 0.6 + delay));
      const tMax = k * (sr.pts[sr.pts.length - 1]?.t ?? 1);
      const w = sr.emphasis ? 3.2 : 1.6;
      const alpha = sr.emphasis ? 1 : 0.75;
      const last = drawLine(sr.pts, tMax, sr.rgb, w, alpha, sr.style === 'dashed', sr.emphasis);
      if (last && sr.emphasis) { ctx.fillStyle = `rgba(${sr.rgb},1)`; ctx.beginPath(); ctx.arc(L + last.t * (R - L), yv(last.v), 4.5, 0, Math.PI * 2); ctx.fill(); }
    });

    const la = ease(sub(p, 0.5, 0.85));
    ctx.save(); ctx.globalAlpha *= la;
    series.forEach((sr, i) => {
      const col = i % 3, row = Math.floor(i / 3);
      const x = L + 8 + col * 200, y = T + 16 + row * 16;
      ctx.strokeStyle = `rgba(${sr.rgb},0.95)`; ctx.lineWidth = sr.emphasis ? 3 : 1.6;
      if (sr.style === 'dashed') ctx.setLineDash([5, 3]); else ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 20, y); ctx.stroke();
      this.txt(sr.label, x + 26, y + 4, 12, WHITE, { alpha: 0.9, maxW: 165 });
    });
    ctx.restore();
  }

  // [Stage D-5] カスタム場面用の汎用棒グラフ（既存のhbarを複数行ループで呼ぶだけ。ytdChange旧実装・athDrop等と同じ組み立て方）。
  private drawBarCompare(title: string, subtitle: string, bars: { label: string; value: number }[], p: number): void {
    this.heading(title, subtitle, p);
    if (!bars.length) return;
    const lim = Math.max(...bars.map(b => Math.abs(b.value)), 5) * 1.15;
    const rowH = Math.max(40, Math.min(70, Math.floor(310 / bars.length)));
    const delay = Math.min(0.1, 0.5 / bars.length);
    bars.forEach((b, i) => this.hbar(b.label, b.value, lim, 130 + i * rowH, sub(p, 0.1 + i * delay, 0.5 + i * delay), fmtPct(b.value)));
  }

  // [Stage D-5] カスタム場面用の汎用円グラフ（既存のdrawDonutを使い、見出し・凡例を添えた1場面分にまとめる）。
  private drawDonutScene(title: string, subtitle: string, segments: { label: string; value: number; rgb: string }[], p: number): void {
    this.heading(title, subtitle, p);
    if (!segments.length) return;
    const ctx = this.ctx;
    const cx = PW / 2, cy = 250, r = 120, innerR = 72;
    const total = segments.reduce((a, sgm) => a + Math.max(0, sgm.value), 0);
    const top = segments.reduce((a, sgm) => (sgm.value > a.value ? sgm : a), segments[0]);
    this.drawDonut(
      cx, cy, r, innerR,
      segments.map(sgm => ({ value: sgm.value, color: sgm.rgb })),
      p,
      total > 0 ? { text: `${Math.round((Math.max(0, top.value) / total) * 100)}%`, rgb: top.rgb } : undefined
    );
    const la = ease(sub(p, 0.5, 0.85));
    ctx.save(); ctx.globalAlpha *= la;
    segments.forEach((sgm, i) => {
      const col = i % 2, row = Math.floor(i / 2);
      const x = 40 + col * (PW / 2 - 20), y = 400 + row * 26;
      ctx.fillStyle = `rgba(${sgm.rgb},0.95)`; ctx.fillRect(x, y - 10, 14, 14);
      const pct = total > 0 ? `${((Math.max(0, sgm.value) / total) * 100).toFixed(1)}%` : '';
      this.txt(`${sgm.label}　${pct}`, x + 20, y + 2, 13, WHITE, { alpha: 0.9, maxW: PW / 2 - 60 });
    });
    ctx.restore();
  }

  private drawTitleBar() {
    const s = this.cfg.stats;
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(0, 0, LONG_COLUMN_X, 50);
    ctx.fillStyle = `rgba(${GREEN}, 0.9)`;
    ctx.fillRect(0, 48, LONG_COLUMN_X, 2);
    this.txt('S&P500の分析', 24, 34, 26, WHITE, { bold: true });
    this.txt(`${s.year}年${s.month}月${s.day}日時点（米国時間）`, LONG_COLUMN_X - 16, 32, 14, WHITE, { align: 'right', alpha: 0.75 });
  }

  // ---------- ショート用チャートの横に並べる要点カード ----------
  private cardsFor(id: LongSceneId): Card[] {
    const s = this.cfg.stats;
    const o = s.outlook;
    switch (id) {
      case 'ytd': return [
        { label: '年初来', value: fmtPct(s.ytd), rgb: rgbOf(s.ytd) },
        { label: '昨日比', value: fmtPct(s.dayChange), rgb: rgbOf(s.dayChange) },
        ...(s.oneYear !== null ? [{ label: '直近1年', value: fmtPct(s.oneYear), rgb: rgbOf(s.oneYear) }] : []),
      ];
      case 'ytdvs': return [
        { label: `過去${s.pastYtd.length}年の同時期での順位`, value: `${s.ytdRank}位`, sub: '1位が最高', rgb: GREEN },
        { label: '過去の中央値', value: fmtPct(s.ytdMedian), rgb: rgbOf(s.ytdMedian) },
        { label: '過去の平均', value: fmtPct(s.ytdAvg), rgb: rgbOf(s.ytdAvg) },
      ];
      case 'ath': return [
        { label: '最高値からの下落率', value: s.dd >= -0.005 ? '最高値圏' : `${s.dd.toFixed(1)}%`, rgb: s.dd >= -0.005 ? GREEN : DOWN },
        { label: '最高値更新からの経過', value: `${s.athDays}日`, sub: `営業日 ${s.athTradingDays}日`, rgb: WHITE },
        { label: '今年の最大下落', value: `${s.ddMin.toFixed(1)}%`, sub: s.ddMinDate, rgb: DOWN },
      ];
      case 'athcount': return [
        { label: '今年の最高値更新', value: `${s.athCount}回`, rgb: UP },
        { label: '同時期の過去平均', value: `約${Math.max(1, Math.round(s.athAvg))}回`, rgb: WHITE },
        { label: '直近の更新日', value: s.athDate.slice(5).replace('-', '/'), rgb: AMBER },
      ];
      case 'updown': return [
        { label: '上昇日', value: `${s.up}日`, rgb: UP },
        { label: '下落日', value: `${s.down}日`, rgb: DOWN },
        { label: '上昇日の割合', value: `${s.upRatio.toFixed(1)}%`, sub: `過去平均 ${s.upRatioAvg.toFixed(1)}%`, rgb: WHITE },
      ];
      case 'outlook': return [
        { label: `年末までに上昇した年（過去${o.n}年）`, value: `${o.posCount}年 / ${o.posProb.toFixed(0)}%`, rgb: UP },
        { label: '年末までの変化の中央値', value: fmtPct(o.median), rgb: rgbOf(o.median) },
        { label: '年末までプラスを維持した確率', value: `${o.keepPlusProb.toFixed(0)}%`, rgb: GREEN },
      ];
      case 'crash': {
        const rows = (s.crash ?? []).filter(r => [10, 20, 30].includes(r.level)).slice(0, 3);
        return rows.map(r => ({ label: `下落 -${r.level}%超`, value: r.intervalText || '—', sub: r.lastYear ? `前回 ${r.lastYear}年` : '', rgb: r.level >= 30 ? DOWN : r.level >= 20 ? AMBER : WHITE }));
      }
      case 'open': return [
        { label: '今回の内容', value: '近況と分析', sub: '年初来・最高値・上昇日数・年末の過去実績・暴落の発生率', rgb: GREEN },
      ];
      case 'end': return [
        { label: '今回のまとめ', value: `年初来 ${fmtPct(s.ytd)}`, sub: `最高値から ${s.dd >= -0.005 ? '更新中' : s.dd.toFixed(1) + '%'}`, rgb: GREEN },
      ];
      default: return [];
    }
  }

  private cards(id: LongSceneId, p: number) {
    const ctx = this.ctx;
    const cards = this.cardsFor(id);
    const X = PX + SCENE_W + 22, W = PW - SCENE_W - 22;
    const H = 130, GAP = 14;
    const startY = PY + (PH - (cards.length * H + (cards.length - 1) * GAP)) / 2;
    cards.forEach((c, i) => {
      const a = ease(sub(p, 0.08 + i * 0.12, 0.28 + i * 0.12));
      const y = startY + i * (H + GAP);
      ctx.save();
      ctx.globalAlpha *= a;
      ctx.translate((1 - a) * 24, 0);
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.fillRect(X, y, W, H);
      ctx.fillStyle = `rgba(${c.rgb}, 0.95)`;
      ctx.fillRect(X, y, 5, H);
      this.txt(c.label, X + 20, y + 30, 16, WHITE, { alpha: 0.75, maxW: W - 32 });
      this.txt(c.value, X + 20, y + 80, 46, c.rgb, { bold: true, maxW: W - 32 });
      if (c.sub) this.txt(c.sub, X + 20, y + 112, 14, WHITE, { alpha: 0.6, maxW: W - 32 });
      ctx.restore();
    });
  }

  // ---------- 詳細分析（左〜中央を全部使う） ----------
  private heading(title: string, subtitle: string, p: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha *= ease(sub(p, 0, 0.12));
    this.txt(title, 24, 52, 30, WHITE, { bold: true });
    this.txt(subtitle, 24, 80, 15, WHITE, { alpha: 0.65, maxW: PW - 48 });
    ctx.fillStyle = `rgba(${GREEN}, 0.8)`;
    ctx.fillRect(24, 92, 120, 3);
    ctx.restore();
  }

  /** 中央0のバー。右が＋、左が− */
  private hbar(label: string, v: number, lim: number, y: number, p: number, text: string) {
    const ctx = this.ctx;
    const x0 = 260, w = 290, mid = x0 + w / 2, half = w / 2;
    this.txt(label, 24, y + 24, 18, WHITE, { alpha: 0.85, maxW: 226 });
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(x0, y, w, 34);
    const len = Math.min(1, Math.abs(v) / lim) * half * ease(p);
    ctx.fillStyle = `rgba(${rgbOf(v)}, 0.9)`;
    if (v >= 0) ctx.fillRect(mid, y + 4, len, 26); else ctx.fillRect(mid - len, y + 4, len, 26);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillRect(mid - 1, y - 4, 2, 42);
    this.txt(text, 562, y + 27, 22, rgbOf(v), { bold: true, maxW: 82 });
  }

  private detailScene(id: LongSceneId, p: number) {
    const ctx = this.ctx;
    const s = this.cfg.stats;
    const o = s.outlook;

    const md = this.cfg.md;
    const ctx0 = ctx;
    const DATE = `${md ? md.y : s.year}年${md ? md.m : s.month}月${md ? md.d : s.day}日`;
    const sg = (v: number, d = 1) => `${v >= 0 ? '+' : '-'}${Math.abs(v).toFixed(d)}%`;
    const kuro = (v: number) => (v >= 0 ? UP : DOWN);
    if (typeof id === 'string' && id.startsWith('custom:')) {
      const cs = (this.cfg.customScenes ?? []).find(c => c.id === id);
      if (cs) {
        if (cs.chartType === 'bar') this.drawBarCompare(cs.title, cs.subtitle, cs.bars, p);
        else if (cs.chartType === 'donut') this.drawDonutScene(cs.title, cs.subtitle, cs.donut?.segments ?? [], p);
        else this.drawOverlayChart(cs.title, cs.subtitle, cs.series, cs.yUnit, p);
      }
      return;
    }
    if (md && id === 'status' && md.status) {
      const st = md.status;
      this.heading('現在の状況', `${DATE}（米国時間）基準`, p);
      const cards: [string, string, string][] = [
        ['最高値（ATH）からの下落率', sg(st.dd), st.dd < -0.005 ? DOWN : GREEN],
        ['モード', st.mode || '—', GREEN],
        ['年初来', sg(st.ytd), kuro(st.ytd)],
        ['直近1年', st.oneYear !== null ? sg(st.oneYear) : '—', st.oneYear !== null ? kuro(st.oneYear) : WHITE],
      ];
      cards.forEach(([l, v, rgb], i) => {
        const a = ease(sub(p, 0.1 + i * 0.1, 0.28 + i * 0.1));
        const y = 108 + i * 62;
        ctx0.save(); ctx0.globalAlpha *= a; ctx0.translate((1 - a) * 16, 0);
        ctx0.fillStyle = 'rgba(255,255,255,0.07)'; ctx0.fillRect(24, y, 300, 54);
        ctx0.fillStyle = `rgba(${rgb}, 0.95)`; ctx0.fillRect(24, y, 4, 54);
        this.txt(l, 38, y + 20, 13, WHITE, { alpha: 0.75, maxW: 280 });
        this.txt(v, 38, y + 46, 26, rgb, { bold: true, maxW: 280 });
        ctx0.restore();
      });
      // 右：年初来の推移（CSV）
      {
        const L = 350, R = PW - 22, T = 124, B = 340;
        const a = ease(sub(p, 0.15, 0.3));
        ctx0.save(); ctx0.globalAlpha *= a;
        this.txt('年初来の推移（前年末=100）', L, 112, 13, WHITE, { alpha: 0.7 });
        ctx0.fillStyle = 'rgba(255,255,255,0.04)'; ctx0.fillRect(L, T, R - L, B - T);
        const vs = s.ytdPath.map(q => q.v);
        const lo = Math.min(...vs, 100) - 1, hi = Math.max(...vs, 100) + 1;
        const yv = (v: number) => B - ((v - lo) / (hi - lo)) * (B - T);
        ctx0.strokeStyle = 'rgba(255,255,255,0.35)'; ctx0.lineWidth = 1;
        ctx0.beginPath(); ctx0.moveTo(L, yv(100)); ctx0.lineTo(R, yv(100)); ctx0.stroke();
        const k = ease(sub(p, 0.2, 0.8));
        const tEnd = s.ytdPath[s.ytdPath.length - 1].t * k;
        ctx0.strokeStyle = `rgba(${GREEN}, 0.95)`; ctx0.lineWidth = 2.2; ctx0.lineJoin = 'round';
        ctx0.beginPath();
        let first = true;
        for (const q of s.ytdPath) { if (q.t > tEnd) break; const x = L + q.t * (R - L); if (first) { ctx0.moveTo(x, yv(q.v)); first = false; } else ctx0.lineTo(x, yv(q.v)); }
        ctx0.stroke();
        ctx0.restore();
      }
      // 下：ボックス圏の過去ケース
      const a3 = ease(sub(p, 0.5, 0.7));
      ctx0.save(); ctx0.globalAlpha *= a3;
      const chip = [st.cycle, st.athDays !== null ? `ATH（${st.athDate}）から${st.athDays}日経過` : ''].filter(Boolean).join('　・　');
      if (chip) this.txt(chip, 24, 372, 15, WHITE, { alpha: 0.85, maxW: PW - 48 });
      if (st.caseN !== null && st.caseAth !== null && st.caseDd !== null) {
        this.txt(`ATH未更新が${st.caseFrom}〜${st.caseTo}日続いた過去ケース（n=${st.caseN}）の結末`, 24, 402, 14, WHITE, { alpha: 0.75, maxW: PW - 48 });
        const BW = PW - 48, tot = st.caseAth + st.caseDd || 1;
        const w1 = BW * (st.caseAth / tot) * ease(sub(p, 0.55, 0.85));
        const w2 = BW * (st.caseDd / tot) * ease(sub(p, 0.55, 0.85));
        ctx0.fillStyle = `rgba(${GREEN},0.9)`; ctx0.fillRect(24, 412, w1, 30);
        ctx0.fillStyle = `rgba(${AMBER},0.9)`; ctx0.fillRect(24 + w1, 412, w2, 30);
        this.txt(`ATH更新 ${st.caseAth}%`, 32, 433, 15, '0, 0, 0', { bold: true });
        this.txt(`DD-${st.caseDdLevel}%到達 ${st.caseDd}%`, 24 + BW - 8, 433, 15, '0, 0, 0', { bold: true, align: 'right' });
      }
      ctx0.restore();
      return;
    }
    if (md && id === 'bottom' && md.bottom) {
      const bt = md.bottom;
      this.heading('底値判定', '現在の下落が、底値として確定する確率', p);
      const a = ease(sub(p, 0.15, 0.4));
      ctx0.save(); ctx0.globalAlpha *= a;
      if (bt.excluded && bt.mdd !== null && bt.level !== null) {
        this.txt('判定対象外', 24, 190, 54, AMBER, { bold: true });
        this.txt(`現局面のMDDが ${bt.level}% に達していないため、判定の対象外です`, 24, 232, 17, WHITE, { alpha: 0.85, maxW: PW - 48 });
        const GX = 24, GW = PW - 48, GY = 300;
        ctx0.fillStyle = 'rgba(255,255,255,0.08)'; ctx0.fillRect(GX, GY, GW, 38);
        const fr = Math.min(1, Math.abs(bt.mdd) / Math.abs(bt.level)) * ease(sub(p, 0.4, 0.8));
        ctx0.fillStyle = `rgba(${AMBER},0.9)`; ctx0.fillRect(GX, GY, GW * fr, 38);
        ctx0.fillStyle = 'rgba(255,255,255,0.8)'; ctx0.fillRect(GX + GW - 2, GY - 10, 3, 58);
        this.txt('0%', GX, GY + 68, 14, WHITE, { alpha: 0.6 });
        this.txt(`判定ライン ${bt.level}%`, GX + GW, GY + 68, 14, WHITE, { alpha: 0.8, align: 'right' });
        this.txt(`現局面のMDD ${bt.mdd}%`, GX + 8, GY + 26, 17, '0, 0, 0', { bold: true });
      } else {
        const hasPie = bt.pHold !== null && bt.pBreak !== null;
        const textMaxW = hasPie ? PW - 48 - 170 : PW - 48;
        bt.lines.forEach((l, i) => this.wrap(l, textMaxW).forEach((ln, k) => this.txt(ln, 24, 150 + i * 60 + k * 30, 22, WHITE, { alpha: 0.95 })));
        if (hasPie) {
          const dcx = PW - 24 - 70, dcy = 196;
          if (bt.tierLabel) this.txt(bt.tierLabel, dcx, dcy - 92, 12, WHITE, { alpha: 0.6, align: 'center', maxW: 180 });
          this.drawDonut(dcx, dcy, 70, 42, [{ value: bt.pHold!, color: GREEN }, { value: bt.pBreak!, color: DOWN }], sub(p, 0.25, 0.7), { text: `${bt.pHold}%`, rgb: GREEN });
          const la = ease(sub(p, 0.55, 0.85));
          ctx0.save(); ctx0.globalAlpha *= la;
          ctx0.fillStyle = `rgba(${GREEN},0.9)`; ctx0.fillRect(dcx - 86, dcy + 86, 10, 10);
          this.txt(`底値維持 ${bt.pHold}%`, dcx - 70, dcy + 95, 13, WHITE, { alpha: 0.85, align: 'left' });
          ctx0.fillStyle = `rgba(${DOWN},0.9)`; ctx0.fillRect(dcx - 86, dcy + 104, 10, 10);
          this.txt(`底割れ ${bt.pBreak}%`, dcx - 70, dcy + 113, 13, WHITE, { alpha: 0.85, align: 'left' });
          ctx0.restore();
        }
      }
      ctx0.restore();
      return;
    }
    if (md && id === 'rolling') {
      this.heading('ローリングリターン', '基準日からさかのぼった各期間の騰落率（その期間、持ち続けた場合の成績）', p);
      const mx = Math.max(1, ...md.rolling.map(r => Math.abs(r.v)));
      md.rolling.forEach((r, i) => {
        const a = ease(sub(p, 0.08 + i * 0.07, 0.3 + i * 0.07));
        const y = 112 + i * 38;
        const w = Math.sqrt(Math.abs(r.v) / mx) * 360 * a;
        ctx0.save(); ctx0.globalAlpha *= Math.max(a, 0.001);
        this.txt(r.label, 24, y + 24, 19, WHITE, { alpha: 0.85, maxW: 80 });
        ctx0.fillStyle = `rgba(${kuro(r.v)},0.9)`; ctx0.fillRect(110, y + 4, Math.max(2, w), 26);
        this.txt(sg(r.v), 110 + Math.max(2, w) + 10, y + 26, 20, kuro(r.v), { bold: true, maxW: 130 });
        ctx0.restore();
      });
      if (md.ytdNote) {
        const a = ease(sub(p, 0.7, 0.9));
        ctx0.save(); ctx0.globalAlpha *= a;
        ctx0.fillStyle = 'rgba(255,255,255,0.07)'; ctx0.fillRect(24, 424, PW - 48, 46);
        ctx0.fillStyle = `rgba(${GREEN},0.95)`; ctx0.fillRect(24, 424, 4, 46);
        this.txt(`今年の年初来 ${sg(md.ytdNote.ytd)}`, 40, 454, 22, GREEN, { bold: true });
        this.txt(`同じ時点の過去${md.ytdNote.years}年中、${md.ytdNote.pct}%の年を上回るペース`, PW - 32, 454, 15, WHITE, { alpha: 0.85, align: 'right', maxW: 330 });
        ctx0.restore();
      }
      return;
    }
    if (md && id === 'forecast' && md.forecast) {
      const f = md.forecast;
      this.heading('年末までの見通し', '複数指標の加重合成（過去の実績にもとづく目安です）', p);
      const a0 = ease(sub(p, 0.08, 0.25));
      ctx0.save(); ctx0.globalAlpha *= a0;
      ctx0.fillStyle = 'rgba(255,255,255,0.08)'; ctx0.fillRect(24, 104, PW - 48, 54);
      ctx0.fillStyle = `rgba(${GREEN},0.95)`; ctx0.fillRect(24, 104, 4, 54);
      this.txt('総合予測', 40, 138, 18, WHITE, { alpha: 0.85 });
      this.txt(sg(f.total), 190, 142, 34, kuro(f.total), { bold: true });
      this.txt(`上昇確率 ${f.prob}%`, PW - 36, 142, 24, AMBER, { bold: true, align: 'right' });
      ctx0.restore();
      this.txt('指標', 24, 180, 11, WHITE, { alpha: 0.55 });
      this.txt('年末までの平均騰落率', 330, 180, 11, WHITE, { alpha: 0.55, align: 'center' });
      this.txt('上昇確率', 548, 180, 11, WHITE, { alpha: 0.55, align: 'right' });
      this.txt('重み', 626, 180, 11, WHITE, { alpha: 0.55, align: 'right' });
      const mx = Math.max(10, ...f.rows.map(r => Math.abs(r.mean ?? 0)));
      f.rows.forEach((r, i) => {
        const a = ease(sub(p, 0.2 + i * 0.07, 0.4 + i * 0.07));
        const y = 188 + i * 40;
        ctx0.save(); ctx0.globalAlpha *= Math.max(a, 0.001);
        const dim = r.mean === null;
        this.txt(r.name, 24, y + 22, 14, WHITE, { alpha: dim ? 0.4 : 0.9, maxW: 214 });
        if (dim) { this.txt('対象なし', 330, y + 22, 13, WHITE, { alpha: 0.4, align: 'center' }); }
        else {
          const cx = 330, half = 70;
          ctx0.fillStyle = 'rgba(255,255,255,0.06)'; ctx0.fillRect(cx - half, y + 4, half * 2, 24);
          const w = Math.min(1, Math.abs(r.mean!) / mx) * half * a;
          ctx0.fillStyle = `rgba(${kuro(r.mean!)},0.9)`;
          if (r.mean! >= 0) ctx0.fillRect(cx, y + 6, w, 20); else ctx0.fillRect(cx - w, y + 6, w, 20);
          ctx0.fillStyle = 'rgba(255,255,255,0.45)'; ctx0.fillRect(cx - 1, y + 2, 2, 28);
          this.txt(sg(r.mean!), cx + half + 10, y + 24, 17, kuro(r.mean!), { bold: true, maxW: 80 });
          this.txt(`${r.prob}%`, 548, y + 24, 16, WHITE, { alpha: 0.9, align: 'right' });
          this.txt(`${r.weight}%`, 626, y + 24, 14, WHITE, { alpha: 0.6, align: 'right' });
        }
        ctx0.restore();
      });
      return;
    }

    if (md && id === 'basis10' && this.cfg.basis) {
      const bs = this.cfg.basis;
      const rec = bs.recent;
      const row = md.forecast?.rows.find(x => /直近10年平均/.test(x.name));
      this.heading('年末見通しの根拠①　直近10年平均', '直近10年の各年の推移（前年末=100）と、今年の比較', p);
      const a0 = ease(sub(p, 0.05, 0.2));
      const up = rec.filter(x => x.ret > 0).length;
      const avg = rec.reduce((x, y) => x + y.ret, 0) / Math.max(1, rec.length);
      ctx0.save(); ctx0.globalAlpha *= a0;
      ctx0.fillStyle = 'rgba(255,255,255,0.08)'; ctx0.fillRect(24, 100, PW - 48, 50);
      ctx0.fillStyle = `rgba(${GREEN},0.95)`; ctx0.fillRect(24, 100, 4, 50);
      this.txt('直近10年平均', 40, 132, 16, WHITE, { alpha: 0.85 });
      this.txt(sg(row?.mean ?? avg), 176, 135, 30, kuro(row?.mean ?? avg), { bold: true });
      this.txt(`上昇確率 ${row?.prob ?? Math.round((up / Math.max(1, rec.length)) * 100)}%（${up}/${rec.length}年）`, PW - 36, 122, 16, AMBER, { bold: true, align: 'right', maxW: 250 });
      if (row?.weight !== null && row?.weight !== undefined) this.txt(`重み ${row.weight}%`, PW - 36, 142, 12, WHITE, { alpha: 0.65, align: 'right' });
      ctx0.restore();
      // 折れ線（直近10年＋平均の推移＋今年）
      const L = 46, R = PW - 20, T = 164, B = 332;
      ctx0.fillStyle = 'rgba(255,255,255,0.04)'; ctx0.fillRect(L, T, R - L, B - T);
      const grid: number[] = [];
      for (let k = 0; k <= 200; k++) grid.push(k / 200);
      const avgPath = grid.map(t => ({ t, v: rec.reduce((acc, r2) => acc + valueAt(r2.pts ?? [], t), 0) / Math.max(1, rec.length) }));
      const all = [...rec.flatMap(r2 => (r2.pts ?? []).map(q => q.v)), ...bs.curPath.map(q => q.v)];
      const lo = Math.floor(Math.max(50, Math.min(...all, 90)) / 10) * 10, hi = Math.ceil(Math.min(160, Math.max(...all, 110)) / 10) * 10;
      const yv = (v: number) => B - ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (B - T);
      const step = hi - lo > 60 ? 20 : 10;
      for (let v = lo; v <= hi; v += step) {
        ctx0.strokeStyle = v === 100 ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.1)'; ctx0.lineWidth = 1;
        ctx0.beginPath(); ctx0.moveTo(L, yv(v)); ctx0.lineTo(R, yv(v)); ctx0.stroke();
        this.txt(String(v), L - 6, yv(v) + 4, 11, WHITE, { alpha: 0.55, align: 'right' });
      }
      for (let m = 0; m < 12; m++) this.txt(`${m + 1}月`, L + ((m + 0.5) / 12) * (R - L), B + 15, 11, WHITE, { alpha: 0.55, align: 'center' });
      const k = ease(sub(p, 0.1, 0.62));
      const drawLine = (pts: { t: number; v: number }[], tMax: number, rgb: string, w: number, alpha: number, dash = false, glow = false) => {
        ctx0.save(); ctx0.lineJoin = 'round'; ctx0.strokeStyle = `rgba(${rgb},${alpha})`; ctx0.lineWidth = w;
        if (dash) ctx0.setLineDash([6, 4]);
        if (glow) { ctx0.shadowColor = `rgba(${rgb},0.55)`; ctx0.shadowBlur = 7; }
        ctx0.beginPath(); let f = true; let last: { t: number; v: number } | null = null;
        for (const q of pts) { if (q.t > tMax) break; const x = L + q.t * (R - L); if (f) { ctx0.moveTo(x, yv(q.v)); f = false; } else ctx0.lineTo(x, yv(q.v)); last = q; }
        ctx0.stroke(); ctx0.restore();
        return last;
      };
      rec.forEach(r2 => drawLine(r2.pts ?? [], k, r2.ret >= 0 ? GREEN : DOWN, 1.2, 0.4));
      drawLine(avgPath, k, WHITE, 2.4, 0.95, true);
      const kc = ease(sub(p, 0.4, 0.85)) * (bs.curPath[bs.curPath.length - 1]?.t ?? 0);
      const head = drawLine(bs.curPath, kc, GREEN, 3.2, 1, false, true);
      if (head) { ctx0.fillStyle = `rgba(${GREEN},1)`; ctx0.beginPath(); ctx0.arc(L + head.t * (R - L), yv(head.v), 4.5, 0, Math.PI * 2); ctx0.fill(); }
      // 凡例
      this.txt(`— ${bs.curYear}年（今年）`, L + 8, T + 16, 13, GREEN, { bold: true });
      this.txt('- - 10年平均の推移', L + 140, T + 16, 13, WHITE, { bold: true, alpha: 0.9 });
      this.txt('細線：直近10年（緑=上昇／青=下落）', R - 6, T + 16, 11, WHITE, { alpha: 0.6, align: 'right', maxW: 190 });
      // 根拠：各年の暦年騰落率
      const ca = ease(sub(p, 0.6, 0.85));
      ctx0.save(); ctx0.globalAlpha *= ca;
      this.txt('根拠（参照年の暦年騰落率）', 24, 372, 12, WHITE, { alpha: 0.65 });
      const CWd = 114, GAP = 7;
      rec.forEach((r2, i) => {
        const col = i % 5, rw = Math.floor(i / 5);
        const x = 24 + col * (CWd + GAP), y = 380 + rw * 30;
        ctx0.fillStyle = 'rgba(255,255,255,0.07)'; ctx0.fillRect(x, y, CWd, 25);
        this.txt(`${r2.year}：${sg(r2.ret)}`, x + CWd / 2, y + 18, 14, r2.ret >= 0 ? GREEN : DOWN, { bold: true, align: 'center', maxW: CWd - 6 });
      });
      ctx0.restore();
      const sa = ease(sub(p, 0.78, 0.95));
      this.txt(`10年の暦年騰落率の平均 ${sg(avg)}　→　年末見通しの根拠の1つ`, PW - 24, 462, 13, AMBER, { bold: true, align: 'right', alpha: sa, maxW: PW - 48 });
      return;
    }
    if (md && id === 'basisCycle' && this.cfg.basis) {
      const bs = this.cfg.basis;
      const row = md.forecast?.rows.find(x => /大統領サイクル平均/.test(x.name));
      this.heading('年末見通しの根拠②　大統領サイクル', `${md.status?.cycle ?? ''}　同じ区分の過去${bs.cycle.length}年と、今年の推移`, p);
      const L = 46, R = PW - 20, T = 108, B = 292;
      ctx0.fillStyle = 'rgba(255,255,255,0.04)'; ctx0.fillRect(L, T, R - L, B - T);
      const all = bs.cycle.flatMap(c => c.pts.map(q => q.v));
      const lo = Math.floor(Math.max(40, Math.min(...all, 90)) / 20) * 20, hi = Math.ceil(Math.min(180, Math.max(...all, 110)) / 20) * 20;
      const yv = (v: number) => B - ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (B - T);
      for (let v = lo; v <= hi; v += 20) {
        ctx0.strokeStyle = v === 100 ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.1)'; ctx0.lineWidth = 1;
        ctx0.beginPath(); ctx0.moveTo(L, yv(v)); ctx0.lineTo(R, yv(v)); ctx0.stroke();
        this.txt(String(v), L - 6, yv(v) + 4, 11, WHITE, { alpha: 0.55, align: 'right' });
      }
      for (let m = 0; m < 12; m++) this.txt(`${m + 1}月`, L + ((m + 0.5) / 12) * (R - L), B + 16, 11, WHITE, { alpha: 0.55, align: 'center' });
      const k = ease(sub(p, 0.08, 0.6));
      ctx0.save(); ctx0.lineJoin = 'round';
      bs.cycle.forEach(c => {
        ctx0.strokeStyle = 'rgba(200,210,225,0.38)'; ctx0.lineWidth = 1;
        ctx0.beginPath(); let f = true;
        for (const q of c.pts) { if (q.t > k) break; const x = L + q.t * (R - L); if (f) { ctx0.moveTo(x, yv(q.v)); f = false; } else ctx0.lineTo(x, yv(q.v)); }
        ctx0.stroke();
      });
      const kc = ease(sub(p, 0.3, 0.8)) * (bs.curPath[bs.curPath.length - 1]?.t ?? 0);
      ctx0.strokeStyle = `rgba(${GREEN},1)`; ctx0.lineWidth = 3; ctx0.shadowColor = `rgba(${GREEN},0.5)`; ctx0.shadowBlur = 6;
      ctx0.beginPath(); let f2 = true;
      for (const q of bs.curPath) { if (q.t > kc) break; const x = L + q.t * (R - L); if (f2) { ctx0.moveTo(x, yv(q.v)); f2 = false; } else ctx0.lineTo(x, yv(q.v)); }
      ctx0.stroke(); ctx0.restore();
      { const hp = [...bs.curPath].reverse().find(q => q.t <= kc); if (hp) { ctx0.fillStyle = `rgba(${GREEN},1)`; ctx0.beginPath(); ctx0.arc(L + hp.t * (R - L), yv(hp.v), 4.5, 0, Math.PI * 2); ctx0.fill(); } }
      this.txt(`— ${bs.curYear}年（今年）`, R - 4, T + 18, 14, GREEN, { bold: true, align: 'right' });
      // 参照年の騰落率（根拠）
      const ca = ease(sub(p, 0.6, 0.85));
      ctx0.save(); ctx0.globalAlpha *= ca;
      this.txt('根拠（参照年の暦年騰落率）', 24, 330, 12, WHITE, { alpha: 0.65 });
      const CWd = 94, GAP = 6;
      bs.cycle.forEach((c, i) => {
        const col = i % 6, rw = Math.floor(i / 6);
        const x = 24 + col * (CWd + GAP), y = 338 + rw * 28;
        ctx0.fillStyle = 'rgba(255,255,255,0.07)'; ctx0.fillRect(x, y, CWd, 23);
        this.txt(`${c.year}：${sg(c.ret)}`, x + CWd / 2, y + 17, 12, c.ret >= 0 ? GREEN : DOWN, { bold: true, align: 'center', maxW: CWd - 6 });
      });
      ctx0.restore();
      const sa = ease(sub(p, 0.75, 0.95));
      ctx0.save(); ctx0.globalAlpha *= sa;
      if (row && row.mean !== null) {
        this.txt(`平均 ${sg(row.mean)}`, 24, 458, 22, kuro(row.mean), { bold: true });
        this.txt(`上昇確率 ${row.prob}%（n=${row.n}）`, 190, 458, 17, AMBER, { bold: true });
      }
      const mo = md.forecast?.monthly ?? [];
      if (mo.length) this.txt('月別　' + mo.map(x => `${x.m}月 ${sg(x.v)}`).join('　'), PW - 24, 458, 14, WHITE, { alpha: 0.8, align: 'right', maxW: 250 });
      ctx0.restore();
      return;
    }
    if (md && id === 'ddpace' && md.ddpace) {
      const dp = md.ddpace;
      this.heading('DD局面とATH更新ペース', '最高値からの下落の深さ別に見た、回復までの実績', p);
      const a0 = ease(sub(p, 0.08, 0.25));
      ctx0.save(); ctx0.globalAlpha *= a0;
      if (dp.athCount) this.txt(`ATH更新：全期間 ${dp.athCount}回（年平均 ${dp.perYear}回・平均 ${dp.every}日に1度）`, 24, 124, 17, GREEN, { bold: true, maxW: PW - 100 });
      {
        const totalN = dp.buckets.reduce((acc, b) => acc + b.n, 0);
        if (totalN > 0) {
          const wClean = dp.buckets.reduce((acc, b) => acc + b.clean * b.n, 0) / totalN;
          const cleanRgb = wClean >= 60 ? GREEN : wClean >= 30 ? AMBER : DOWN;
          this.drawDonut(PW - 44, 110, 24, 14, [{ value: wClean, color: cleanRgb }, { value: 100 - wClean, color: '120,130,150' }], a0, { text: `${Math.round(wClean)}%`, rgb: cleanRgb });
        }
      }
      this.txt('下落の深さ', 24, 156, 11, WHITE, { alpha: 0.55 });
      this.txt('件数', 168, 156, 11, WHITE, { alpha: 0.55, align: 'right' });
      this.txt('平均下落日数', 262, 156, 11, WHITE, { alpha: 0.55, align: 'right' });
      this.txt('クリーン回復率', 280, 156, 11, WHITE, { alpha: 0.55 });
      ctx0.restore();
      dp.buckets.forEach((b, i) => {
        const a = ease(sub(p, 0.2 + i * 0.07, 0.42 + i * 0.07));
        const y = 164 + i * 40;
        ctx0.save(); ctx0.globalAlpha *= Math.max(a, 0.001) * (b.ref ? 0.65 : 1);
        this.txt(b.range.replace('〜', ' 〜 '), 24, y + 24, 16, WHITE, { bold: true, maxW: 120 });
        this.txt(`${b.n}件`, 168, y + 24, 15, WHITE, { alpha: 0.85, align: 'right' });
        this.txt(`${b.days}日`, 262, y + 24, 15, WHITE, { alpha: 0.85, align: 'right' });
        ctx0.fillStyle = 'rgba(255,255,255,0.07)'; ctx0.fillRect(280, y + 6, 270, 24);
        ctx0.fillStyle = `rgba(${b.clean >= 60 ? GREEN : b.clean >= 30 ? AMBER : DOWN},0.9)`; ctx0.fillRect(280, y + 6, 270 * (b.clean / 100) * a, 24);
        this.txt(`${b.clean}%`, 558, y + 26, 17, WHITE, { bold: true });
        if (b.ref) this.txt('参考', 642, y + 24, 10, WHITE, { alpha: 0.7, align: 'right' });
        ctx0.restore();
      });
      ctx0.save(); ctx0.globalAlpha *= ease(sub(p, 0.75, 0.95));
      this.txt(`DD局面件数（全履歴）${dp.phases ?? '—'}件　※「参考」は件数が少ない参考値`, 24, 462, 12, WHITE, { alpha: 0.6, maxW: PW - 48 });
      ctx0.restore();
      return;
    }
    if (md && id === 'crashmd') {
      this.heading('暴落の発生確率と発生後のリターン', 'DDが節目を超える頻度と、その後の平均リターン', p);
      const hy = 126;
      const hd: [string, number, CanvasTextAlign][] = [['節目', 24, 'left'], ['発生', 152, 'right'], ['間隔', 224, 'right'], ['前回発生', 234, 'left'], ['今後1年以内の確率', 346, 'left'], ['発生後1年', 524, 'right'], ['3年', 584, 'right'], ['5年', 640, 'right']];
      ctx0.save(); ctx0.globalAlpha *= ease(sub(p, 0.05, 0.2));
      hd.forEach(([t, x, al]) => this.txt(t, x, hy, 11, WHITE, { alpha: 0.55, align: al }));
      ctx0.restore();
      const mxp = Math.max(10, ...md.crash.map(c => c.prob));
      md.crash.forEach((c, i) => {
        const a = ease(sub(p, 0.12 + i * 0.07, 0.34 + i * 0.07));
        const y = 134 + i * 41;
        ctx0.save(); ctx0.globalAlpha *= Math.max(a, 0.001) * (c.ref ? 0.65 : 1);
        ctx0.fillStyle = i % 2 ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.06)'; ctx0.fillRect(18, y, PW - 36, 37);
        this.txt(`DD-${c.level}%超`, 24, y + 24, 15, WHITE, { bold: true, maxW: 96 });
        this.txt(c.count, 152, y + 24, 13, WHITE, { alpha: 0.8, align: 'right', maxW: 44 });
        this.txt(c.interval, 224, y + 24, 12, WHITE, { alpha: 0.85, align: 'right', maxW: 64 });
        this.txt(c.last, 234, y + 24, 11, WHITE, { alpha: 0.7, maxW: 108 });
        ctx0.fillStyle = `rgba(${c.level >= 20 ? DOWN : AMBER},0.9)`; ctx0.fillRect(346, y + 10, 70 * (c.prob / mxp) * a, 18);
        this.txt(`${c.prob}%`, 346 + 70 * (c.prob / mxp) * a + 6, y + 25, 14, WHITE, { bold: true, maxW: 60 });
        [[c.a1, 524], [c.a3, 584], [c.a5, 640]].forEach(([v, x]) => this.txt(String(v), x as number, y + 24, 13, String(v).startsWith('-') ? DOWN : UP, { bold: true, align: 'right', maxW: 54 }));
        ctx0.restore();
      });
      ctx0.save(); ctx0.globalAlpha *= ease(sub(p, 0.8, 0.95));
      this.txt('※発生件数が少ない節目は参考値。過去の実績であり、将来を保証するものではありません。', 24, 470, 11, WHITE, { alpha: 0.55, maxW: PW - 48 });
      ctx0.restore();
      return;
    }
    if (md && id === 'daily' && md.daily) {
      const dl = md.daily;
      this.heading('日次リターンの分布', '1日の騰落率ごとの割合', p);
      const a0 = ease(sub(p, 0.08, 0.25));
      ctx0.save(); ctx0.globalAlpha *= a0;
      this.txt('上昇日', 24, 134, 14, WHITE, { alpha: 0.7 }); this.txt(`${dl.up}%`, 24, 168, 32, UP, { bold: true });
      this.txt('下落日', 190, 134, 14, WHITE, { alpha: 0.7 }); this.txt(`${dl.down}%`, 190, 168, 32, DOWN, { bold: true });
      this.txt('平均日次リターン', 356, 134, 14, WHITE, { alpha: 0.7 }); this.txt(sg(dl.avg, 3), 356, 168, 32, kuro(dl.avg), { bold: true });
      ctx0.restore();
      this.drawDonut(596, 150, 40, 24, [{ value: dl.up, color: UP }, { value: dl.down, color: DOWN }], sub(p, 0.15, 0.55), { text: `${dl.up}%`, rgb: UP });
      const n = dl.buckets.length || 1, CL = 30, CR = PW - 30, B = 430, T = 214;
      const mx = Math.max(10, ...dl.buckets.map(b => b.v));
      const bw = (CR - CL) / n;
      ctx0.fillStyle = 'rgba(255,255,255,0.3)'; ctx0.fillRect(CL, B, CR - CL, 1.5);
      dl.buckets.forEach((b, i) => {
        const a = ease(sub(p, 0.2 + i * 0.07, 0.5 + i * 0.07));
        const h = (b.v / mx) * (B - T - 24) * a;
        const x = CL + i * bw + bw * 0.14;
        ctx0.fillStyle = `rgba(${b.label.startsWith('-') ? DOWN : UP},0.88)`;
        ctx0.fillRect(x, B - h, bw * 0.72, h);
        this.txt(`${b.v}%`, x + bw * 0.36, B - h - 8, 18, WHITE, { bold: true, align: 'center', alpha: a, maxW: bw });
        this.txt(b.label, x + bw * 0.36, B + 22, 13, WHITE, { alpha: 0.8, align: 'center', maxW: bw - 4 });
      });
      return;
    }
    if (id === 'end') {
      this.heading('今回のまとめ', `${s.year}年${s.month}月${s.day}日時点（米国時間）`, p);
      const o2 = s.outlook;
      const sgn = (v: number) => `${v >= 0 ? '+' : '-'}${Math.abs(v).toFixed(1)}%`;
      const mdf = (d: string) => `${parseInt(d.slice(5, 7), 10)}/${parseInt(d.slice(8, 10), 10)}`;
      const items: [string, string, string, string][] = [
        ['年初来', fmtPct(s.ytd), rgbOf(s.ytd), `過去平均 ${sgn(s.ytdAvg)}`],
        ['ATHから', fmtPct(s.dd), s.dd < -0.005 ? DOWN : GREEN, s.dd < -0.005 ? `直近 ${mdf(s.athDate)}・${s.athDays}日経過` : '本日ATH更新'],
        ['今年のATH更新', `${s.athCount}回`, GREEN, `過去平均 ${s.athAvg.toFixed(1)}回`],
        ['上昇日', `${s.up}日`, UP, `過去平均 ${s.upAvg.toFixed(0)}日`],
        ['下落日', `${s.down}日`, DOWN, `過去平均 ${s.downAvg.toFixed(0)}日`],
        ['年末まで上昇する確率', `${o2.posProb.toFixed(1)}%`, AMBER, `過去${o2.n}年中${o2.posCount}年`],
      ];
      if (md) {
        items.length = 0;
        const st = md.status, fc = md.forecast, c10 = md.crash.find(c => c.level === 10), c20 = md.crash.find(c => c.level === 20), dl = md.daily;
        if (st) { items.push(['年初来', sg(st.ytd), kuro(st.ytd), st.oneYear !== null ? `直近1年 ${sg(st.oneYear)}` : '']); items.push(['ATHから', sg(st.dd), st.dd < -0.005 ? DOWN : GREEN, st.mode]); }
        if (fc) items.push(['年末までの総合予測', sg(fc.total), kuro(fc.total), `上昇確率 ${fc.prob}%`]);
        if (c10) items.push(['-10%の調整', c10.interval, AMBER, c10.last ? `前回 ${c10.last.replace(/[（(].*$/, "")}` : '']);
        if (c20) items.push(['-20%の弱気相場', c20.interval, DOWN, c20.last ? `前回 ${c20.last.replace(/[（(].*$/, "")}` : '']);
        if (dl) items.push(['上昇日／下落日', `${dl.up}%／${dl.down}%`, WHITE, `平均日次 ${sg(dl.avg, 3)}`]);
      }
      const G = 8, CW = (PW - 48 - G) / 2, CH = 54;
      items.forEach(([label, val, rgb, note], i) => {
        const col = i % 2, row = Math.floor(i / 2);
        const a = ease(sub(p, 0.1 + i * 0.07, 0.28 + i * 0.07));
        const x = 24 + col * (CW + G), y = 104 + row * (CH + G);
        ctx.save();
        ctx.globalAlpha *= a;
        ctx.translate(0, (1 - a) * 10);
        ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fillRect(x, y, CW, CH);
        ctx.fillStyle = `rgba(${rgb}, 0.95)`; ctx.fillRect(x, y, 4, CH);
        this.txt(label, x + 14, y + 19, 13, WHITE, { alpha: 0.8, maxW: CW - 24 });
        this.txt(val, x + 14, y + 46, 26, rgb, { bold: true, maxW: 140 });
        if (note) this.txt(note, x + CW - 10, y + 46, 13, WHITE, { alpha: 0.65, align: 'right', maxW: CW - 170 });
        ctx.restore();
      });
      // ご留意事項
      ctx.save();
      ctx.globalAlpha *= ease(sub(p, 0.5, 0.7));
      const top = 104 + Math.ceil(items.length / 2) * (CH + G) + 6;
      ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(24, top, PW - 48, 1);
      this.txt('【ご留意事項】', 24, top + 16, 11, WHITE, { bold: true, alpha: 0.75 });
      this.font(10);
      const notes = [`S&P500（VOO）の米国時間${s.asOf.replace(/-/g, '/')}時点のデータ。評価額は表示せず、騰落率で表現しています。`, ...DISCLAIMERS];
      let yy = top + 30;
      notes.forEach(n => { this.font(10); this.wrap(n, PW - 48 - 10).forEach((l, k) => { this.txt((k === 0 ? '・' : '　') + l, 24, yy, 10, WHITE, { alpha: 0.6 }); yy += 13; }); });
      ctx.restore();
      return;
    }
    if (id === 'dayChange') {
      // [Stage D-6] 冒頭「前日比」スライド。前日比・現在のDD・その節目の発生頻度＋カテゴリー名
      // （最高値更新中はDD文の代わりに「最高値を更新しました」）・直近7営業日の折れ線（最初の点=0%基準）を表示する。
      const dc = md?.dayChange;
      if (!dc) { this.heading('近況：前日比', `${DATE}（米国時間）基準`, p); return; }
      this.heading('近況：前日比', `${DATE}（米国時間）基準`, p);
      const chgColor = dc.pct >= 0 ? UP : DOWN;
      ctx0.save(); ctx0.globalAlpha *= ease(sub(p, 0.05, 0.25));
      this.txt(`前日比 ${sg(dc.pct)}`, 24, 156, 48, chgColor, { bold: true });
      ctx0.restore();

      ctx0.save(); ctx0.globalAlpha *= ease(sub(p, 0.22, 0.42));
      if (dc.isNewAth) {
        this.txt('最高値を更新しました', 24, 206, 22, GREEN, { bold: true, maxW: PW - 48 });
      } else {
        this.txt(`現在のDD（ドローダウン） ${dc.ddPct.toFixed(1)}%`, 24, 206, 20, DOWN, { bold: true, maxW: 340 });
        if (dc.category.freqLabel) this.txt(`${dc.category.freqLabel}発生する`, PW - 24, 184, 13, WHITE, { alpha: 0.75, align: 'right', maxW: 300 });
        this.txt(`「${dc.category.label}」`, PW - 24, 210, 22, AMBER, { bold: true, align: 'right', maxW: 300 });
      }
      ctx0.restore();

      const pts7 = dc.recent7 ?? [];
      if (pts7.length >= 2) {
        const L = 24, R = PW - 24, T = 248, B = 452;
        ctx0.fillStyle = 'rgba(255,255,255,0.04)'; ctx0.fillRect(L, T, R - L, B - T);
        const base = pts7[0].price;
        const changes = pts7.map(pt => base !== 0 ? ((pt.price / base) - 1) * 100 : 0);
        const maxAbs = Math.max(2, ...changes.map(v => Math.abs(v))) * 1.25;
        const yv = (v: number) => T + ((maxAbs - v) / (maxAbs * 2)) * (B - T);
        ctx0.strokeStyle = 'rgba(255,255,255,0.4)'; ctx0.lineWidth = 1;
        ctx0.beginPath(); ctx0.moveTo(L, yv(0)); ctx0.lineTo(R, yv(0)); ctx0.stroke();
        this.txt('0%（7営業日前）', L + 2, yv(0) - 6, 10, WHITE, { alpha: 0.5 });

        const n = pts7.length;
        const xAt = (i: number) => L + (i / (n - 1)) * (R - L);
        const netChg = changes[n - 1];
        const lineColor = netChg >= 0 ? UP : DOWN;
        const k = ease(sub(p, 0.4, 0.92));
        const visibleCount = Math.max(1, Math.min(n, Math.round(k * (n - 1)) + 1));

        ctx0.save(); ctx0.strokeStyle = `rgba(${lineColor},1)`; ctx0.lineWidth = 2.4; ctx0.lineJoin = 'round';
        ctx0.beginPath();
        for (let i = 0; i < visibleCount; i++) { const x = xAt(i), y = yv(changes[i]); if (i === 0) ctx0.moveTo(x, y); else ctx0.lineTo(x, y); }
        ctx0.stroke(); ctx0.restore();

        for (let i = 0; i < visibleCount; i++) {
          const x = xAt(i), y = yv(changes[i]);
          ctx0.fillStyle = `rgba(${lineColor},1)`;
          ctx0.beginPath(); ctx0.arc(x, y, 3.5, 0, Math.PI * 2); ctx0.fill();
          const dtm = pts7[i].date.match(/^\d{4}-(\d{2})-(\d{2})$/);
          const label = dtm ? `${parseInt(dtm[1], 10)}/${parseInt(dtm[2], 10)}` : pts7[i].date;
          this.txt(label, x, B + 16, 10, WHITE, { alpha: 0.55, align: 'center' });
        }
        if (visibleCount === n) {
          const lastX = xAt(n - 1), lastY = yv(changes[n - 1]);
          this.txt(sg(netChg), lastX, lastY - 12, 13, lineColor, { bold: true, align: 'center' });
        }
      }
      return;
    }
    if (id === 'ytdChange') {
      // 2026-10-22のユーザー指示により、棒グラフ（今年/過去の平均/過去の中央値の単純比較）から
      // 動的な折れ線グラフ（今年の年初来推移と、過去の平均・中央値の推移を重ねる）に変更。
      // 系列データはbasis10/basisCycleと同じthis.cfg.basis（LongBasis）を再利用する
      // （drawOverlayChartはStage D-4のカスタム場面用に追加した汎用メソッドで、見た目はbasis10と同系統）。
      const bs = this.cfg.basis;
      if (bs && bs.recent.length) {
        const grid: number[] = [];
        for (let k = 0; k <= 200; k++) grid.push(k / 200);
        const avgPath = grid.map(t => ({ t, v: bs.recent.reduce((acc, r) => acc + valueAt(r.pts ?? [], t), 0) / Math.max(1, bs.recent.length) }));
        const medianPath = grid.map(t => {
          const vals = bs.recent.map(r => valueAt(r.pts ?? [], t)).sort((a, b) => a - b);
          const n = vals.length;
          const mid = Math.floor(n / 2);
          return { t, v: n % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2 };
        });
        this.drawOverlayChart(
          '近況：騰落率',
          `過去${s.pastYtd.length}年の同時期と比べる`,
          [
            { label: `${s.year}年（今年）`, pts: bs.curPath, style: 'solid', emphasis: true, rgb: GREEN },
            { label: '過去の平均の推移', pts: avgPath, style: 'dashed', emphasis: false, rgb: WHITE },
            { label: '過去の中央値の推移', pts: medianPath, style: 'dashed', emphasis: false, rgb: AMBER },
          ],
          'pct',
          p
        );
        ctx0.save(); ctx0.globalAlpha *= ease(sub(p, 0.6, 0.8));
        this.txt(`過去${s.pastYtd.length + 1}年中 ${s.ytdRank}位`, 24, 372, 26, GREEN, { bold: true });
        this.txt(`前日比 ${sg(s.dayChange)}　上昇日の割合 ${s.upRatio.toFixed(1)}%（過去平均 ${s.upRatioAvg.toFixed(1)}%）`, 24, 404, 15, WHITE, { alpha: 0.8, maxW: PW - 48 });
        ctx0.restore();
        return;
      }
      // フォールバック：basisデータが無い場合（データ不足等）は従来の棒グラフ比較を表示
      this.heading('近況：騰落率', `過去${s.pastYtd.length}年の同時期と比べる`, p);
      const limY = Math.max(Math.abs(s.ytd), Math.abs(s.ytdAvg), Math.abs(s.ytdMedian), 5) * 1.15;
      const rowsY: [string, number][] = [[`今年（${s.year}年）`, s.ytd], ['過去の平均', s.ytdAvg], ['過去の中央値', s.ytdMedian]];
      rowsY.forEach(([l, v], i) => this.hbar(l, v, limY, 140 + i * 70, sub(p, 0.12 + i * 0.12, 0.5 + i * 0.12), fmtPct(v)));
      ctx0.save(); ctx0.globalAlpha *= ease(sub(p, 0.6, 0.8));
      this.txt(`過去${s.pastYtd.length + 1}年中 ${s.ytdRank}位`, 24, 400, 36, GREEN, { bold: true });
      this.txt(`前日比 ${sg(s.dayChange)}　上昇日の割合 ${s.upRatio.toFixed(1)}%（過去平均 ${s.upRatioAvg.toFixed(1)}%）`, 24, 438, 17, WHITE, { alpha: 0.8, maxW: PW - 48 });
      ctx0.restore();
      return;
    }
    if (id === 'athDrop') {
      // 2026-10-22のユーザー指示により、上側の棒グラフ・文章を詰めて、空いた下側に当年の
      // ドローダウン（ATHからの下落率）の推移を動的な面グラフで表示するよう変更。
      // 最大下落・現在値をハイライトする。データはstats.ddPath（既存、当年の下落率の推移）を使う。
      this.heading('近況：ATHからの下落率', `${DATE}（米国時間）基準`, p);
      const limA = Math.max(10, Math.abs(s.ddMin) * 1.3);
      this.hbar('現在の最高値からの下落', s.dd, limA, 108, sub(p, 0.06, 0.3), `${s.dd.toFixed(1)}%`);
      this.hbar('今年の最大下落', s.ddMin, limA, 160, sub(p, 0.1, 0.34), `${s.ddMin.toFixed(1)}%`);
      ctx0.save(); ctx0.globalAlpha *= ease(sub(p, 0.3, 0.45));
      this.txt(s.dd >= -0.005 ? '最高値を更新中です' : `最高値更新から ${s.athDays}日経過`, 24, 222, 19, WHITE, { bold: true, maxW: PW - 48 });
      this.txt(`今年の最高値更新 ${s.athCount}回（過去平均 約${Math.max(1, Math.round(s.athAvg))}回）`, 24, 248, 14, WHITE, { alpha: 0.8, maxW: PW - 48 });
      ctx0.restore();

      const ddPts = s.ddPath ?? [];
      if (ddPts.length > 1) {
        const L = 24, R = PW - 24, T = 272, B = 452;
        ctx0.fillStyle = 'rgba(255,255,255,0.04)'; ctx0.fillRect(L, T, R - L, B - T);
        const minDd = Math.min(...ddPts.map(q => q.dd), s.ddMin, -2);
        const yv = (v: number) => T + ((0 - v) / (0 - minDd)) * (B - T);
        ctx0.strokeStyle = 'rgba(255,255,255,0.4)'; ctx0.lineWidth = 1;
        ctx0.beginPath(); ctx0.moveTo(L, yv(0)); ctx0.lineTo(R, yv(0)); ctx0.stroke();
        this.txt('0%', L + 2, yv(0) - 5, 10, WHITE, { alpha: 0.5 });
        this.txt(`${minDd.toFixed(0)}%`, L + 2, B - 4, 10, WHITE, { alpha: 0.5 });
        for (let m = 0; m < 12; m++) this.txt(`${m + 1}月`, L + ((m + 0.5) / 12) * (R - L), B + 14, 10, WHITE, { alpha: 0.5, align: 'center' });

        const k = ease(sub(p, 0.45, 0.92));
        const tMax = k * (ddPts[ddPts.length - 1]?.t ?? 1);
        const visible = ddPts.filter(q => q.t <= tMax);
        if (visible.length) {
          ctx0.save();
          ctx0.beginPath();
          ctx0.moveTo(L + visible[0].t * (R - L), yv(0));
          visible.forEach(q => ctx0.lineTo(L + q.t * (R - L), yv(q.dd)));
          ctx0.lineTo(L + visible[visible.length - 1].t * (R - L), yv(0));
          ctx0.closePath();
          ctx0.fillStyle = `rgba(${DOWN},0.22)`;
          ctx0.fill();
          ctx0.restore();

          ctx0.save(); ctx0.strokeStyle = `rgba(${DOWN},1)`; ctx0.lineWidth = 2.4; ctx0.lineJoin = 'round';
          ctx0.beginPath();
          visible.forEach((q, i) => { const x = L + q.t * (R - L); if (i === 0) ctx0.moveTo(x, yv(q.dd)); else ctx0.lineTo(x, yv(q.dd)); });
          ctx0.stroke(); ctx0.restore();

          const maxPt = ddPts.reduce((a, b) => (b.dd < a.dd ? b : a), ddPts[0]);
          if (maxPt.t <= tMax) {
            const mx = L + maxPt.t * (R - L), my = yv(maxPt.dd);
            const ma = ease(sub(p, 0.7, 0.9));
            ctx0.save(); ctx0.globalAlpha *= ma;
            ctx0.fillStyle = `rgba(${AMBER},1)`; ctx0.beginPath(); ctx0.arc(mx, my, 5, 0, Math.PI * 2); ctx0.fill();
            this.txt(`最大 ${maxPt.dd.toFixed(1)}%`, mx, my - 12, 12, AMBER, { bold: true, align: 'center' });
            ctx0.restore();
          }

          const curPt = ddPts[ddPts.length - 1];
          if (curPt && curPt.t <= tMax) {
            const cx = L + curPt.t * (R - L), cy = yv(curPt.dd);
            const ca = ease(sub(p, 0.82, 0.98));
            ctx0.save(); ctx0.globalAlpha *= ca;
            ctx0.fillStyle = `rgba(${GREEN},1)`; ctx0.beginPath(); ctx0.arc(cx, cy, 5, 0, Math.PI * 2); ctx0.fill();
            this.txt(`現在 ${curPt.dd.toFixed(1)}%`, cx, cy + 20, 12, GREEN, { bold: true, align: 'center' });
            ctx0.restore();
          }
        }
      }
      return;
    }
    if (id === 'crashFreq') {
      // [Stage D-6] 「下落の頻度」スライド。ダッシュボードのtrackRecord.finalReach（DD-3%到達局面からの
      // 最終到達確率、15行）をコンパクトな横棒リストで表示し、現在の到達節目の行を枠で囲って強調する。
      const fr = md?.finalReach;
      if (!fr || !fr.rows.length) { this.heading('近況：下落の頻度', 'データ不足のため表示できません', p); return; }
      this.heading('近況：下落の頻度', `DD-3%到達からの最終到達確率（過去${fr.totalYears.toFixed(0)}年・${fr.n}局面）`, p);
      const rows = fr.rows;
      const rowH = Math.min(25, Math.floor(362 / rows.length));
      const top = 104;
      const barX = 230, barW = 300;
      const maxP = Math.max(...rows.map(r => r.p ?? 0), 10);
      rows.forEach((r, i) => {
        const y = top + i * rowH;
        const k = ease(sub(p, 0.03 + i * 0.045, 0.35 + i * 0.045));
        const isCurrent = !!fr.currentLabel && r.label === fr.currentLabel;
        ctx0.save(); ctx0.globalAlpha *= k;
        this.txt(r.label, 28, y + rowH - 7, 12, isCurrent ? AMBER : WHITE, { bold: isCurrent, maxW: 80 });
        const pv = r.p ?? 0;
        ctx0.fillStyle = 'rgba(255,255,255,0.08)'; ctx0.fillRect(barX, y, barW, rowH - 5);
        ctx0.fillStyle = `rgba(${isCurrent ? AMBER : GREEN},0.85)`; ctx0.fillRect(barX, y, (pv / maxP) * barW, rowH - 5);
        this.txt(r.p !== null ? `${r.p.toFixed(1)}%（${r.hits}件）` : '—', barX + barW + 10, y + rowH - 7, 11, WHITE, { alpha: 0.9, maxW: 96 });
        if (isCurrent) { ctx0.strokeStyle = `rgba(${AMBER},0.9)`; ctx0.lineWidth = 2; ctx0.strokeRect(20, y - 2, PW - 40, rowH - 2); }
        ctx0.restore();
      });
      return;
    }
    if (id === 'position') {
      this.heading('分析① 現在の位置', `年初来の騰落率を、過去${s.pastYtd.length}年の同時期と比べる`, p);
      const lim = Math.max(Math.abs(s.ytd), Math.abs(s.ytdAvg), Math.abs(s.ytdMedian), 5) * 1.15;
      const rows: [string, number][] = [[`今年（${s.year}年）`, s.ytd], ['過去の平均', s.ytdAvg], ['過去の中央値', s.ytdMedian]];
      rows.forEach(([l, v], i) => this.hbar(l, v, lim, 140 + i * 70, sub(p, 0.12 + i * 0.12, 0.5 + i * 0.12), fmtPct(v)));
      ctx.save(); ctx.globalAlpha *= ease(sub(p, 0.6, 0.8));
      this.txt(`過去${s.pastYtd.length + 1}年中 ${s.ytdRank}位`, 24, 400, 40, GREEN, { bold: true });
      this.txt(`平均との差 ${fmtPct(s.ytd - s.ytdAvg)}`, 24, 440, 20, WHITE, { alpha: 0.8 });
      ctx.restore();
    } else if (id === 'momentum') {
      this.heading('分析② 直近の勢い', `直近${s.last10.length}営業日の日次騰落率`, p);
      const vals = s.last10;
      const lim = Math.max(1, ...vals.map(v => Math.abs(v))) * 1.2;
      const baseY = 270, hh = 120, bw = 40, gap = 20;
      const x0 = 24 + (PW - 48 - (vals.length * (bw + gap) - gap)) / 2;
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(24, baseY, PW - 48, 1.5);
      vals.forEach((v, i) => {
        const a = ease(sub(p, 0.1 + i * 0.05, 0.4 + i * 0.05));
        const h = (Math.abs(v) / lim) * hh * a;
        const x = x0 + i * (bw + gap);
        ctx.fillStyle = `rgba(${rgbOf(v)}, 0.9)`;
        if (v >= 0) ctx.fillRect(x, baseY - h, bw, h); else ctx.fillRect(x, baseY, bw, h);
        ctx.save(); ctx.globalAlpha *= a;
        this.txt(`${v >= 0 ? '+' : ''}${v.toFixed(1)}`, x + bw / 2, v >= 0 ? baseY - h - 8 : baseY + h + 20, 14, rgbOf(v), { align: 'center', bold: true });
        ctx.restore();
      });
      ctx.save(); ctx.globalAlpha *= ease(sub(p, 0.65, 0.85));
      const up = vals.filter(v => v > 0).length;
      this.txt(`上昇 ${up}日 / 下落 ${vals.length - up}日`, 24, 430, 30, WHITE, { bold: true });
      this.txt(`今年の上昇日の割合 ${s.upRatio.toFixed(1)}%（過去平均 ${s.upRatioAvg.toFixed(1)}%）`, 24, 466, 18, WHITE, { alpha: 0.75 });
      ctx.restore();
    } else if (id === 'risk') {
      this.heading('分析③ 下落リスク', '最高値からの下落と、過去の暴落の発生頻度', p);
      const lim = Math.max(10, Math.abs(s.ddMin) * 1.3);
      this.hbar('現在の最高値からの下落', s.dd, lim, 130, sub(p, 0.12, 0.5), `${s.dd.toFixed(1)}%`);
      this.hbar('今年の最大下落', s.ddMin, lim, 190, sub(p, 0.22, 0.6), `${s.ddMin.toFixed(1)}%`);
      const rows = (s.crash ?? []).filter(r => [10, 20, 30].includes(r.level));
      this.txt('過去の実績：調整〜暴落の頻度', 24, 290, 18, WHITE, { bold: true, alpha: 0.9 });
      rows.forEach((r, i) => {
        const y = 310 + i * 52;
        const a = ease(sub(p, 0.5 + i * 0.1, 0.8 + i * 0.1));
        ctx.save(); ctx.globalAlpha *= a;
        this.txt(`-${r.level}%超の下落`, 24, y + 28, 20, WHITE, { bold: true, alpha: 0.9, maxW: 250 });
        this.txt(r.intervalText || '—', 290, y + 28, 22, r.level >= 30 ? DOWN : AMBER, { bold: true });
        this.txt(r.lastYear ? `前回 ${r.lastYear}年` : '', 520, y + 28, 18, WHITE, { alpha: 0.85 });
        ctx.restore();
      });
    } else if (id === 'range' || id === 'yearEndTrack') {
      this.heading('分析④ 年末までの幅（過去の実績）', `過去${o.n}年、今と同じ時期から年末までの変化`, p);
      const ends = o.paths.map(q => q.end);
      const lo = Math.min(...ends, -5), hi = Math.max(...ends, 5);
      const L = 40, R = PW - 40, y0 = 270;
      const px = (v: number) => L + ((v - lo) / (hi - lo)) * (R - L);
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(L, y0, R - L, 1.5);
      ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillRect(px(0) - 1, y0 - 90, 2, 180);
      this.txt('0%', px(0), y0 + 112, 14, WHITE, { align: 'center', alpha: 0.7 });
      const band = ease(sub(p, 0.45, 0.7));
      ctx.fillStyle = `rgba(${GREEN}, ${0.2 * band})`;
      ctx.fillRect(px(o.p25), y0 - 70, (px(o.p75) - px(o.p25)) * band, 140);
      const sorted = ends.slice().sort((a, b) => a - b);
      const n = sorted.length;
      sorted.forEach((v, i) => {
        const a = ease(sub(p, 0.1 + (i / n) * 0.35, 0.2 + (i / n) * 0.35));
        const jitter = (((i * 7919) % 13) / 13 - 0.5) * 120;
        ctx.fillStyle = `rgba(${rgbOf(v)}, ${0.85 * a})`;
        ctx.beginPath(); ctx.arc(px(v), y0 + jitter, 6 * a, 0, Math.PI * 2); ctx.fill();
      });
      const ma = ease(sub(p, 0.6, 0.8));
      ctx.fillStyle = `rgba(${AMBER}, ${ma})`; ctx.fillRect(px(o.median) - 2, y0 - 90, 4, 180);
      ctx.save(); ctx.globalAlpha *= ma;
      this.txt(`中央値 ${fmtPct(o.median)}`, px(o.median), y0 - 98, 18, AMBER, { align: 'center', bold: true });
      this.txt(fmtPct(o.p25), px(o.p25), y0 + 94, 14, GREEN, { align: 'center' });
      this.txt(fmtPct(o.p75), px(o.p75), y0 + 94, 14, GREEN, { align: 'center' });
      ctx.restore();
      ctx.save(); ctx.globalAlpha *= ease(sub(p, 0.75, 0.95));
      this.txt(`半数の年は ${fmtPct(o.p25)} 〜 ${fmtPct(o.p75)} に収まりました`, 24, 430, 24, WHITE, { bold: true, maxW: PW - 48 });
      this.txt('将来を予想するものではなく、過去の実績です。', 24, 464, 16, WHITE, { alpha: 0.65 });
      ctx.restore();
    }
  }

  // ---------- アナリスト ----------
  /** その時点の読み上げの大きさ（0〜1）から、口の開き具合を決める */
  private mouthLevel(scene: number, t: number): number {
    const env = this.envs[scene];
    if (!env) return 0;
    const idx = Math.floor((t - 0.3) / 0.01);
    if (idx < 1 || idx >= env.length - 1) return 0;
    const v = (env[idx - 1] + env[idx] + env[idx + 1]) / 3;
    return v < 0.12 ? 0 : Math.pow(v, 0.75);
  }

  private drawAnalystPanel(_level: number, gt: number) {
    if (!this.cfg.analyst) return; // MP4アバター未登録時は人物パネルを描かない
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = 1;
    this.cfg.analyst.avatar.ensureSchedule(this.totalSeconds);
    this.cfg.analyst.avatar.draw(ctx, LONG_COLUMN_X, 0, LW - LONG_COLUMN_X, LH, gt);
    ctx.restore();
  }
}
