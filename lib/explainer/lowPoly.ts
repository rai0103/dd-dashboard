// 画像をポリゴン風（ローポリ：三角形の面で塗り分けた絵）に加工する。ブラウザ内で完結し、費用はかからない。
// 仕組み：輪郭（明るさの変化が大きいところ）に点を多めに置き → 点を三角形でつなぐ（ドロネー分割）→
// 三角形ごとに元の画像の平均色で塗る。点の数（detail）が少ないほど大きな三角形になり、顔などの細部は分からなくなる。
// テスト：lib/explainer/lowPoly.test.ts（純粋な関数の部分）

export interface Pt { x: number; y: number }

/** 再現できる擬似乱数（同じ画像・同じ設定なら毎回同じ結果にする） */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

/**
 * ドロネー分割（Bowyer–Watson法）。三角形の頂点の番号の組を返す。点は数千個までを想定。
 */
export function delaunay(pts: Pt[]): [number, number, number][] {
  const n = pts.length;
  if (n < 3) return [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) { if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y; if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y; }
  const d = Math.max(maxX - minX, maxY - minY) * 20 || 1;
  const mx = (minX + maxX) / 2, my = (minY + maxY) / 2;
  const P = pts.concat([{ x: mx - d, y: my - d }, { x: mx, y: my + d }, { x: mx + d, y: my - d }]);
  type Tri = { a: number; b: number; c: number; cx: number; cy: number; r2: number };
  const circ = (a: number, b: number, c: number): Tri => {
    const A = P[a], B = P[b], C = P[c];
    const D = 2 * (A.x * (B.y - C.y) + B.x * (C.y - A.y) + C.x * (A.y - B.y)) || 1e-12;
    const a2 = A.x * A.x + A.y * A.y, b2 = B.x * B.x + B.y * B.y, c2 = C.x * C.x + C.y * C.y;
    const cx = (a2 * (B.y - C.y) + b2 * (C.y - A.y) + c2 * (A.y - B.y)) / D;
    const cy = (a2 * (C.x - B.x) + b2 * (A.x - C.x) + c2 * (B.x - A.x)) / D;
    return { a, b, c, cx, cy, r2: (A.x - cx) ** 2 + (A.y - cy) ** 2 };
  };
  let tris: Tri[] = [circ(n, n + 1, n + 2)];
  for (let i = 0; i < n; i++) {
    const p = P[i];
    const bad: Tri[] = [], keep: Tri[] = [];
    for (const t of tris) ((p.x - t.cx) ** 2 + (p.y - t.cy) ** 2 < t.r2 ? bad : keep).push(t);
    // 取り除いた三角形の外周の辺（2つの三角形で共有されていない辺）を求める
    const edges = new Map<string, [number, number]>();
    for (const t of bad) {
      for (const [u, v] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]] as [number, number][]) {
        const k = u < v ? `${u},${v}` : `${v},${u}`;
        if (edges.has(k)) edges.delete(k); else edges.set(k, [u, v]);
      }
    }
    for (const [u, v] of edges.values()) keep.push(circ(u, v, i));
    tris = keep;
  }
  return tris.filter((t) => t.a < n && t.b < n && t.c < n).map((t) => [t.a, t.b, t.c]);
}

/**
 * 点の配置：四隅・外周に等間隔の点＋輪郭の強さ（edge、0〜1の配列）に比例した確率で選んだ点＋全体に散らした点。
 * detail＝点の数のおおよその目安。edgeWeight（0〜1）が大きいほど輪郭に点が集まる。
 */
export function samplePoints(w: number, h: number, edge: Float32Array, detail: number, edgeWeight = 0.75, seed = 1): Pt[] {
  const R = rng(seed);
  const pts: Pt[] = [{ x: 0, y: 0 }, { x: w - 1, y: 0 }, { x: 0, y: h - 1 }, { x: w - 1, y: h - 1 }];
  const border = Math.max(4, Math.round(Math.sqrt(detail) / 2));
  for (let k = 1; k < border; k++) {
    const fx = (w - 1) * k / border, fy = (h - 1) * k / border;
    pts.push({ x: fx, y: 0 }, { x: fx, y: h - 1 }, { x: 0, y: fy }, { x: w - 1, y: fy });
  }
  const nEdge = Math.round(detail * edgeWeight), nUni = Math.max(0, detail - nEdge);
  // 輪郭の強さの累積分布から選ぶ
  const cum = new Float64Array(edge.length);
  let acc = 0;
  for (let i = 0; i < edge.length; i++) { acc += edge[i] * edge[i] + 1e-6; cum[i] = acc; }
  for (let k = 0; k < nEdge; k++) {
    const r = R() * acc;
    let lo = 0, hi = cum.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < r) lo = m + 1; else hi = m; }
    pts.push({ x: (lo % w) + R() - 0.5, y: Math.floor(lo / w) + R() - 0.5 });
  }
  for (let k = 0; k < nUni; k++) pts.push({ x: R() * (w - 1), y: R() * (h - 1) });
  // ほぼ同じ位置の点は除く（細すぎる三角形を減らす）
  const seen = new Set<string>();
  return pts.filter((p) => { const key = `${Math.round(p.x / 2)},${Math.round(p.y / 2)}`; if (seen.has(key)) return false; seen.add(key); return true; });
}

