// [新規] 長尺動画作成のAIチャット機能（Stage D-2）の土台。
// ローカルAIプロキシ（tts-server の POST /api/chat。tts-server/server.js参照）を叩き、
// Anthropic Messages APIのtool use（構造化出力）を1つだけ受け取って返す薄いクライアント。
// セキュリティ・安定性のため、AIにコードや任意の描画命令を生成させることは一切せず、常に
// 「指定したtoolのinput_schemaに従った構造化データ」という範囲に出力を限定する（呼び出し元が
// さらにデータの内容を検証する想定。例：lib/videoCustomScene.tsのseriesキー検証）。
//
// ローカルAIサーバーのベースURLは、TTSと共通（lib/videoAudioMixer.ts の getTtsBaseUrl/setTtsBaseUrl）。
// APIキーはユーザー自身が tts-server/.env に設定する（本クライアントはAPIキーを一切扱わない）。

import { getTtsBaseUrl } from "./videoAudioMixer";

export class AiClientError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "AiClientError";
  }
}

export interface AiToolRequest {
  /** systemプロンプト（文体規則・few-shot例などをここに含める） */
  system: string;
  /** userメッセージ本文 */
  prompt: string;
  /** Anthropic tool use の tool 名 */
  toolName: string;
  toolDescription: string;
  /** JSON Schema（Anthropic input_schema形式） */
  inputSchema: Record<string, unknown>;
  maxTokens?: number;
}

function chatUrl(): string {
  return `${getTtsBaseUrl()}/api/chat`;
}

type JsonSchema = Record<string, unknown>;

/**
 * strict tool use（tools[].strict:true）の要件に合わせて、スキーマ中のすべてのobject型に
 * additionalProperties:false を再帰的に補う（配列のitems・anyOf/allOf内のobjectも含む）。
 * 呼び出し側（各UIの input_schema 定義）は通常のJSON Schemaだけを書けばよく、strict化特有の
 * 要件を個別に意識しなくてよいようにするための共通処理。
 */
function toStrictSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return schema;
  const s: JsonSchema = { ...(schema as JsonSchema) };
  if (s.type === "object") {
    s.additionalProperties = false;
    if (s.properties && typeof s.properties === "object") {
      const props = s.properties as Record<string, unknown>;
      const nextProps: Record<string, unknown> = {};
      for (const k of Object.keys(props)) {
        nextProps[k] = toStrictSchema(props[k]);
      }
      s.properties = nextProps;
    }
  }
  if (s.type === "array" && s.items) {
    s.items = toStrictSchema(s.items);
  }
  for (const key of ["anyOf", "allOf"] as const) {
    if (Array.isArray(s[key])) {
      s[key] = (s[key] as unknown[]).map(toStrictSchema);
    }
  }
  return s;
}

/**
 * AIにtoolを1つだけ指定して呼ばせ、その入力（構造化データ）を返す。
 * 注：Claude Sonnet 5.5等の新しいモデルでは tool_choice:{type:"tool"|"any"}（強制呼び出し）自体が
 * 400エラーになるため、tool_choice:{type:"auto"}＋tools[].strict:true（スキーマ厳格化）＋
 * プロンプト内の明示的な指示、という組み合わせで「実質的に必ずそのtoolを呼ばせる」方式にしている。
 * サーバー未起動／APIキー未設定／レスポンス異常は、それぞれ分かりやすいコード付きの例外として投げる
 * （呼び出し側のUIでそのままエラー文として表示できる想定）。
 */
export async function callAiTool<T = unknown>(req: AiToolRequest): Promise<T> {
  const { system, prompt, toolName, toolDescription, inputSchema, maxTokens } = req;

  let resp: Response;
  try {
    resp = await fetch(chatUrl(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        system,
        max_tokens: maxTokens ?? 1024,
        messages: [
          {
            role: "user",
            content: `${prompt}\n\n（必ず ${toolName} ツールを呼び出して回答してください。通常の文章では返さないこと。）`,
          },
        ],
        tools: [
          { name: toolName, description: toolDescription, input_schema: toStrictSchema(inputSchema), strict: true },
        ],
        tool_choice: { type: "auto" },
      }),
    });
  } catch {
    throw new AiClientError(
      "SERVER_UNREACHABLE",
      `ローカルAIサーバー（${chatUrl()}）に接続できません。「npm run tts-server」でサーバーを起動してください。`
    );
  }

  let data: unknown;
  try {
    data = await resp.json();
  } catch {
    throw new AiClientError("BAD_RESPONSE", "AIサーバーの応答を解析できませんでした。");
  }
  // tts-server自身のエラー（{error: "NO_API_KEY", message} 形）と、
  // tts-serverがそのまま中継したAnthropic Messages APIのエラー（{type:"error", error:{type, message}} 形）の
  // 両方を扱う。どちらかの形に合わせてメッセージを取り出す。
  const raw = (data && typeof data === "object" ? (data as Record<string, unknown>) : {}) as Record<string, unknown>;
  const errorField = raw.error;
  const errorCode = typeof errorField === "string" ? errorField : undefined;
  const nestedMessage =
    errorField && typeof errorField === "object" && typeof (errorField as Record<string, unknown>).message === "string"
      ? ((errorField as Record<string, unknown>).message as string)
      : undefined;
  const topMessage = typeof raw.message === "string" ? raw.message : undefined;

  if (!resp.ok) {
    if (errorCode === "NO_API_KEY") {
      throw new AiClientError(
        "NO_API_KEY",
        topMessage || "tts-server/.env にANTHROPIC_API_KEYが設定されていません。"
      );
    }
    const detail = topMessage || nestedMessage || `HTTP ${resp.status}`;
    throw new AiClientError("UPSTREAM_ERROR", `AI呼び出しに失敗しました: ${detail}`);
  }

  const content = Array.isArray(raw.content) ? (raw.content as Array<{ type?: string; name?: string; input?: unknown }>) : [];
  const toolUse = content.find((b) => b && b.type === "tool_use" && b.name === toolName);
  if (!toolUse) {
    throw new AiClientError(
      "NO_TOOL_USE",
      "AIの応答に期待した形式のデータが含まれていませんでした。もう一度お試しください。"
    );
  }
  return toolUse.input as T;
}
