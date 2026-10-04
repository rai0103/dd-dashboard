// 証券会社アプリの保有銘柄一覧スクリーンショットから、銘柄ごとの保有データをClaude（Vision）で構造化抽出する。
// Workerの POST /api/extract-holdings から呼ばれる。ローカル検証スクリプトからも同じ関数を使えるよう、
// Anthropicクライアントは呼び出し側から受け取る。
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { resolveFundName } from "./fundNames";

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
    "section は空文字、section_totals は空配列にしてください。",
  ].join("\n"),
  daiwa: [
    "これは大和コネクト証券アプリのスクリーンショットです。保有資産が画面ごとに分かれているため、複数枚の画像が渡されます。",
    "・「株式」画面：国内株式・ETFの一覧。各行は銘柄名（略称）・評価額（円）・保有株数。section は「株式」。",
    "・「外国株」画面：外国株式の一覧（ある場合）。section は「外国株」。評価額が円で表示されていれば currency は JPY。",
    "・「投資信託」画面：投資信託の一覧。各行は銘柄名（画面幅で末尾が「…」に省略されていることがある）・評価額（円）。口数が表示されていなければ quantity は null。section は「投資信託」。",
    "・「資産を見る」画面：すべての資産（株式＋外国株＋投資信託）の合計額。この合計額だけを account_total（JPY）に入れてください。この画面の資産区分ごとの内訳行は holdings に入れないでください。",
    "各画面の上部に表示される合計評価額（例：株式の合計、投資信託の合計）は section_totals に { section, amount } で入れてください（account_total には入れない）。「資産を見る」画面が無ければ account_total は null。",
    "銘柄名は画面の表記のまま（省略記号「…」も含めて）書き起こしてください。正式名称への補完はシステム側で行います。",
    "評価額・単価はすべて円建て（currency は JPY）です。損益・損益率・前日比は抽出不要です。証券コードが画面に表示されていなければ code は空文字。",
    "預り金・現金の残高が表示されていれば cash に入れてください（資産を見るの合計に含まれていない場合は notes にその旨を書く）。",
    "各銘柄の評価損益（損益額）が表示されていれば unrealized_pl に、損益率は unrealized_pl_pct に、取得金額が表示されていれば cost_basis に入れてください（マイナスは負の数）。",
    "summary.unrealized_pl には「資産を見る」画面の評価損益の合計を、無ければ各画面（株式・投資信託など）の上部に表示された評価損益の合計を足した額を入れてください。どこにも無ければ null。",
  ].join("\n"),
  ideco: [
    "これはiDeCo（個人型確定拠出年金）の加入者サイト「SMBC・DCナビ」の資産状況画面のスクリーンショットです。画面が縦に長いため複数枚に分かれていることがあります。",
    "・資産サマリー：「資産評価額」は account_total（JPY）に、「評価損益」は summary.unrealized_pl に、「運用利回り（当初から）」は summary.return_rate_pct（%の数値。例：5.23% → 5.23）に、「リスク」は summary.risk に画面の表記のまま（例：「12.34%」「中」）入れてください。",
    "・画面に基準日・時点の日付（例：2026/10/02時点）があれば as_of に YYYY-MM-DD で入れてください。無ければ空文字。",
    "・商品別内訳：各行の「カテゴリー」（例：国内株式、外国株式、国内債券、外国債券、バランス、元本確保型）を section に、「商品名」を name に、「資産評価額」を market_value に、「取得価額」を cost_basis に、「簿価損益」を unrealized_pl に、「損益率」を unrealized_pl_pct（%の数値）に入れてください。",
    "・数量（口数）・基準価額が表示されていれば quantity・current_price に、無ければ null。avg_cost は null。code は空文字。評価額はすべて円建て（currency は JPY）です。",
    "・損益がマイナス（▲、△、-、赤字表示）の場合は負の数にしてください。",
    "・商品名が「…」で省略されている場合は画面の表記のまま（省略記号も含めて）書き起こしてください。",
    "・資産配分の円グラフ・凡例の行や、拠出金額・掛金の履歴は holdings に入れないでください。",
    "section_totals は空配列、cash は空配列にしてください（元本確保型の定期預金・保険も holdings の1行として扱う）。",
  ].join("\n"),
  coincheck: [
    "これは暗号資産取引所Coincheckアプリの取引アカウント（ウォレット・資産）画面のスクリーンショットです。複数枚に分かれていることがあります。",
    "・画面上部の合計評価額（総資産・取引アカウント合計＝日本円＋暗号資産の合計、円）は account_total（JPY）に入れてください。",
    "・暗号資産ごとの行：通貨のシンボル（BTC、ETH、XRPなど）を code に、通貨名（ビットコイン、イーサリアムなど）を name に、保有数量を quantity に、円換算の評価額を market_value に入れてください。currency は JPY。",
    "・1通貨あたりの価格（レート）が表示されていれば current_price に（円）。取得単価・損益は抽出不要（avg_cost は null）。",
    "・日本円（JPY）の残高は holdings に入れず、cash に { currency: \"JPY\", amount } で入れてください。",
    "・保有数量が0、または評価額が0円の通貨は holdings に入れないでください。",
    "section は空文字、section_totals は空配列にしてください。",
  ].join("\n"),
};
// 証券会社によって画面に無い項目（取得価額・損益・運用利回りなど）は、ヒントに書いていなくても null／空文字で返させる。
const COMMON_HINT = "画面に表示されていない項目（cost_basis・unrealized_pl・unrealized_pl_pct・summary の各値・as_of など）は null（文字列は空文字）にしてください。";

