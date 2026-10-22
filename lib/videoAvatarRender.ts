// 人物の動画（最大3本）を、ランダムな順番でつなぎ、エンドレスにくり返して表示する。
// 背景は、動画の四隅の色を基準に、画面の端につながっている部分だけを透明にする（顔や髪の中は消えない）。

const XFADE = 0.5; // つなぎ目を重ねる秒数

export interface AvatarOptions { keyOn: boolean; tol: number; zoom: number }

interface Seg { clip: number; start: number; dur: number }

function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export class VideoAvatar {
  private clips: HTMLVideoElement[];
  private opt: AvatarOptions;
  private segs: Seg[] = [];
  private schedTotal = -1;
  private seed = Math.floor(Math.random() * 1e9);
  private lastT = -1;
  private keyColors: (number[] | null)[];
  private tmp = document.createElement('canvas');
  private mask = document.createElement('canvas');
  private outs: HTMLCanvasElement[] = [document.createElement('canvas'), document.createElement('canvas')];
  private work = document.createElement('canvas');
  private bgBuf = new Uint8Array(0);
  private visBuf = new Uint8Array(0);
  private stack = new Int32Array(0);
  /** シーク完了や読み込み完了で、画面を描き直したいときに呼ばれる */
  onRedraw?: () => void;

  constructor(clips: HTMLVideoElement[], opt: AvatarOptions) {
    this.clips = clips;
    this.opt = { ...opt };
    this.keyColors = clips.map(() => null);
    clips.forEach(v => {
      v.addEventListener('seeked', () => this.onRedraw?.());
      v.addEventListener('loadeddata', () => this.onRedraw?.());
    });
  }

  setOptions(o: Partial<AvatarOptions>) { this.opt = { ...this.opt, ...o }; this.keyColors = this.clips.map(() => null); }

  /** 全体の長さ(秒)に合わせて、「どの動画を、いつから流すか」を決める（動画が2本以上のときは、同じ動画が続けて来ない） */
  ensureSchedule(total: number) {
    if (Math.abs(total - this.schedTotal) < 0.01 && this.segs.length) return;
    this.schedTotal = total;
    const r = rng(this.seed);
    const n = this.clips.length;
    const dur = (i: number) => (isFinite(this.clips[i].duration) && this.clips[i].duration > 0.5 ? this.clips[i].duration : 10);
    const segs: Seg[] = [];
    let t = 0, prev = -1;
    while (t < total + 1 && segs.length < 2000) {
      let c = Math.floor(r() * n);
      if (n > 1 && c === prev) c = (c + 1 + Math.floor(r() * (n - 1))) % n;
      const d = dur(c);
      segs.push({ clip: c, start: t, dur: d });
      t += Math.max(1, d - (d > XFADE * 4 ? XFADE : 0));
      prev = c;
    }
    this.segs = segs;
  }

  private active(t: number): { seg: Seg; u: number; a: number }[] {
    const out: { seg: Seg; u: number; a: number }[] = [];
    for (let i = 0; i < this.segs.length; i++) {
      const s = this.segs[i];
      if (t >= s.start && t < s.start + s.dur) {
        const u = Math.min(t - s.start, s.dur - 0.02);
        const a = i > 0 && u < XFADE ? Math.min(1, u / XFADE) : 1;
        out.push({ seg: s, u, a });
      }
      if (s.start > t) break;
    }
    return out;
  }

  private sync(v: HTMLVideoElement, u: number, playing: boolean) {
    if (playing) {
      if (v.paused) { if (Math.abs(v.currentTime - u) > 0.1) v.currentTime = u; v.play().catch(() => {}); }
      else if (Math.abs(v.currentTime - u) > 0.5) v.currentTime = u;
    } else {
      if (!v.paused) v.pause();
      if (Math.abs(v.currentTime - u) > 0.04) v.currentTime = u;
    }
  }

  pauseAll() { this.clips.forEach(v => { if (!v.paused) v.pause(); }); this.lastT = -1; }

  /** 指定の時刻の画面になるまで待つ（サムネ保存用） */
  async prepare(t: number): Promise<void> {
    this.ensureSchedule(this.schedTotal > 0 ? this.schedTotal : t + 1);
    this.pauseAll();
    await Promise.all(this.active(t).map(({ seg, u }) => new Promise<void>(res => {
      const v = this.clips[seg.clip];
      if (Math.abs(v.currentTime - u) <= 0.04 && v.readyState >= 2) { res(); return; }
      const done = () => { v.removeEventListener('seeked', done); res(); };
      v.addEventListener('seeked', done);
      v.currentTime = u;
      setTimeout(done, 1500);
    })));
  }

  /** 背景を透明にした1コマ（動画と同じ大きさ）を作る */
  private keyed(idx: number, slot: number): HTMLCanvasElement | null {
    const v = this.clips[idx];
    if (v.readyState < 2 || !v.videoWidth) return null;
    const w = v.videoWidth, h = v.videoHeight;
    const out = this.outs[slot];
    if (out.width !== w || out.height !== h) { out.width = w; out.height = h; }
    const octx = out.getContext('2d')!;
    octx.globalCompositeOperation = 'source-over';
    octx.filter = 'none';
    octx.clearRect(0, 0, w, h);
    octx.drawImage(v, 0, 0, w, h);
    if (!this.opt.keyOn) return out;

    const mw = Math.min(640, w), mh = Math.max(1, Math.round(h * mw / w));
    if (this.tmp.width !== mw || this.tmp.height !== mh) { this.tmp.width = mw; this.tmp.height = mh; this.mask.width = mw; this.mask.height = mh; }
    const tctx = this.tmp.getContext('2d', { willReadFrequently: true })!;
    tctx.drawImage(v, 0, 0, mw, mh);
    const img = tctx.getImageData(0, 0, mw, mh);
    const d = img.data;
    const n = mw * mh;
    if (this.bgBuf.length !== n) { this.bgBuf = new Uint8Array(n); this.visBuf = new Uint8Array(n); this.stack = new Int32Array(n); }

    let key = this.keyColors[idx];
    if (!key) {
      // 四隅の色の平均
      let r = 0, g = 0, b = 0, c = 0;
      const bw = Math.max(4, Math.round(mw * 0.02));
      for (const [cx, cy] of [[0, 0], [mw - bw, 0], [0, mh - bw], [mw - bw, mh - bw]]) {
        for (let y = cy; y < cy + bw; y++) for (let x = cx; x < cx + bw; x++) { const k = (y * mw + x) * 4; r += d[k]; g += d[k + 1]; b += d[k + 2]; c++; }
      }
      key = [r / c, g / c, b / c];
      this.keyColors[idx] = key;
    }
    // 四隅の平均色に近い「ふちの画素」だけを種に、隣どうしの色の近さで背景領域を広げる。
    // （全画素をキー色1色とだけ比べる方式だと、実写の背景の照明のムラ・グラデーションで
    //  途中がキー色から外れてしまい、キー抜きが途中で止まって一部しか透明にならないことが
    //  あったため、隣接画素間の差分でたどる方式に変更）
    const t2 = this.opt.tol * this.opt.tol;
    const vis = this.visBuf, st = this.stack;
    vis.fill(0);
    const nearKey = (i: number) => { const k = i * 4; const dr = d[k] - key[0], dg = d[k + 1] - key[1], db = d[k + 2] - key[2]; return dr * dr + dg * dg + db * db < t2; };
    let sp = 0;
    const seed = (i: number) => { if (!vis[i] && nearKey(i)) { vis[i] = 1; st[sp++] = i; } };
    for (let x = 0; x < mw; x++) { seed(x); seed((mh - 1) * mw + x); }
    for (let y = 0; y < mh; y++) { seed(y * mw); seed(y * mw + mw - 1); }
    const grow = (from: number, to: number) => {
      if (vis[to]) return;
      const kf = from * 4, kt = to * 4;
      const dr = d[kf] - d[kt], dg = d[kf + 1] - d[kt + 1], db = d[kf + 2] - d[kt + 2];
      if (dr * dr + dg * dg + db * db < t2) { vis[to] = 1; st[sp++] = to; }
    };
    while (sp > 0) {
      const i = st[--sp];
      const x = i % mw;
      if (x > 0) grow(i, i - 1);
      if (x < mw - 1) grow(i, i + 1);
      if (i >= mw) grow(i, i - mw);
      if (i < n - mw) grow(i, i + mw);
    }
    for (let i = 0; i < n; i++) { const k = i * 4; d[k] = 255; d[k + 1] = 255; d[k + 2] = 255; d[k + 3] = vis[i] ? 0 : 255; }
    this.mask.getContext('2d')!.putImageData(img, 0, 0);
    octx.globalCompositeOperation = 'destination-in';
    octx.imageSmoothingQuality = 'high';
    octx.filter = 'blur(1.5px)';
    octx.drawImage(this.mask, 0, 0, w, h);
    octx.filter = 'none';
    octx.globalCompositeOperation = 'source-over';
    return out;
  }

  /** 時刻 t(秒) の人物を、枠 (x,y,w,h) の下端に合わせて描く */
  draw(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, t: number): void {
    if (this.clips.length === 0) return;
    this.ensureSchedule(this.schedTotal > 0 ? this.schedTotal : t + 60);
    const playing = this.lastT >= 0 && t > this.lastT && t - this.lastT < 0.3;
    this.lastT = t;
    const act = this.active(t);
    if (!playing) this.clips.forEach((v, i) => { if (!act.some(a => a.seg.clip === i) && !v.paused) v.pause(); });
    const frame = this.work;
    let drawn = false;
    act.forEach(({ seg, u, a }, k) => {
      const v = this.clips[seg.clip];
      this.sync(v, u, playing);
      const c = this.keyed(seg.clip, k);
      if (!c) return;
      if (frame.width !== c.width || frame.height !== c.height) { frame.width = c.width; frame.height = c.height; }
      const fctx = frame.getContext('2d')!;
      if (k === 0) fctx.clearRect(0, 0, frame.width, frame.height);
      fctx.globalAlpha = a;
      fctx.drawImage(c, 0, 0);
      fctx.globalAlpha = 1;
      drawn = true;
    });
    if (!drawn) return;
    const s = (h / frame.height) * this.opt.zoom;
    const dw = frame.width * s, dh = frame.height * s;
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.drawImage(frame, x + (w - dw) / 2, y + h - dh, dw, dh);
    ctx.restore();
  }
}
