// 解説動画用のAI呼び出し（ローカルAIプロキシ tts-server の POST /api/chat 経由）。
// 既存の lib/videoAiClient.ts（callAiTool）と同じ方式（tool use で構造化データだけを受け取る）だが、
// 参考資料（PDF・テキストのdocumentブロック）やプロンプトキャッシュを渡せるよう、systemとuser本文を
// ブロックの配列で受け取れるようにしたもの。APIキーはユーザー自身の tts-server/.env にあり、ここでは扱わない。
import { getTtsBaseUrl } from '../videoAudioMixer';
import { AiClientError } from '../videoAiClient';

export { AiClientError };

type Json = Record<string, unknown>;

function toStrictSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return schema;
  const s: Json = { ...(schema as Json) };
  if (s.type === 'object') {
    s.additionalProperties = false;
    if (s.properties && typeof s.properties === 'object') {
      const next: Json = {};
      for (const [k, v] of Object.entries(s.properties as Json)) next[k] = toStrictSchema(v);
      s.properties = next;
    }
  }
  if (s.type === 'array' && s.items) s.items = toStrictSchema(s.items);
  return s;
}

export interface ToolCall {
  system: { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }[];
  /** userメッセージの中身（参考資料のdocumentブロック＋指示文） */
  content: any[];
  toolName: string;
  toolDescription: string;
  inputSchema: Json;
  maxTokens?: number;
  signal?: AbortSignal;
}

async function post(body: Json, signal?: AbortSignal): Promise<{ ok: boolean; status: number; data: any }> {
  let resp: Response;
  try {
    resp = await fetch(`${getTtsBaseUrl()}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new AiClientError('ABORTED', '中止しました。');
    throw new AiClientError('SERVER_UNREACHABLE', `ローカルAIサーバー（${getTtsBaseUrl()}/api/chat）に接続できません。「npm run dev:video」または「npm run tts-server」で起動してください。`);
  }
  let data: any = null;
  try { data = await resp.json(); } catch { throw new AiClientError('BAD_RESPONSE', 'AIサーバーの応答を解析できませんでした。'); }
  return { ok: resp.ok, status: resp.status, data };
}

function errorMessage(data: any, status: number): string {
  if (data?.error === 'NO_API_KEY') return data.message || 'tts-server/.env に ANTHROPIC_API_KEY が設定されていません。';
  const m = (typeof data?.message === 'string' && data.message) || (typeof data?.error?.message === 'string' && data.error.message) || `HTTP ${status}`;
  return `AI呼び出しに失敗しました: ${m}`;
}

/**
 * toolを1つだけ指定して呼ばせ、その入力（構造化データ）を返す。
 * まず strict（スキーマ厳格化）で呼び、スキーマが複雑すぎる等で400になったら strict なしで1回だけやり直す
 * （その場合も呼び出し側で内容を検証・補正する）。
 */
export async function callTool<T = any>(req: ToolCall): Promise<T> {
  const content = [...req.content, { type: 'text', text: `\n（必ず ${req.toolName} ツールを呼び出して回答してください。通常の文章では返さないこと。）` }];
  const make = (strict: boolean): Json => ({
    system: req.system,
    max_tokens: req.maxTokens ?? 4096,
    messages: [{ role: 'user', content }],
    tools: [{ name: req.toolName, description: req.toolDescription, input_schema: toStrictSchema(req.inputSchema), ...(strict ? { strict: true } : {}) }],
    tool_choice: { type: 'auto' },
  });
  let r = await post(make(true), req.signal);
  if (!r.ok && r.status === 400 && r.data?.error !== 'NO_API_KEY' && /schema|strict|grammar|too (many|complex)/i.test(JSON.stringify(r.data))) {
    r = await post(make(false), req.signal);
  }
  if (!r.ok) {
    if (r.data?.error === 'NO_API_KEY') throw new AiClientError('NO_API_KEY', errorMessage(r.data, r.status));
    throw new AiClientError('UPSTREAM_ERROR', errorMessage(r.data, r.status));
  }
  const blocks: any[] = Array.isArray(r.data?.content) ? r.data.content : [];
  if (r.data?.stop_reason === 'max_tokens') throw new AiClientError('MAX_TOKENS', '出力が長すぎて途中で切れました。場面数を減らすか、もう一度お試しください。');
  const tu = blocks.find((b) => b?.type === 'tool_use' && b.name === req.toolName);
  if (!tu) {
    throw new AiClientError('NO_TOOL_USE', 'AIの応答に期待した形式のデータが含まれていませんでした。もう一度お試しください。');
  }
  return tu.input as T;
}
