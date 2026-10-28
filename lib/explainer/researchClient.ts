// AIによる参考情報の自動検索（Claude のWeb検索ツール + Gemini のGoogle検索グラウンディングを
// ローカルAIプロキシ tts-server の POST /api/research 経由でまとめて呼び出す）。
// 既存の lib/explainer/aiClient.ts・imageClient.ts と同じ方式：APIキーはユーザー自身の
// tts-server/.env にあり、ここでは扱わない。
import { getTtsBaseUrl } from '../videoAudioMixer';
import { AiClientError } from '../videoAiClient';

export { AiClientError };

export interface ResearchSourceResult {
  text: string;
  urls: { url: string; title: string }[];
  error?: string;
}

export interface ResearchResult {
  claude: ResearchSourceResult;
  gemini: ResearchSourceResult;
}

/**
 * テーマについて、Claude（Web検索ツール）とGemini（Google検索グラウンディング）それぞれに
 * 最新のWeb情報に基づく要約と出典URLを問い合わせる。どちらか一方が失敗しても、もう一方の結果は
 * そのまま返す（それぞれのerrorフィールドで個別に分かる。呼び出し側は両方のerrorが無い限りは
 * 部分的な結果として扱える）。
 */
export async function researchTopic(topic: string, signal?: AbortSignal): Promise<ResearchResult> {
  let resp: Response;
  try {
    resp = await fetch(`${getTtsBaseUrl()}/api/research`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ topic }),
      signal,
    });
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new AiClientError('ABORTED', '中止しました。');
    throw new AiClientError('SERVER_UNREACHABLE', `ローカルAIサーバー（${getTtsBaseUrl()}/api/research）に接続できません。「npm run dev:video」または「npm run tts-server」で起動してください。`);
  }
  let data: any = null;
  try { data = await resp.json(); } catch { throw new AiClientError('BAD_RESPONSE', '検索結果の応答を解析できませんでした。'); }
  if (!resp.ok) {
    const m = (typeof data?.message === 'string' && data.message) || `HTTP ${resp.status}`;
    throw new AiClientError('UPSTREAM_ERROR', `検索に失敗しました: ${m}`);
  }
  const norm = (v: any): ResearchSourceResult => ({
    text: typeof v?.text === 'string' ? v.text : '',
    urls: Array.isArray(v?.urls)
      ? v.urls.filter((u: any) => typeof u?.url === 'string').map((u: any) => ({ url: u.url, title: typeof u.title === 'string' ? u.title : u.url }))
      : [],
    error: typeof v?.error === 'string' ? v.error : undefined,
  });
  return { claude: norm(data?.claude), gemini: norm(data?.gemini) };
}
