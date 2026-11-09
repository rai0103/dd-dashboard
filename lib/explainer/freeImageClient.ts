// 著作権フリー画像の検索（日本文化動画アプリと同じ検索先。ローカルAIプロキシ tts-server の
// POST /api/free-images・GET /api/free-image-proxy 経由。サーバー側の実装は tts-server/freeImages.js）。
// 検索先：美術館（The Met・シカゴ美術館・クリーブランド美術館・スミソニアン。CC0）、Wikimedia Commons・Wikipedia
// （パブリックドメイン・CC0・CC BY・CC BY-SA のみ）、Openverse（商用可のCCのみ）、Pixabay・Pexels（キーがあれば）。
import { getTtsBaseUrl } from '../videoAudioMixer';
import { AiClientError } from '../videoAiClient';
import type { ImageCredit } from './types';

export { AiClientError };

export interface FreeImageCandidate {
  id: string;
  url: string;
  thumbnailUrl: string;
  source: string;
  caption?: string;
  credit?: string;
  pageUrl?: string;
  width?: number;
  height?: number;
}

const unreachable = () => new AiClientError('SERVER_UNREACHABLE', `ローカルAIサーバー（${getTtsBaseUrl()}）に接続できません。「npm run dev:video」または「npm run tts-server」で起動してください（起動済みなら、一度止めて起動し直してください）。`);

/** キーワードでフリー素材を検索する。terms は日本語キーワードから作った英語の検索語（サーバーが返す。表示用） */
export async function searchFreeImages(keyword: string, opts: { context?: string; max?: number; enTerms?: string[]; signal?: AbortSignal } = {}): Promise<{ items: FreeImageCandidate[]; terms: string[] }> {
  let resp: Response;
  try {
    resp = await fetch(`${getTtsBaseUrl()}/api/free-images`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ keyword, context: opts.context || '', max: opts.max || 30, ...(opts.enTerms?.length ? { enTerms: opts.enTerms } : {}) }),
      signal: opts.signal,
    });
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new AiClientError('ABORTED', '中止しました。');
    throw unreachable();
  }
  if (resp.status === 404) throw new AiClientError('SERVER_OUTDATED', 'ローカルAIサーバーが古いままです。tts-server を一度止めて、起動し直してください。');
  let data: any = null;
  try { data = await resp.json(); } catch { throw new AiClientError('BAD_RESPONSE', '検索サーバーの応答を解析できませんでした。'); }
  if (!resp.ok) throw new AiClientError('UPSTREAM_ERROR', `検索に失敗しました: ${data?.message || `HTTP ${resp.status}`}`);
  return { items: Array.isArray(data?.items) ? data.items : [], terms: Array.isArray(data?.terms) ? data.terms : [] };
}

/** 素材をサーバー経由で読み込むURL（外部サイトの画像を直接Canvasに描くと書き出しできなくなるため） */
export function proxiedUrl(url: string, mid?: string): string {
  return `${getTtsBaseUrl()}/api/free-image-proxy?url=${encodeURIComponent(url)}${mid ? `&mid=${encodeURIComponent(mid)}` : ''}`;
}

/** 選んだ素材を取り込み、画像ライブラリに保存できる File と出典情報にする */
export async function fetchFreeImage(c: FreeImageCandidate): Promise<{ file: File; credit: ImageCredit }> {
  let resp: Response;
  try { resp = await fetch(proxiedUrl(c.url, c.id)); } catch { throw unreachable(); }
  if (!resp.ok) throw new AiClientError('UPSTREAM_ERROR', `画像を取り込めませんでした（${resp.status}）。別の画像を選んでください。`);
  const blob = await resp.blob();
  const type = blob.type && blob.type.startsWith('image/') ? blob.type : 'image/jpeg';
  const ext = /png/.test(type) ? 'png' : /webp/.test(type) ? 'webp' : 'jpg';
  const file = new File([blob], `free-${c.id}.${ext}`.replace(/[^\w.-]/g, '_'), { type });
  const credit: ImageCredit = { source: c.source, ...(c.caption ? { caption: c.caption } : {}), ...(c.credit ? { credit: c.credit } : {}), ...(c.pageUrl ? { pageUrl: c.pageUrl } : {}) };
  return { file, credit };
}

/**
 * 候補画像をAI（Gemini・画像を見て判定）が場面に合うか0〜10点で採点する（日本文化動画アプリと同じ方式）。
 * GEMINI_API_KEY が無い・失敗した場合は null（呼び出し側は検索の並び順のまま使う）。
 */
export async function rankFreeImages(scene: { narration: string; subject?: string; title?: string; topic?: string }, candidates: FreeImageCandidate[], signal?: AbortSignal): Promise<Map<string, { score: number; reason: string }> | null> {
  try {
    const resp = await fetch(`${getTtsBaseUrl()}/api/free-images/rank`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...scene, candidates: candidates.slice(0, 16).map((c) => ({ id: c.id, thumbnailUrl: c.thumbnailUrl, url: c.url, caption: c.caption, source: c.source })) }),
      signal,
    });
    if (!resp.ok) return null;
    const d: any = await resp.json();
    return new Map((Array.isArray(d?.scores) ? d.scores : []).map((x: any) => [String(x.id), { score: Number(x.score) || 0, reason: String(x.reason || '') }]));
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new AiClientError('ABORTED', '中止しました。');
    return null;
  }
}