/** 明るさの変化（Sobel）を0〜1にした配列 */
export function edgeMap(gray: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  let max = 1e-6;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = -gray[i - w - 1] - 2 * gray[i - 1] - gray[i + w - 1] + gray[i - w + 1] + 2 * gray[i + 1] + gray[i + w + 1];
      const gy = -gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1] + gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1];
      const m = Math.sqrt(gx * gx + gy * gy);
      out[i] = m; if (m > max) max = m;
    }
  }
  for (let i = 0; i < out.length; i++) out[i] /= max;
  return out;
}

export interface LowPolyOptions { detail: number; edgeWeight?: number; maxOutput?: number; seed?: number }

/** ブラウザ用：画像（Blob）をポリゴン風にしたPNGのBlobを返す */
export async function lowPolyImage(src: Blob, opt: LowPolyOptions): Promise<Blob> {
  const bmp = await createImageBitmap(src);
  // 解析用の縮小画像（長辺700px）
  const scale = Math.min(1, 700 / Math.max(bmp.width, bmp.height));
  const w = Math.max(8, Math.round(bmp.width * scale)), h = Math.max(8, Math.round(bmp.height * scale));
  const work = document.createElement('canvas'); work.width = w; work.height = h;
  const wc = work.getContext('2d', { willReadFrequently: true })!;
  wc.drawImage(bmp, 0, 0, w, h);
  const data = wc.getImageData(0, 0, w, h).data;
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  const edge = edgeMap(gray, w, h);
  const pts = samplePoints(w, h, edge, Math.max(30, Math.round(opt.detail)), opt.edgeWeight ?? 0.75, opt.seed ?? 7);
  const tris = delaunay(pts);
  // 出力（長辺 maxOutput px。既定1920）
  const outScale = Math.min(opt.maxOutput ?? 1920, Math.max(bmp.width, bmp.height)) / Math.max(w, h);
  const out = document.createElement('canvas');
  out.width = Math.round(w * outScale); out.height = Math.round(h * outScale);
  const oc = out.getContext('2d')!;
  oc.lineJoin = 'round';
  const px = (x: number, y: number) => { const i = (Math.min(h - 1, Math.max(0, Math.round(y))) * w + Math.min(w - 1, Math.max(0, Math.round(x)))) * 4; return [data[i], data[i + 1], data[i + 2]]; };
  for (const [a, b, c] of tris) {
    const A = pts[a], B = pts[b], C = pts[c];
    const gx = (A.x + B.x + C.x) / 3, gy = (A.y + B.y + C.y) / 3;
    // 重心と、重心から各頂点へ半分寄った3点の色の平均
    let r = 0, g = 0, bl = 0;
    for (const [sx, sy] of [[gx, gy], [(gx + A.x) / 2, (gy + A.y) / 2], [(gx + B.x) / 2, (gy + B.y) / 2], [(gx + C.x) / 2, (gy + C.y) / 2]]) {
      const [cr, cg, cb] = px(sx, sy); r += cr; g += cg; bl += cb;
    }
    const col = `rgb(${Math.round(r / 4)},${Math.round(g / 4)},${Math.round(bl / 4)})`;
    oc.fillStyle = col; oc.strokeStyle = col; oc.lineWidth = 1;
    oc.beginPath();
    oc.moveTo(A.x * outScale, A.y * outScale); oc.lineTo(B.x * outScale, B.y * outScale); oc.lineTo(C.x * outScale, C.y * outScale);
    oc.closePath(); oc.fill(); oc.stroke(); // 線も同じ色で描き、三角形のすき間（背景の透け）を防ぐ
  }
  bmp.close?.();
  return await new Promise<Blob>((res, rej) => out.toBlob((b) => (b ? res(b) : rej(new Error('画像を書き出せませんでした'))), 'image/png'));
}

/** AI（Gemini）で加工するときの指示文 */
export const AI_LOWPOLY_PROMPT = 'Redraw this image as low-poly polygon art: a geometric illustration made of flat-shaded triangular facets with visible edges, like a 3D low-poly render. Keep the same composition, pose, framing and overall colors. Simplify all faces into a few large facets so that individual facial features and identity are not reproduced in detail. No text, no logos, no watermark.';
