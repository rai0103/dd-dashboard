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

/**
 * AIにtoolを1つだけ指定して強制的に呼ばせ（tool_choice）、その入力（構造化データ）を返す。
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
        messages: [{ role: "user", content: prompt }],
        tools: [{ name: toolName, description: toolDescription, input_schema: inputSchema }],
        tool_choice: { type: "tool", name: toolName },
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
  const d = (data && typeof data === "object" ? (data as Record<string, unknown>) : {}) as {
    error?: string;
    message?: string;
    content?: Array<{ type?: string; name?: string; input?: unknown }>;
  };

  if (!resp.ok) {
    if (d.error === "NO_API_KEY") {
      throw new AiClientError(
        "NO_API_KEY",
        d.message || "tts-server/.env にANTHROPIC_API_KEYが設定されていません。"
      );
    }
    throw new AiClientError("UPSTREAM_ERROR", `AI呼び出しに失敗しました: ${d.message || `HTTP ${resp.status}`}`);
  }

  const content = Array.isArray(d.content) ? d.content : [];
  const toolUse = content.find((b) => b && b.type === "tool_use" && b.name === toolName);
  if (!toolUse) {
    throw new AiClientError(
      "NO_TOOL_USE",
      "AIの応答に期待した形式のデータが含まれていませんでした。もう一度お試しください。"
    );
  }
  return toolUse.input as T;
}
