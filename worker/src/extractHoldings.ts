// 証券会社アプリの保有銘柄一覧スクリーンショットから、銘柄ごとの保有データをClaude（Vision）で構造化抽出する。
// Workerの POST /api/extract-holdings から呼ばれる。ローカル検証スクリプトからも同じ関数を使えるよう、
// Anthropicクライアントは呼び出し側から受け取る。
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";

export const MODEL = "claude-opus-5";

// 証券会社ごとの画面の読み方のヒント。新しい証券会社に対応するときはここに1件追加する
// （フロント側の lib/brokerImport.ts の BROKERS にも同じ key で設定を追加する）。
const BROKER_HINTS: Record<string, string> = {
  moomoo: [
    "これはmoomoo証券アプリの「口座」画面（保有銘柄一覧）のスクリーンショットです。",
    "口座全体の純資産・総資産はJPYで表示されていることがありますが、個別銘柄の評価額・現在値・取得単価は米国株のためUSD建てです。",
    "各行はおおむね「銘柄名（上段）/ティッカー（下段）」「評価額/数量」「現在値/取得単価」の2段組みになっています。",
    "損益・損益率・当日損益の列は抽出不要です。",
    "画面上部の「純資産」（JPY）は account_total に、現金・預り金（USD/JPY）の残高が表示されていれば cash に入れてください。",
  ].join("\n"),
};

export const ExtractedHoldingSchema = z.object({
  name: z.string().describe("銘柄名（画面の表記のまま）"),
  code: z.string().describe("ティッカー・証券コード（例：TSLA、IONQ）。画面に無ければ空文字"),
  quantity: z.number().nullable().describe("保有数量（株数・口数）"),
  market_value: z.number().nullable().describe("評価額（時価評価額）。カンマ等は除いた数値"),
  current_price: z.number().nullable().describe("現在値（1株あたり）"),
  avg_cost: z.number().nullable().describe("取得単価（平均取得単価）"),
  currency: z.enum(["USD", "JPY"]).describe("この銘柄の評価額・単価の通貨"),
});
export const ExtractionSchema = z.object({
  holdings: z.array(ExtractedHoldingSchema),
  account_total: z.number().nullable().describe("口座全体の純資産・総資産（表示されていれば）"),
  account_total_currency: z.enum(["USD", "JPY"]).nullable(),
  cash: z.array(z.object({ currency: z.enum(["USD", "JPY"]), amount: z.number() })).describe("口座の現金残高（通貨ごと）。表示が無ければ空配列"),
  notes: z.string().describe("読み取れなかった箇所・画面外で途切れていそうな銘柄などの注意点。無ければ空文字"),
});
export type Extraction = z.infer<typeof ExtractionSchema>;

export type ExtractImage = { mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; data: string };

export async function extractHoldings(client: Anthropic, broker: string, images: ExtractImage[]): Promise<{ extraction: Extraction; model: string; stopReason: string | null; usage: { input_tokens: number; output_tokens: number } }> {
  const hint = BROKER_HINTS[broker] ?? "これは証券会社アプリの保有銘柄一覧画面のスクリーンショットです。";
  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: betaZodOutputFormat(ExtractionSchema) },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: [
      "あなたは証券会社アプリのスクリーンショットから保有銘柄データを正確に書き起こすアシスタントです。",
      "画面に表示されている数値だけを使い、推測で補完しないでください。読めない値は null にしてください。",
      "複数枚の画像が同じ銘柄を含む場合（スクロールして撮った重複など）は1件にまとめてください。",
    ].join("\n"),
    messages: [
      {
        role: "user",
        content: [
          ...images.map((img) => ({ type: "image" as const, source: { type: "base64" as const, media_type: img.mediaType, data: img.data } })),
          { type: "text", text: `${hint}\n\n画面に表示されている保有銘柄を、上から順にすべて抽出してください。` },
        ],
      },
    ],
  });
  if (response.stop_reason === "refusal") throw new Error("画像の読み取りが拒否されました（refusal）");
  if (!response.parsed_output) throw new Error(`構造化データを取得できませんでした（stop_reason: ${response.stop_reason}）`);
  return { extraction: response.parsed_output, model: response.model, stopReason: response.stop_reason, usage: { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens } };
}
