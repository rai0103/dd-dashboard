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
  // 背景を消した1コマの置き場所（動画1本につき1枚）。同じ1コマなら作り直さずに使い回す（処理を軽くして再生の引っかかりを防ぐ）
  private outs: HTMLCanvasElement[] = [];
  private outKey: string[] = [];
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
    this.outs = clips.map(() => document.createElement('canvas'));
    this.outKey = clips.map(() => '');
    clips.forEach(v => {
      v.addEventListener('seeked', () => this.onRedraw?.());
      v.addEventListener('loadeddata', () => this.onRedraw?.());
    });
  }

  setOptions(o: Partial<AvatarOptions>) { this.opt = { ...this.opt, ...o }; this.keyColors = this.clips.map(() => null); this.outKey = this.clips.map(() => ''); }

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
      // 再生中は、人物の動画の時刻と全体の時刻が多少ずれても気にしない（口の動きと音声は元々連動していないため）。
      // 小さなずれのたびに位置を合わせ直すと、そのたびに動画が一瞬止まり、人物がカクついて見える原因になる。
      // 合わせ直すのは、大きくずれたとき（2秒以上）と、止まっている動画を動かし始めるときだけ。
      if (v.seeking) return;
      if (v.paused) {
        if (Math.abs(v.currentTime - u) > 0.25) v.currentTime = u;
        v.play().catch(() => {});
      } else if (Math.abs(v.currentTime - u) > 2.0) {
        v.currentTime = Math.min(u + 0.15, Math.max(0, (v.duration || u + 1) - 0.1));
      }
    } else {
      if (!v.paused) v.pause();
      if (Math.abs(v.currentTime - u) > 0.04) v.currentTime = u;
    }
  }

  /** まもなく始まる動画を、先頭の位置で止めて待たせておく（切り替えの瞬間に1コマ目がすぐ出せるように） */
  private preroll(t: number, act: { seg: Seg }[]) {
    const busy = new Set(act.map(a => a.seg.clip));
    for (const s of this.segs) {
      if (s.start <= t) continue;
      if (s.start - t > 0.8) break;
      if (busy.has(s.clip)) continue;
      const v = this.clips[s.clip];
      if (!v.paused) v.pause();
      if (!v.seeking && v.currentTime > 0.05) v.currentTime = 0;
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
  private keyed(idx: number): HTMLCanvasElement | null {
    const v = this.clips[idx];
    if (v.readyState < 2 || !v.videoWidth) return null;
    const w = v.videoWidth, h = v.videoHeight;
    const out = this.outs[idx];
    // 同じ1コマ（動画の時刻が前回と同じ）なら、背景を消し直さずに前回の結果を使う
    const ck = `${v.currentTime.toFixed(3)}|${v.videoWidth}`;
    if (this.outKey[idx] === ck && out.width === v.videoWidth) return out;
    this.outKey[idx] = ck;
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
    // RGBの絶対値だけでなく、明るさの影響を受けにくい色味（クロマ）の近さも見る。
    // 首の影のように「明るさは背景に近いが色味（肌の赤み等）は違う」画素を、
    // 影の濃淡をたどって誤って透明にしてしまう（人物側への「染み出し」）のを防ぐための安全弁
    const ksum = key[0] + key[1] + key[2] + 1;
    const keyRn = key[0] / ksum, keyGn = key[1] / ksum;
    const CHROMA_TOL2 = 0.05 * 0.05;
    const chromaOk = (k: number) => {
      const total = d[k] + d[k + 1] + d[k + 2] + 1;
      const rn = d[k] / total - keyRn, gn = d[k + 1] / total - keyGn;
      return rn * rn + gn * gn < CHROMA_TOL2;
    };
    const nearKey = (i: number) => {
      const k = i * 4;
      const dr = d[k] - key[0], dg = d[k + 1] - key[1], db = d[k + 2] - key[2];
      return dr * dr + dg * dg + db * db < t2 && chromaOk(k);
    };
    let sp = 0;
    const seed = (i: number) => { if (!vis[i] && nearKey(i)) { vis[i] = 1; st[sp++] = i; } };
    for (let x = 0; x < mw; x++) { seed(x); seed((mh - 1) * mw + x); }
    for (let y = 0; y < mh; y++) { seed(y * mw); seed(y * mw + mw - 1); }
    // ふちの種まきは厳しめのtolのまま（人物が端に写り込んでいても種にしないため）だが、
    // そこから先への伝播（歩幅）は少しゆるめる。被写体の近くでは背景にも照明の当たり方の違いで
    // 明るいムラ（ハロー）が出やすく、歩幅の判定が厳しすぎるとそこで広がりが止まってしまい、
    // 人物のすぐ周りだけキーが抜けきらずに残ることがある一方、ゆるめすぎると今度は被写体の服の色が
    // 背景と近い場合（グレーの上着とグレーがかった背景など）に、服の縁が誤って透明になってしまう。
    // この両者はトレードオフのため、以前より控えめな倍率にして折衷している
    const growT2 = (this.opt.tol * 1.4) * (this.opt.tol * 1.4);
    // 隣との色の近さ（歩幅）に加えて、キー色からの総移動量（RGB・クロマ双方）にも上限を設ける
    const gt2 = (this.opt.tol * 2.3) * (this.opt.tol * 2.3);
    const grow = (from: number, to: number) => {
      if (vis[to]) return;
      const kf = from * 4, kt = to * 4;
      const dr = d[kf] - d[kt], dg = d[kf + 1] - d[kt + 1], db = d[kf + 2] - d[kt + 2];
      if (dr * dr + dg * dg + db * db >= growT2) return;
      const gr = d[kt] - key[0], gg = d[kt + 1] - key[1], gb = d[kt + 2] - key[2];
      if (gr * gr + gg * gg + gb * gb >= gt2) return;
      if (!chromaOk(kt)) return;
      vis[to] = 1; st[sp++] = to;
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

  /** 直前に描けた人物の1コマがあるか（動画の切り替え・シーク中で新しい1コマが用意できないときは、これを描き続ける） */
  private hasFrame = false;

  /** 時刻 t(秒) の人物を、枠 (x,y,w,h) の下端に合わせて描く */
  draw(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, t: number): void {
    if (this.clips.length === 0) return;
    this.ensureSchedule(this.schedTotal > 0 ? this.schedTotal : t + 60);
    // 書き出し中などで描画の間隔が一時的に空いても「再生中」とみなす（0.3秒だと、少し間が空いただけで
    // 一時停止＋シークが起き、その間は1コマも用意できずに人物が消えてしまうことがあった）
    const playing = this.lastT >= 0 && t > this.lastT && t - this.lastT < 1.0;
    this.lastT = t;
    let act = this.active(t).slice(-2);
    // 同じ動画どうしの重なり（動画が1本だけのとき）は、後ろの1本だけを使う（同じ動画を2か所で同時に再生できないため）
    if (act.length === 2 && act[0].seg.clip === act[1].seg.clip) act = [{ ...act[1], a: 1 }];
    if (!playing) this.clips.forEach((v, i) => { if (!act.some(a => a.seg.clip === i) && !v.paused) v.pause(); });
    else this.preroll(t, act);
    // 重ねる動画（つなぎ目では2本）のすべての1コマがそろったときだけ、新しい1コマに差し替える。
    // どれかがまだ用意できていない（シーク中・読み込み中）ときは、直前の1コマを描き続けて消えないようにする
    const layers = act.map(({ seg, u, a }, k) => {
      const v = this.clips[seg.clip];
      this.sync(v, u, playing);
      return { c: this.keyed(seg.clip), a };
    });
    const ready = layers.length > 0 && layers.every(l => !!l.c);
    const frame = this.work;
    if (ready) {
      const first = layers[0].c!;
      if (frame.width !== first.width || frame.height !== first.height) { frame.width = first.width; frame.height = first.height; }
      const fctx = frame.getContext('2d')!;
      fctx.clearRect(0, 0, frame.width, frame.height);
      layers.forEach(({ c, a }) => { fctx.globalAlpha = a; fctx.drawImage(c!, 0, 0, frame.width, frame.height); });
      fctx.globalAlpha = 1;
      this.hasFrame = true;
    } else if (!this.hasFrame) {
      // まだ1コマも描けていない：用意できた分だけでも描く
      const some = layers.find(l => !!l.c);
      if (!some) return;
      if (frame.width !== some.c!.width || frame.height !== some.c!.height) { frame.width = some.c!.width; frame.height = some.c!.height; }
      const fctx = frame.getContext('2d')!;
      fctx.clearRect(0, 0, frame.width, frame.height);
      fctx.drawImage(some.c!, 0, 0);
      this.hasFrame = true;
    }
    const s = (h / frame.height) * this.opt.zoom;
    const dw = frame.width * s, dh = frame.height * s;
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.drawImage(frame, x + (w - dw) / 2, y + h - dh, dw, dh);
    ctx.restore();
  }
}
