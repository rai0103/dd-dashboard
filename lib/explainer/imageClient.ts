// AI画像生成（Google Gemini API の Imagen、ローカルAIプロキシ tts-server の POST /api/image 経由）。
// 既存の lib/explainer/aiClient.ts（/api/chat・Anthropic）と同じ理由・同じ方式：APIキーはユーザー自身の
// tts-server/.env（gitignore対象。GEMINI_API_KEY）にあり、ここでは扱わない。
import { getTtsBaseUrl } from '../videoAudioMixer';
import { AiClientError } from '../videoAiClient';

export { AiClientError };

/**
 * 1枚の画像を生成して返す。prompt は英語（ExplainerSceneのvisual.imagePromptをそのまま渡す想定。
 * 実在の人物・ロゴ・既存作品を含めない前提で作られているプロンプト）。aspectRatio は動画の形式に合わせる
 * （長尺=16:9、ショート=9:16）。サーバー未起動・APIキー未設定・生成失敗（セーフティフィルタ等）は、
 * それぞれ分かりやすいコード付きの例外として投げる（呼び出し側のUIでそのままエラー文として表示できる想定）。
 */
export async function generateImage(prompt: string, aspectRatio: '16:9' | '9:16', signal?: AbortSignal): Promise<Blob> {
  let resp: Response;
  try {
    resp = await fetch(`${getTtsBaseUrl()}/api/image`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, aspectRatio }),
      signal,
    });
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new AiClientError('ABORTED', '中止しました。');
    throw new AiClientError('SERVER_UNREACHABLE', `ローカルAIサーバー（${getTtsBaseUrl()}/api/image）に接続できません。「npm run dev:video」または「npm run tts-server」で起動してください。`);
  }
  let data: any = null;
  try { data = await resp.json(); } catch { throw new AiClientError('BAD_RESPONSE', '画像生成サーバーの応答を解析できませんでした。'); }
  if (!resp.ok) {
    if (data?.error === 'NO_API_KEY') throw new AiClientError('NO_API_KEY', data.message || 'tts-server/.env に GEMINI_API_KEY が設定されていません。');
    const m = (typeof data?.message === 'string' && data.message) || (typeof data?.error?.message === 'string' && data.error.message) || `HTTP ${resp.status}`;
    throw new AiClientError('UPSTREAM_ERROR', `画像生成に失敗しました: ${m}`);
  }
  // Gemini画像生成（generateContent）のレスポンスは candidates[0].content.parts[] に
  // text/inlineData が混在する。inlineData を持つ最初のpartを画像として扱う。
  const parts = data?.candidates?.[0]?.content?.parts;
  const imgPart = Array.isArray(parts) ? parts.find((p: any) => p?.inlineData?.data) : null;
  const b64 = imgPart ? imgPart.inlineData.data : '';
  if (!b64) throw new AiClientError('NO_IMAGE', '画像を生成できませんでした（内容がポリシーに抵触した可能性があります）。もう一度お試しください。');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: imgPart.inlineData.mimeType || 'image/png' });
}
