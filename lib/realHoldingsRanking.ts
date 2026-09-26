import fundCompositions from "@/data/fund-compositions.json";

export type FundHoldingEntry = { ticker: string; name: string; weight: number };
export type FundEntry = {
  key: string;
  label: string;
  matchNamePattern?: string;
  matchCategories?: string[];
  holdings: FundHoldingEntry[];
};

export type RealHoldingRow = {
  key: string;
  displayName: string;
  ticker: string | null;
  total: number;
  pct: number;
  breakdown: { via: string; fundLabel: string | null; amount: number }[];
};

export type UnmatchedFundRow = { name: string; category: string; amount: number };

// 構成銘柄への分解を行う対象＝ファンド・ETF・投資信託のカテゴリー（個別株・ゴールド・現金・その他は分解しない）。
const FUND_TYPE_CATEGORIES = new Set([
  "SP500", "Nasdaq", "日本（N225・Topix）",
  "テックETF・投信（米）", "テックETF・投信（日）",
  "高配当ETF・投信（米）", "高配当ETF・投信（日）",
  "その他ETF・投信（米）", "その他ETF・投信（日）",
  "レバレッジETF（米）", "レバレッジETF（日）",
]);

function normalizeText(s: string): string {
  return String(s ?? "").normalize("NFKC").trim().toUpperCase();
}

function matchFund(holding: { name: string; category: string }, funds: FundEntry[]): FundEntry | null {
  // 銘柄名での判定（S&P500トップ20等の集中投資型ファンドを、より汎用的なカテゴリー一致より先に判定するため）を、
  // カテゴリー一致より優先する。カテゴリーだけが同じ「本家指数」ファンド（例：eMAXIS Slim S&P500）は、
  // 名前に個別ファンドのパターンが無いので、後段のカテゴリー一致にそのままフォールバックする。
  const normalizedName = normalizeText(holding.name);
  for (const fund of funds) {
    if (fund.matchNamePattern && new RegExp(fund.matchNamePattern, "i").test(normalizedName)) return fund;
  }
  for (const fund of funds) {
    if (fund.matchCategories?.includes(holding.category)) return fund;
  }
  return null;
}

// ゴールド（GLD・各種「ゴールドプラス」系ファンドのゴールド部分など）は銘柄ごとに分ける意味がないため、
// 保有ベヒクルによらず「ゴールド」1行にまとめて集計する。
const GOLD_ROW_KEY = "category:ゴールド";

// 現金は円・ドルを区別せず「キャッシュ（ドル/円）」1行にまとめて集計する。
const CASH_ROW_KEY = "category:現金";
const CASH_ROW_NAME = "キャッシュ（ドル/円）";

// 楽天証券CSVの銘柄名は「TSLA テスラ」「4661 オリエンタルランド」のように先頭がティッカー／証券コード。
// 先頭トークンを取り出し、日本株の4桁（英字混じり含む）コードは構成データの表記（例：9432.T）に揃える。
function tickerFromHoldingName(name: string): string | null {
  const head = normalizeText(name).split(/\s+/)[0];
  if (/^[0-9][0-9A-Z]{3}$/.test(head)) return `${head}.T`;
  if (/^[A-Z][A-Z0-9.]{0,5}$/.test(head)) return head;
  return null;
}

// 分解後の構成銘柄と、個別直接保有の銘柄を同一ティッカーとして合算できるよう、既知ティッカーの集合を作っておく。
const ALL_TICKERS = new Map<string, string>();
for (const fund of fundCompositions.funds as FundEntry[]) {
  for (const h of fund.holdings) {
    if (!h.ticker.startsWith("OTHERS")) ALL_TICKERS.set(normalizeText(h.ticker), h.name);
  }
}

export type RealHoldingsRankingResult = {
  ranking: RealHoldingRow[];
  unmatched: UnmatchedFundRow[];
  total: number;
  asOf: string;
  note: string;
  source: string;
};

// 保有銘柄（ETF/投信含む）を構成銘柄まで分解し、個別直接保有分と合算した「実質保有額」でランキングする。
// ファンド構成データが無い場合はそのファンド自体を1銘柄として計上し、unmatchedにも別途記録する
// （ランキング画面で「未対応」として一覧できるようにするため）。
export function computeRealHoldingsRanking(holdings: { name: string; category: string; amount: number }[]): RealHoldingsRankingResult {
  const total = holdings.reduce((s, h) => s + h.amount, 0) || 1;
  const funds = fundCompositions.funds as FundEntry[];
  const acc = new Map<string, RealHoldingRow>();
  const unmatchedMap = new Map<string, UnmatchedFundRow>();

  const addRow = (key: string, displayName: string, ticker: string | null, via: string, fundLabel: string | null, amount: number) => {
    let row = acc.get(key);
    if (!row) { row = { key, displayName, ticker, total: 0, pct: 0, breakdown: [] }; acc.set(key, row); }
    row.total += amount;
    // 同じファンドを複数口座・複数口座主で保有している場合、内訳表示では合算した1行にまとめる。
    const existing = row.breakdown.find((b) => b.via === via && b.fundLabel === fundLabel);
    if (existing) existing.amount += amount;
    else row.breakdown.push({ via, fundLabel, amount });
  };

  for (const h of holdings) {
    if (!(h.amount > 0)) continue;
    if (h.category === "ゴールド") {
      addRow(GOLD_ROW_KEY, "ゴールド", null, h.name, null, h.amount);
      continue;
    }
    if (h.category === "現金") {
      addRow(CASH_ROW_KEY, CASH_ROW_NAME, null, h.name, null, h.amount);
      continue;
    }
    const fund = matchFund(h, funds);
    if (fund) {
      for (const c of fund.holdings) {
        addRow(c.ticker, c.name, c.ticker.startsWith("OTHERS") ? null : c.ticker, h.name, fund.label, h.amount * c.weight);
      }
      continue;
    }
    // 分解対象カテゴリーだが構成データが未整備＝「未対応」
    if (FUND_TYPE_CATEGORIES.has(h.category)) {
      const cur = unmatchedMap.get(h.name) || { name: h.name, category: h.category, amount: 0 };
      cur.amount += h.amount;
      unmatchedMap.set(h.name, cur);
    }
    // 個別直接保有（または未対応ファンド）は、銘柄名先頭のティッカーが構成銘柄の既知ティッカーに一致すればそこへ合算し
    // （例：「TSLA テスラ」→ S&P500等の分解分「Tesla（テスラ）」と同じ行）、しなければ単独の行として計上する。
    const ticker = tickerFromHoldingName(h.name) ?? normalizeText(h.name);
    const knownName = ALL_TICKERS.get(ticker);
    if (knownName) addRow(ticker, knownName, ticker, h.name, null, h.amount);
    else addRow(`name:${h.name}`, h.name, null, h.name, null, h.amount);
  }

  const ranking = Array.from(acc.values())
    .map((r) => ({ ...r, pct: Number(((r.total / total) * 100).toFixed(2)), total: Math.round(r.total) }))
    .sort((a, b) => b.total - a.total);

  const unmatched = Array.from(unmatchedMap.values()).sort((a, b) => b.amount - a.amount);

  return { ranking, unmatched, total, asOf: fundCompositions.asOf, note: fundCompositions.note, source: fundCompositions.source };
}
