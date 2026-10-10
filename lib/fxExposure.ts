// ポートフォリオ構成「為替」タブ専用：銘柄ごとの「実質通貨エクスポージャー」（ドル円相場の影響を受けるか）の判定。
// 為替区分の判定ルールはこのファイルだけに置く（楽天CSV取込・証券会社スクショ取込・為替タブの集計・サマリー出力が共通で使う）。
// 上場市場や口座の通貨ではなく中身で決める：円建てで買う日本上場のS&P500投信・ETFでも中身が米国株ならドル。
// ただし為替ヘッジ付きの商品は為替変動の影響をほぼ受けないため円。
//
// ※証券会社別CSV・スクショの合計の整合性チェック（lib/brokerImport.ts の reconcileWithAccountTotal・sectionChecks）は
//   この判定を使わず、従来どおり各行の取引通貨（valueCurrency＝口座ベースのUSD/JPY）で集計する。両者を混ぜないこと。
//
// 判定順：①手動指定（fxManual）→ ②現金は保有通貨 → ③為替ヘッジ付き＝円 → ④対応表（銘柄名・ティッカー）
//        → ⑤米国系カテゴリー＝ドル → ⑥口座通貨（取引通貨 valueCurrency、無ければ取込時の通貨）
// このファイルは外部importを持たないため、`node --test` から直接実行できる。

export type FxCurrency = "ドル" | "円";

export interface FxExposureInput {
  name?: string | null;
  ticker?: string | null;
  category?: string | null;
  valueCurrency?: "USD" | "JPY" | string | null; // 取引通貨（スクショ取込のみ）
  currency?: string | null; // 取込時の通貨（楽天CSVの単位列由来の口座通貨・投資収支Excelの口座設定）。対応表に無い銘柄のフォールバック
  fxManual?: FxCurrency | null; // 構成表・取込プレビューでユーザーが手動指定した為替区分（最優先）
}

// 為替ヘッジ付きの判定：名称に「ヘッジ」を含む（「ヘッジなし」「ヘッジ無」は除く）。例：「上場米国株ヘッジ有」「（為替ヘッジあり）」「円ヘッジ」
const HEDGE_PATTERN = /ヘッジ/;
const UNHEDGED_PATTERN = /ヘッジ(なし|無し|無)/;

// 対応表：銘柄名・ティッカーのパターン → 実質通貨区分。上から順に最初に一致したものを使う。
// 米国株系のファンドが増えたらここに1行追加する。hedged: true は名称に「ヘッジ」が無いヘッジ付き商品の指定用（→円）。
export const FX_EXPOSURE_TABLE: { label: string; pattern: RegExp; currency: FxCurrency; hedged?: boolean }[] = [
  { label: "S&P500連動（VOO・SPY・1655・2558・eMAXIS Slim・楽天・プラス・SBI・V等）", pattern: /S&P\s*500|SP500|\bVOO\b|\bSPY\b|\bIVV\b/i, currency: "ドル" },
  { label: "NASDAQ100連動", pattern: /NASDAQ|ナスダック|\bQQQM?\b/i, currency: "ドル" },
  { label: "FANG+", pattern: /FANG/i, currency: "ドル" },
  { label: "米国株（名称に米国・アメリカ・USA）", pattern: /米国|アメリカ|\bUSA?\b/i, currency: "ドル" },
  { label: "ゴールド（ドル建てで値付け）", pattern: /ゴールド|純金|金プラス|\bGLD\b|\bIAU\b/i, currency: "ドル" },
  { label: "暗号資産（ドル建てで値付け）", pattern: /ビットコイン|イーサリアム|\bBTC\b|\bETH\b/i, currency: "ドル" },
];

// 米国系カテゴリー（対応表に一致しない個別株・テーマETF等）。ゴールド・暗号資産もドル建てで値付けされるためドル。
export const USD_EXPOSURE_CATEGORIES = new Set([
  "SP500", "Nasdaq", "個別（米）", "テックETF・投信（米）", "高配当ETF・投信（米）", "その他ETF・投信（米）", "レバレッジETF（米）", "ゴールド", "暗号資産",
]);

const norm = (s: unknown) => String(s ?? "").normalize("NFKC");

export function isCurrencyHedged(name: string | null | undefined): boolean {
  const n = norm(name);
  return HEDGE_PATTERN.test(n) && !UNHEDGED_PATTERN.test(n);
}

export function fxExposureOf(h: FxExposureInput): FxCurrency {
  if (h.fxManual === "ドル" || h.fxManual === "円") return h.fxManual;
  const fallback: FxCurrency = h.valueCurrency === "USD" ? "ドル" : h.valueCurrency === "JPY" ? "円" : h.currency === "ドル" ? "ドル" : "円";
  if (h.category === "現金") return fallback; // 現金だけは保有通貨そのもの
  const text = `${norm(h.ticker)} ${norm(h.name)}`;
  if (isCurrencyHedged(text)) return "円";
  const hit = FX_EXPOSURE_TABLE.find((e) => e.pattern.test(text));
  if (hit) return hit.hedged ? "円" : hit.currency;
  if (h.category && USD_EXPOSURE_CATEGORIES.has(h.category)) return "ドル";
  return fallback;
}