export const ExtractedHoldingSchema = z.object({
  name: z.string().describe("銘柄名（画面の表記のまま）"),
  code: z.string().describe("ティッカー・証券コード（例：TSLA、IONQ）。画面に無ければ空文字"),
  quantity: z.number().nullable().describe("保有数量（株数・口数）"),
  market_value: z.number().nullable().describe("評価額（時価評価額）。カンマ等は除いた数値"),
  current_price: z.number().nullable().describe("現在値（1株あたり）"),
  avg_cost: z.number().nullable().describe("取得単価（平均取得単価）"),
  currency: z.enum(["USD", "JPY"]).describe("この銘柄の評価額・単価の通貨"),
  section: z.string().describe("どの画面・区分の銘柄か（例：株式、投資信託、iDeCoの商品カテゴリー）。区分が無ければ空文字"),
  cost_basis: z.number().nullable().describe("取得価額（この銘柄の取得金額の合計）"),
  unrealized_pl: z.number().nullable().describe("簿価損益・評価損益（マイナスは負の数）"),
  unrealized_pl_pct: z.number().nullable().describe("損益率（%の数値。例：12.5% → 12.5）"),
});
export const ExtractionSchema = z.object({
  holdings: z.array(ExtractedHoldingSchema),
  account_total: z.number().nullable().describe("口座全体の純資産・総資産（表示されていれば）"),
  account_total_currency: z.enum(["USD", "JPY"]).nullable(),
  cash: z.array(z.object({ currency: z.enum(["USD", "JPY"]), amount: z.number() })).describe("口座の現金残高（通貨ごと）。表示が無ければ空配列"),
  section_totals: z.array(z.object({ section: z.string(), amount: z.number() })).describe("画面・区分ごとに表示されている合計評価額（JPY）。無ければ空配列"),
  summary: z.object({
    unrealized_pl: z.number().nullable().describe("口座全体の評価損益（JPY）"),
    return_rate_pct: z.number().nullable().describe("運用利回り（当初から・%の数値）"),
    risk: z.string().describe("リスク（画面の表記のまま）。無ければ空文字"),
  }).describe("口座全体の損益サマリー（iDeCoなど）。無い項目は null／空文字"),
  as_of: z.string().describe("画面に表示された基準日（YYYY-MM-DD）。無ければ空文字"),
  notes: z.string().describe("読み取れなかった箇所・画面外で途切れていそうな銘柄などの注意点。無ければ空文字"),
});
export type Extraction = z.infer<typeof ExtractionSchema>;
// レスポンスでは、正式名称に補完した銘柄について画面の表記を name_raw に残す（プレビューで確認できるように）。
export type ResolvedHolding = Extraction["holdings"][number] & { name_raw?: string };
export type ResolvedExtraction = Omit<Extraction, "holdings"> & { holdings: ResolvedHolding[] };

// 省略・略称の銘柄名を辞書（fundNames.ts）で正式名称に補完する。証券コードが画面に無く辞書にあれば補う。
export function resolveHoldingNames(extraction: Extraction): ResolvedExtraction {
  return {
    ...extraction,
    // 名称も評価額も無い空行（モデルがまれに返す）は除く
    holdings: extraction.holdings.filter((h) => h.name?.trim() || h.market_value != null).map((h) => {
      const hit = resolveFundName(h.name);
      if (!hit) return h;
      const code = h.code?.trim() ? h.code : hit.code ?? "";
      return hit.name === h.name && code === h.code ? h : { ...h, name: hit.name, code, name_raw: h.name };
    }),
  };
}

export type ExtractImage = { mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; data: string };

export async function extractHoldings(client: Anthropic, broker: string, images: ExtractImage[]): Promise<{ extraction: ResolvedExtraction; model: string; stopReason: string | null; usage: { input_tokens: number; output_tokens: number } }> {
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
      "種類の異なる画面（例：株式画面と投資信託画面）が複数枚渡された場合は、すべての画面の銘柄を合わせて抽出してください。",
    ].join("\n"),
    messages: [
      {
        role: "user",
        content: [
          ...images.map((img) => ({ type: "image" as const, source: { type: "base64" as const, media_type: img.mediaType, data: img.data } })),
          { type: "text", text: `${hint}\n${COMMON_HINT}\n\n画面に表示されている保有銘柄を、上から順にすべて抽出してください。` },
        ],
      },
    ],
  });
  if (response.stop_reason === "refusal") throw new Error("画像の読み取りが拒否されました（refusal）");
  if (!response.parsed_output) throw new Error(`構造化データを取得できませんでした（stop_reason: ${response.stop_reason}）`);
  return { extraction: resolveHoldingNames(response.parsed_output), model: response.model, stopReason: response.stop_reason, usage: { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens } };
}
