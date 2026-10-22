// 長尺用のアナリスト（ベクターで描くアバター）。性別は、声の候補を絞るのに使う。
export type Gender = 'male' | 'female';
export type HairStyle = 'short' | 'side' | 'gray' | 'long' | 'bob' | 'pony';

export interface Analyst {
  id: string;
  name: string;
  role: string;
  gender: Gender;
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  suit: string;
  shirt: string;
  accent: string;   // ネクタイ・スカーフ
  glasses: boolean;
}

export const ANALYSTS: Analyst[] = [
  { id: 'm1', name: '高橋 誠', role: 'チーフストラテジスト', gender: 'male', skin: '#f2c9a5', hair: '#1d1b1a', hairStyle: 'short', suit: '#1f3556', shirt: '#f4f6fa', accent: '#c0392b', glasses: true },
  { id: 'm2', name: '田中 健', role: 'マーケットアナリスト', gender: 'male', skin: '#efc3a0', hair: '#5a3b24', hairStyle: 'side', suit: '#4a4f58', shirt: '#dfe9f7', accent: '#2e86c1', glasses: false },
  { id: 'm3', name: '佐藤 大輔', role: '上席エコノミスト', gender: 'male', skin: '#e8b896', hair: '#b9bcc2', hairStyle: 'gray', suit: '#2c2c34', shirt: '#ffffff', accent: '#d4a017', glasses: true },
  { id: 'f1', name: '鈴木 美咲', role: 'チーフアナリスト', gender: 'female', skin: '#f5d0b0', hair: '#1f1612', hairStyle: 'long', suit: '#2b3a67', shirt: '#fbf2f4', accent: '#d96b8a', glasses: false },
  { id: 'f2', name: '山本 彩', role: 'ストラテジスト', gender: 'female', skin: '#f1c7a4', hair: '#6b3f26', hairStyle: 'bob', suit: '#5b2a3c', shirt: '#f7f7f7', accent: '#e0b04a', glasses: true },
  { id: 'f3', name: '中村 玲子', role: 'リサーチ責任者', gender: 'female', skin: '#eec1a0', hair: '#2a1c14', hairStyle: 'pony', suit: '#1e5a58', shirt: '#f2faf8', accent: '#e07a5f', glasses: false },
];

export const analystById = (id: string): Analyst => ANALYSTS.find(a => a.id === id) ?? ANALYSTS[0];

/** 声の名前から性別を推定（不明は null＝どちらの候補にも出す） */
export function voiceGender(name: string): Gender | null {
  const n = name.replace(/^(sapi|oc):/, '');
  if (/ichiro|keita|takumi|ken\b|otoya|hattori|ryusei|naoki|daichi|kenji|male|男性/i.test(n) && !/female/i.test(n)) return 'male';
  if (/haruka|ayumi|sayaka|nanami|ayako|mayu|shiori|aoi|hikari|female|女性/i.test(n)) return 'female';
  return null;
}

/** 長尺：右側のアナリスト用の縦長の領域（960×540 の論理座標。左は黒） */
export const LONG_COLUMN_X = 672;

/** 長尺用の背景。左は黒、背景画像は右側の縦長の領域だけに全面表示（opacity=0〜100） */
export function drawLongBackground(ctx: CanvasRenderingContext2D, img: HTMLImageElement | null | undefined, opacity: number, W: number, H: number): void {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  const x0 = LONG_COLUMN_X, cw = W - x0;
  ctx.save();
  ctx.beginPath(); ctx.rect(x0, 0, cw, H); ctx.clip();
  if (img && img.complete && img.naturalWidth > 0) {
    const sc = Math.max(cw / img.naturalWidth, H / img.naturalHeight);
    const dw = img.naturalWidth * sc, dh = img.naturalHeight * sc;
    ctx.globalAlpha = Math.min(1, Math.max(0, opacity)); // opacityは0〜1（呼び出し側のDDDashboard.jsxで既に/100済み）。ここでさらに/100すると実質0%になり、背景画像が見えなくなるバグだった
    ctx.drawImage(img, x0 + (cw - dw) / 2, (H - dh) / 2, dw, dh);
  } else {
    const g = ctx.createLinearGradient(x0, 0, W, H);
    g.addColorStop(0, '#0a1630'); g.addColorStop(1, '#14305a');
    ctx.fillStyle = g;
    ctx.fillRect(x0, 0, cw, H);
  }
  ctx.restore();
}

