// スライドへの画像の自動挿入：どの場面に画像を入れるか、AI生成とフリー素材のどちらにするかを決める（純粋な関数）。
// 実際の検索・採点・生成は components/ExplainerStudio.jsx の autoFillImages が行う。
// テスト：lib/explainer/autoImages.test.ts
import type { ExplainerScene } from './types.ts';

/** 画像にしない場面：タイトル・章の扉・まとめ・締め・参考資料と、数値の図解（実データのグラフ）・固定のデータ場面 */
const NO_IMAGE = new Set(['title', 'chapter', 'summary', 'cta', 'sources', 'number', 'bar', 'line', 'donut', 'yearCompare', 'fan', 'zoomLine', 'butterfly', 'ddHistory', 'timeline']);
/** 画像に向く順（0が最優先）。image（AIが画像向きとして作った場面）→ イメージ図 → それ以外の文字の図解 */
function tierOf(kind: string): number {
  if (kind === 'image') return 0;
  if (kind === 'illustration') return 1;
  return 2;
}
export function canHaveImage(sc: Pick<ExplainerScene, 'visual' | 'fixedKey'>): boolean {
  return !sc.fixedKey && !NO_IMAGE.has(sc.visual.kind);
}

/**
 * 画像を入れる場面の番号（並び順）を選ぶ。share（0〜1）は「画像を入れられる場面」に占める画像の割合。
 * すでに画像が付いている場面も割合に数え、足りない分だけ選ぶ。image→イメージ図→その他の順に選び、
 * その他の図解からは動画全体に散らばるように等間隔で選ぶ（画像が続きすぎないように）。
 */
export function pickImageScenes(scenes: Pick<ExplainerScene, 'visual' | 'fixedKey' | 'imageId'>[], share: number): number[] {
  const eligible = scenes.map((s, i) => ({ s, i })).filter((x) => canHaveImage(x.s));
  const want = Math.round(eligible.length * Math.max(0, Math.min(1, share)));
  const have = eligible.filter((x) => x.s.imageId).length;
  let need = want - have;
  if (need <= 0) return [];
  const free = eligible.filter((x) => !x.s.imageId);
  const picked: number[] = [];
  for (const tier of [0, 1]) {
    for (const x of free.filter((y) => tierOf(y.s.visual.kind) === tier)) { if (need <= 0) break; picked.push(x.i); need--; }
  }
  const rest = free.filter((y) => tierOf(y.s.visual.kind) === 2);
  if (need > 0 && rest.length) {
    const k = Math.min(need, rest.length);
    const step = rest.length / k;
    for (let j = 0; j < k; j++) picked.push(rest[Math.min(rest.length - 1, Math.floor(step * j + step / 2))].i);
  }
  return Array.from(new Set(picked)).sort((a, b) => a - b);
}

/**
 * 選んだ場面を、フリー素材とAI生成に分ける。aiShare（0〜1）＝AI生成の割合。写真素材で見つかりやすい場面
 * （freeFitが高い場面）からフリー素材に割り当て、残りをAI生成にする。
 */
export function splitFreeAi(indices: number[], freeFit: (i: number) => number, aiShare: number): { free: number[]; ai: number[] } {
  const aiN = Math.round(indices.length * Math.max(0, Math.min(1, aiShare)));
  const freeN = indices.length - aiN;
  const byFit = indices.slice().sort((a, b) => freeFit(b) - freeFit(a) || a - b);
  const free = byFit.slice(0, freeN).sort((a, b) => a - b);
  const ai = byFit.slice(freeN).sort((a, b) => a - b);
  return { free, ai };
}
