// 画像のボカシ加工（ブラウザ内・無料）。画像全体、または指定した範囲（顔・看板など）だけをぼかす。
// ポリゴン風の加工（lowPoly.ts）と並ぶ、人物・建物などの画像を元のまま使わないための加工。
// テスト：lib/explainer/blur.test.ts（純粋な関数の部分）

/** ぼかす範囲（画像の幅・高さに対する割合 0〜1） */
export interface BlurRegion { x: number; y: number; w: number; h: number }
export interface BlurOptions {
  /** ぼかしの強さ（画像の長辺1000pxあたりのピクセル数。大きいほど強い） */
  strength: number;
  /** 範囲。空なら画像全体をぼかす */
  regions?: BlurRegion[];
  /** 範囲の形（楕円は顔向け） */
  shape?: 'rect' | 'ellipse';
  /** 書き出す画像の長辺の上限 */
  maxOutput?: number;
}

/** ドラッグした2点から、0〜1に収めた範囲を作る（小さすぎる範囲はnull） */
export function regionFromDrag(x0: number, y0: number, x1: number, y1: number): BlurRegion | null {
  const c = (v: number) => Math.min(1, Math.max(0, v));
  const ax = c(Math.min(x0, x1)), ay = c(Math.min(y0, y1)), bx = c(Math.max(x0, x1)), by = c(Math.max(y0, y1));
  if (bx - ax < 0.01 || by - ay < 0.01) return null;
  return { x: ax, y: ay, w: bx - ax, h: by - ay };
}

/** 画像の大きさに合わせた、実際のぼかしの半径（px） */
export function blurRadiusPx(strength: number, w: number, h: number): number {
  return Math.max(1, Math.round((strength * Math.max(w, h)) / 1000));
}

/** 縮小してから拡大する方法のぼかし（canvasのfilterが使えないブラウザ向け） */
function softBlur(src: CanvasImageSource, w: number, h: number, radius: number): HTMLCanvasElement {
  const k = Math.max(1, radius / 2);
  const sw = Math.max(1, Math.round(w / k)), sh = Math.max(1, Math.round(h / k));
  const small = document.createElement('canvas');
  small.width = sw; small.height = sh;
  const sc = small.getContext('2d')!;
  sc.imageSmoothingQuality = 'high';
  sc.drawImage(src, 0, 0, sw, sh);
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const oc = out.getContext('2d')!;
  oc.imageSmoothingEnabled = true; oc.imageSmoothingQuality = 'high';
  oc.drawImage(small, 0, 0, w, h);
  return out;
}

/** ぼかした画像全体（端が透けないよう、少し大きく描いてからぼかす） */
function blurredLayer(src: CanvasImageSource, w: number, h: number, radius: number): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const c = cv.getContext('2d')!;
  const hasFilter = typeof (c as any).filter === 'string' && !/^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  if (!hasFilter) return softBlur(src, w, h, radius);
  const m = radius * 2;
  c.filter = `blur(${radius}px)`;
  c.drawImage(src, -m, -m, w + m * 2, h + m * 2);
  c.filter = 'none';
  return cv;
}

export async function blurImage(src: Blob, opt: BlurOptions): Promise<Blob> {
  const bmp = await createImageBitmap(src);
  const k = Math.min(1, (opt.maxOutput ?? 2400) / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const c = cv.getContext('2d')!;
  c.drawImage(bmp, 0, 0, w, h);
  const radius = blurRadiusPx(opt.strength, w, h);
  const layer = blurredLayer(cv, w, h, radius);
  const regions = (opt.regions || []).filter((r) => r.w > 0 && r.h > 0);
  if (!regions.length) {
    c.clearRect(0, 0, w, h);
    c.drawImage(layer, 0, 0);
  } else {
    for (const r of regions) {
      c.save();
      c.beginPath();
      if (opt.shape === 'ellipse') c.ellipse((r.x + r.w / 2) * w, (r.y + r.h / 2) * h, (r.w / 2) * w, (r.h / 2) * h, 0, 0, Math.PI * 2);
      else c.rect(r.x * w, r.y * h, r.w * w, r.h * h);
      c.clip();
      c.drawImage(layer, 0, 0);
      c.restore();
    }
  }
  bmp.close?.();
  return await new Promise<Blob>((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('画像を作れませんでした'))), 'image/png'));
}