/**
 * アナリストの上半身を (x,y)-(x+w,y+h) の中に描く。
 * t: 経過秒（まばたき・体の揺れ用）、talk: 口の開き(0〜1)
 */
export function drawAnalyst(ctx: CanvasRenderingContext2D, a: Analyst, x: number, y: number, w: number, h: number, t: number, talk: number): void {
  ctx.save();
  ctx.translate(x + w / 2, y);
  const s = Math.min(w / 260, h / 300);
  ctx.scale(s, s);
  const sway = Math.sin(t * 1.3) * 1.5;
  ctx.translate(sway, 0);
  const cx = 0;

  // 背景の円
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.beginPath(); ctx.arc(cx, 150, 128, 0, Math.PI * 2); ctx.fill();

  const hairBack = () => {
    ctx.fillStyle = a.hair;
    if (a.hairStyle === 'long') { ctx.beginPath(); ctx.ellipse(cx, 120, 70, 92, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillRect(cx - 70, 110, 140, 130); }
    else if (a.hairStyle === 'bob') { ctx.beginPath(); ctx.ellipse(cx, 112, 68, 80, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillRect(cx - 68, 105, 136, 70); }
    else if (a.hairStyle === 'pony') { ctx.beginPath(); ctx.ellipse(cx + 66, 120, 16, 44, 0.4, 0, Math.PI * 2); ctx.fill(); }
  };
  hairBack();

  // 肩・スーツ
  ctx.fillStyle = a.suit;
  ctx.beginPath(); ctx.moveTo(cx - 118, 300); ctx.quadraticCurveTo(cx - 112, 215, cx - 50, 205); ctx.lineTo(cx + 50, 205); ctx.quadraticCurveTo(cx + 112, 215, cx + 118, 300); ctx.closePath(); ctx.fill();
  // シャツ
  ctx.fillStyle = a.shirt;
  ctx.beginPath(); ctx.moveTo(cx - 30, 205); ctx.lineTo(cx, 262); ctx.lineTo(cx + 30, 205); ctx.closePath(); ctx.fill();
  // ネクタイ／スカーフ
  ctx.fillStyle = a.accent;
  if (a.gender === 'male') {
    ctx.beginPath(); ctx.moveTo(cx - 7, 212); ctx.lineTo(cx + 7, 212); ctx.lineTo(cx + 10, 262); ctx.lineTo(cx, 276); ctx.lineTo(cx - 10, 262); ctx.closePath(); ctx.fill();
  } else {
    ctx.beginPath(); ctx.ellipse(cx, 214, 20, 8, 0, 0, Math.PI * 2); ctx.fill();
  }
  // 襟
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.moveTo(cx - 50, 205); ctx.lineTo(cx - 30, 205); ctx.lineTo(cx, 262); ctx.lineTo(cx - 14, 268); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(cx + 50, 205); ctx.lineTo(cx + 30, 205); ctx.lineTo(cx, 262); ctx.lineTo(cx + 14, 268); ctx.closePath(); ctx.fill();

  // 首
  ctx.fillStyle = a.skin;
  ctx.fillRect(cx - 17, 178, 34, 40);
  ctx.fillStyle = 'rgba(0,0,0,0.10)';
  ctx.fillRect(cx - 17, 178, 34, 12);

  // 顔
  ctx.fillStyle = a.skin;
  ctx.beginPath(); ctx.ellipse(cx, 120, 54, 64, 0, 0, Math.PI * 2); ctx.fill();
  // 耳
  ctx.beginPath(); ctx.ellipse(cx - 54, 124, 7, 11, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx + 54, 124, 7, 11, 0, 0, Math.PI * 2); ctx.fill();

  // 前髪
  ctx.fillStyle = a.hair;
  ctx.beginPath();
  if (a.hairStyle === 'short') {
    ctx.moveTo(cx - 56, 112); ctx.quadraticCurveTo(cx - 60, 52, cx, 50); ctx.quadraticCurveTo(cx + 60, 52, cx + 56, 112);
    ctx.quadraticCurveTo(cx + 40, 84, cx + 8, 82); ctx.quadraticCurveTo(cx - 30, 84, cx - 56, 112);
  } else if (a.hairStyle === 'side') {
    ctx.moveTo(cx - 56, 110); ctx.quadraticCurveTo(cx - 62, 50, cx + 4, 48); ctx.quadraticCurveTo(cx + 62, 52, cx + 56, 112);
    ctx.quadraticCurveTo(cx + 46, 78, cx - 10, 76); ctx.quadraticCurveTo(cx - 36, 90, cx - 56, 110);
  } else if (a.hairStyle === 'gray') {
    ctx.moveTo(cx - 56, 106); ctx.quadraticCurveTo(cx - 58, 56, cx, 54); ctx.quadraticCurveTo(cx + 58, 56, cx + 56, 106);
    ctx.quadraticCurveTo(cx + 44, 80, cx, 78); ctx.quadraticCurveTo(cx - 44, 80, cx - 56, 106);
  } else {
    // 女性：センター分け
    ctx.moveTo(cx - 58, 130); ctx.quadraticCurveTo(cx - 66, 46, cx, 48); ctx.quadraticCurveTo(cx + 66, 46, cx + 58, 130);
    ctx.quadraticCurveTo(cx + 50, 84, cx, 74); ctx.quadraticCurveTo(cx - 50, 84, cx - 58, 130);
  }
  ctx.closePath(); ctx.fill();

  // 目（まばたき）
  const blinkPhase = (t % 4);
  const blink = blinkPhase > 3.85 ? 0.15 : 1;
  ctx.fillStyle = '#ffffff';
  for (const dx of [-20, 20]) { ctx.beginPath(); ctx.ellipse(cx + dx, 116, 9, 7 * blink, 0, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = '#2a2220';
  for (const dx of [-20, 20]) { ctx.beginPath(); ctx.ellipse(cx + dx + Math.sin(t * 0.7) * 1.2, 116, 4.2, 4.6 * blink, 0, 0, Math.PI * 2); ctx.fill(); }
  // 眉
  ctx.strokeStyle = a.hair; ctx.lineWidth = 3; ctx.lineCap = 'round';
  for (const dx of [-20, 20]) { ctx.beginPath(); ctx.moveTo(cx + dx - 10, 100 - (dx > 0 ? 0 : 0)); ctx.lineTo(cx + dx + 10, 99); ctx.stroke(); }
  // 鼻
  ctx.strokeStyle = 'rgba(120,70,50,0.45)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cx, 120); ctx.quadraticCurveTo(cx + 5, 136, cx - 2, 138); ctx.stroke();
  // 口
  const open = Math.max(0, Math.min(1, talk));
  ctx.fillStyle = open > 0.05 ? '#7a2a2e' : 'transparent';
  if (open > 0.05) {
    ctx.beginPath(); ctx.ellipse(cx, 154, 11 + open * 2, 2 + open * 8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f3e8e8'; ctx.fillRect(cx - 8, 150 - 0, 16, Math.min(4, open * 5));
  } else {
    ctx.strokeStyle = '#8a3f3f'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(cx - 11, 153); ctx.quadraticCurveTo(cx, 158, cx + 11, 153); ctx.stroke();
  }
  // 頬
  ctx.fillStyle = 'rgba(240,120,120,0.16)';
  for (const dx of [-30, 30]) { ctx.beginPath(); ctx.ellipse(cx + dx, 140, 9, 5, 0, 0, Math.PI * 2); ctx.fill(); }
  // 眼鏡
  if (a.glasses) {
    ctx.strokeStyle = '#2b2b30'; ctx.lineWidth = 2.5;
    for (const dx of [-20, 20]) { ctx.beginPath(); ctx.roundRect?.(cx + dx - 15, 103, 30, 24, 7); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(cx - 5, 114); ctx.lineTo(cx + 5, 114); ctx.stroke();
  }
  ctx.restore();
}

// ---------- 写真のアナリスト ----------
export interface MouthPos { x: number; y: number; w: number; open: number; eye?: number }

/** 標準のアナリスト（public/analysts/default-male.jpg）の口の位置 */
export const DEFAULT_ANALYST_SRC = '/analysts/default-male.jpg';
export const DEFAULT_ANALYST_MOUTH: MouthPos = { x: 0.505, y: 0.482, w: 0.115, open: 0.019, eye: 1.0 };

/** パネル(w×h)に、写真を「上揃えのcover」で置いたときの描画位置 */
export function photoLayout(img: { naturalWidth: number; naturalHeight: number }, w: number, h: number) {
  const sc = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * sc, dh = img.naturalHeight * sc;
  return { dx: (w - dw) / 2, dy: 0, dw, dh };
}

// 目の下の頬の色（まぶたの色に使う）。写真と設定ごとに1回だけ取得する
const skinCache = new WeakMap<object, { key: string; rgb: string }>();
function sampleSkin(img: HTMLImageElement, m: MouthPos): string {
  const key = `${m.x},${m.y},${m.w},${m.eye}`;
  const c = skinCache.get(img);
  if (c && c.key === key) return c.rgb;
  let rgb = '200,160,135';
  try {
    const mWpx = m.w * img.naturalWidth;
    const ex = m.x * img.naturalWidth;
    const ey = m.y * img.naturalHeight - (m.eye ?? 1.0) * mWpx;
    const sx = Math.round(Math.min(img.naturalWidth - 4, Math.max(0, ex - 0.49 * mWpx - 2)));
    const sy = Math.round(Math.min(img.naturalHeight - 4, Math.max(0, ey + 0.42 * mWpx)));
    const cv = document.createElement('canvas');
    cv.width = 4; cv.height = 4;
    const cx = cv.getContext('2d')!;
    cx.drawImage(img, sx, sy, 4, 4, 0, 0, 4, 4);
    const d = cx.getImageData(0, 0, 4, 4).data;
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
    const n = d.length / 4;
    rgb = `${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)}`;
  } catch { /* 取得できないときは既定色 */ }
  skinCache.set(img, { key, rgb });
  return rgb;
}

/** まばたきの閉じ具合（0=開、1=閉）。約3.8秒ごとに0.16秒、ときどき二度続けて */
function blinkAmount(t: number): number {
  const cyc = t % 3.8;
  const f = (c: number) => (c >= 0 && c < 0.16 ? Math.sin((c / 0.16) * Math.PI) : 0);
  return Math.max(f(cyc - 3.5), (Math.floor(t / 3.8) % 4 === 2) ? f(cyc - 3.2) : 0);
}

/**
 * 写真のアナリストを (x,y,w,h) の枠に描く。
 * level（0〜1）：声の大きさ。大きいほど、下あごを下げて口を開く。
 * t：経過秒。呼吸・ゆれ・うなずき・まばたきに使う。
 * 口の位置は、写真に対する割合（口の中心＝唇の合わせ目）。
 */
export function drawPhotoAnalyst(ctx: CanvasRenderingContext2D, img: HTMLImageElement, m: MouthPos, x: number, y: number, w: number, h: number, level: number, t = 0): void {
  const L = photoLayout(img, w, h);
  const open = Math.max(0, Math.min(1, level));
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.translate(x, y);
  // 体全体の自然な動き：呼吸（拡大の揺れ）・ゆっくりした左右のゆれ・首の傾き・話すときの小さなうなずき
  const sway = Math.sin(t * 0.45) * 2.2 + Math.sin(t * 1.1 + 1) * 0.8;
  const bob = Math.sin(t * 0.9) * 1.0 + open * Math.sin(t * 6.5) * 1.4;
  const rot = Math.sin(t * 0.38) * 0.007 + open * Math.sin(t * 4.1) * 0.0035;
  const sc = 1.045 + Math.sin(t * 0.9) * 0.004;
  ctx.translate(w / 2 + sway, h + bob);
  ctx.rotate(rot);
  ctx.scale(sc, sc);
  ctx.translate(-w / 2, -h);
  ctx.drawImage(img, L.dx, L.dy, L.dw, L.dh);

  const mx = L.dx + m.x * L.dw, my = L.dy + m.y * L.dh, mW = m.w * L.dw;

  // まばたき
  const bl = blinkAmount(t);
  if (bl > 0.05) {
    const ey = my - (m.eye ?? 1.0) * mW;
    const skin = sampleSkin(img, m);
    for (const sx of [-1, 1]) {
      const ex = mx + sx * 0.49 * mW;
      const rx = 0.21 * mW;
      ctx.save();
      ctx.translate(ex, ey);
      ctx.scale(1, (0.13 * mW * bl + 0.5) / rx);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx * 1.25);
      g.addColorStop(0, `rgba(${skin},1)`);
      g.addColorStop(0.7, `rgba(${skin},1)`);
      g.addColorStop(1, `rgba(${skin},0)`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, rx * 1.25, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      // 閉じたまぶたの線（まつ毛）
      ctx.strokeStyle = `rgba(40,25,20,${0.5 * bl})`;
      ctx.lineWidth = Math.max(1, 0.022 * mW);
      ctx.beginPath();
      ctx.ellipse(ex, ey + 0.015 * mW, 0.18 * mW, 0.05 * mW * bl, 0, 0.12 * Math.PI, 0.88 * Math.PI);
      ctx.stroke();
    }
  }

  // 口パク：口まわりを細かい升目に分け、下あごのあたりだけ下へ引き伸ばす（境目が目立たない）
  if (open > 0.04) {
    const d = m.open * L.dh * open;
    const kx = img.naturalWidth / L.dw, ky = img.naturalHeight / L.dh;
    const cs = Math.max(2, mW / 14);
    const sm = (v: number) => { const u = Math.min(1, Math.max(0, v)); return u * u * (3 - 2 * u); };
    for (let cy = my - 0.4 * mW; cy < my + 1.7 * mW; cy += cs) {
      for (let cx = mx - 1.25 * mW; cx < mx + 1.25 * mW; cx += cs) {
        const px = cx + cs / 2, py = cy + cs / 2;
        const wx = Math.max(0, 1 - Math.pow((px - mx) / (1.2 * mW), 2));
        const wy = sm((py - my + 0.05 * mW) / (0.45 * mW)) * (1 - sm((py - my - 0.95 * mW) / (0.75 * mW)));
        const disp = d * wx * wy;
        ctx.drawImage(img, (cx - L.dx) * kx, (cy - disp - L.dy) * ky, (cs + 1) * kx, (cs + 1) * ky, cx, cy, cs + 1, cs + 1);
      }
    }
    // 口の中
    ctx.save();
    ctx.fillStyle = 'rgba(58, 14, 20, 0.95)';
    ctx.beginPath();
    ctx.ellipse(mx, my + d * 0.42, mW * 0.34, d * 0.55 + 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    if (d > 3) {
      ctx.fillStyle = 'rgba(245,240,235,0.9)';
      ctx.beginPath();
      ctx.ellipse(mx, my + d * 0.1, mW * 0.26, Math.max(1, d * 0.14), 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  ctx.restore();
}

// ---------- 口の形の画像を切り替えるアナリスト（標準） ----------
export type MouthFrame = 'neutral' | 'small' | 'mid' | 'a' | 'o';

export interface SpriteSet {
  frames: Record<MouthFrame, HTMLImageElement>;
  eyes: { lx: number; rx: number; y: number; r: number }; // 画像に対する割合（rは目の半幅＝画像の幅に対する割合）
}

export const DEFAULT_SPRITE_DIR = '/analysts/default';
// 標準の画像（254×491）での目の位置
export const DEFAULT_SPRITE_EYES = { lx: 88 / 254, rx: 167 / 254, y: 150 / 491, r: 17 / 254 };

export function loadDefaultSprites(): Promise<SpriteSet> {
  const names: MouthFrame[] = ['neutral', 'small', 'mid', 'a', 'o'];
  return Promise.all(names.map(n => new Promise<HTMLImageElement>((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error(`画像を読み込めません: ${n}`));
    img.src = `${DEFAULT_SPRITE_DIR}/${n}.png`;
  }))).then(imgs => ({
    frames: { neutral: imgs[0], small: imgs[1], mid: imgs[2], a: imgs[3], o: imgs[4] },
    eyes: DEFAULT_SPRITE_EYES,
  }));
}

/** 声の大きさ(0〜1)と時刻から、使う口の画像を選ぶ。母音は分からないので、「あ・え・お」を適度に混ぜて、吹き替えのように見せる */
export function pickMouthFrame(level: number, t: number): MouthFrame {
  if (level < 0.12) return 'neutral';
  const step = Math.floor(t * 11); // 約11コマ/秒で切り替える（ちらつき防止）
  const h = (Math.imul(step, 2654435761) >>> 0) % 7;
  if (level < 0.32) return h < 5 ? 'small' : 'mid';
  if (level < 0.58) return (['mid', 'mid', 'small', 'o', 'mid', 'a', 'mid'] as MouthFrame[])[h];
  return (['a', 'a', 'mid', 'o', 'a', 'mid', 'a'] as MouthFrame[])[h];
}

const spriteSkin = new WeakMap<object, string>();
function sampleSpriteSkin(set: SpriteSet): string {
  const c = spriteSkin.get(set);
  if (c) return c;
  let rgb = '205,165,140';
  try {
    const img = set.frames.neutral;
    const e = set.eyes;
    const cv = document.createElement('canvas');
    cv.width = 6; cv.height = 6;
    const cx = cv.getContext('2d')!;
    // 目の下の頬（目の少し下・外側）の色
    const sx = Math.round(e.lx * img.naturalWidth - 4), sy = Math.round(e.y * img.naturalHeight + e.r * img.naturalWidth * 0.9);
    cx.drawImage(img, sx, sy, 6, 6, 0, 0, 6, 6);
    const d = cx.getImageData(0, 0, 6, 6).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { if (d[i + 3] > 200) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; } }
    if (n) rgb = `${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)}`;
  } catch { /* 既定色 */ }
  spriteSkin.set(set, rgb);
  return rgb;
}

/** 口の形の画像セットのアナリストを、(x,y,w,h) の枠の下端に合わせて描く（背景は透明のまま） */
export function drawSpriteAnalyst(ctx: CanvasRenderingContext2D, set: SpriteSet, x: number, y: number, w: number, h: number, level: number, t = 0): void {
  const base = set.frames.neutral;
  const frame = set.frames[pickMouthFrame(level, t)];
  const sc0 = Math.max(w / base.naturalWidth, h / base.naturalHeight);
  const dw = base.naturalWidth * sc0, dh = base.naturalHeight * sc0;
  const dx = (w - dw) / 2, dy = h - dh; // 下揃え（肩を下端に合わせる）
  const open = Math.max(0, Math.min(1, level));
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.translate(x, y);
  // 呼吸・ゆれ・首の傾き・話すときのうなずき
  const sway = Math.sin(t * 0.45) * 2.0 + Math.sin(t * 1.1 + 1) * 0.7;
  const bob = Math.sin(t * 0.9) * 1.0 + open * Math.sin(t * 6.5) * 1.2;
  const rot = Math.sin(t * 0.38) * 0.006 + open * Math.sin(t * 4.1) * 0.003;
  const sc = 1.03 + Math.sin(t * 0.9) * 0.004;
  ctx.translate(w / 2 + sway, h + bob);
  ctx.rotate(rot);
  ctx.scale(sc, sc);
  ctx.translate(-w / 2, -h);
  ctx.drawImage(frame, dx, dy, dw, dh);

  // まばたき（目の上に、肌色のまぶたを重ねる）
  const bl = blinkAmount(t);
  if (bl > 0.05) {
    const e = set.eyes;
    const skin = sampleSpriteSkin(set);
    const rx = e.r * dw * 1.15;
    for (const ex0 of [e.lx, e.rx]) {
      const ex = dx + ex0 * dw, ey = dy + e.y * dh;
      ctx.save();
      ctx.translate(ex, ey);
      ctx.scale(1, (rx * 0.62 * bl + 0.4) / rx);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx * 1.2);
      g.addColorStop(0, `rgba(${skin},1)`);
      g.addColorStop(0.7, `rgba(${skin},1)`);
      g.addColorStop(1, `rgba(${skin},0)`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, rx * 1.2, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.strokeStyle = `rgba(50,32,26,${0.5 * bl})`;
      ctx.lineWidth = Math.max(0.8, rx * 0.09);
      ctx.beginPath();
      ctx.ellipse(ex, ey + rx * 0.05, rx * 0.8, rx * 0.2 * bl, 0, 0.12 * Math.PI, 0.88 * Math.PI);
      ctx.stroke();
    }
  }
  ctx.restore();
}
