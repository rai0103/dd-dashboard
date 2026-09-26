// 証券会社アプリのスクリーンショット取り込み（保有銘柄の個別登録）。
// 画像の読み取り自体はCloudflare Worker（POST /api/extract-holdings → Claude Vision）で行い、
// ここでは「読み取り結果 → プレビュー行 → 保有資産（holdings）への置き換え」の変換だけを純粋関数で扱う。
// このファイルは外部importを持たないため、`node --test` から直接実行できる。

export type BrokerConfig = {
  key: string; // Worker側の BROKER_HINTS と同じキー
  label: string; // 画面表示名
  owner: string; // 保有資産の「口座（口座主）」欄。ポートフォリオ構成の「口座」タブの集計キーにもなる
  account: string; // NISA区分（"—"＝NISA枠外）
  // 取り込み前に登録されていた「合算1件」の資産名。個別銘柄を登録するとこれらは削除・非表示にする。
  // 投資収支Excel（実績パフォーマンス）由来の口座合算額（VIRTUAL_ACCOUNT_CONFIG の label）もこの名前で照合する。
  aggregateNames: string[];
  defaultRank: string; // A〜Eクラスの初期値
  hint: string; // 取り込み画面に表示する撮影のコツ
};

// 対応証券会社。新しい証券会社を追加するときはここに1件追加し、Worker（worker/src/extractHoldings.ts）の
// BROKER_HINTS に画面の読み方を追加する。
export const BROKERS: BrokerConfig[] = [
  {
    key: "moomoo",
    label: "moomoo証券",
    owner: "moomoo", // 口座主（lib/owners.ts の OWNER_MOOMOO と同じ値）
    account: "—",
    aggregateNames: ["moomoo証券"],
    defaultRank: "D",
    hint: "moomooアプリの「口座」画面で、保有銘柄一覧（銘柄名・評価額/数量・現在値/取得単価）が写るように撮影してください。銘柄が1画面に収まらない場合は、スクロールして複数枚選択できます。",
  },
];
export const brokerByKey = (key: string) => BROKERS.find((b) => b.key === key) ?? null;

export type ExtractedHolding = {
  name: string; code: string; quantity: number | null; market_value: number | null;
  current_price: number | null; avg_cost: number | null; currency: "USD" | "JPY";
};
export type Extraction = {
  holdings: ExtractedHolding[]; account_total: number | null; account_total_currency: "USD" | "JPY" | null;
  cash?: { currency: "USD" | "JPY"; amount: number }[]; notes: string;
};

export type PreviewRow = {
  key: string; include: boolean;
  name: string; code: string;
  quantity: number | null; marketValue: number | null; currentPrice: number | null; avgCost: number | null;
  valueCurrency: "USD" | "JPY";
  category: string; rank: string;
};

export type BrokerHolding = {
  id: string; name: string; category: string; rank: string; currency: "ドル" | "円";
  account: string; owner: string; amount: number;
  broker: string; ticker: string; quantity: number | null; valueCurrency: "USD" | "JPY";
  valueOriginal: number; price: number | null; avgCost: number | null; fxRate: number | null;
};

// 米国上場のレバレッジETF（銘柄名にBull/2x/3x等を含むものも対象）
const LEVERAGED = new Set(["SOXL", "TECL", "SPXL", "SPUU", "UPRO", "SSO", "TQQQ", "QLD", "MSFU", "METU", "NVDL", "NVDU", "TSLL", "TSLT", "FNGU", "CONL", "USD", "ROM", "LABU", "TNA", "FAS"]);
const SP500_ETF = new Set(["VOO", "SPY", "IVV", "SPLG", "SPYM", "RSP"]);
const NASDAQ_ETF = new Set(["QQQ", "QQQM", "ONEQ"]);
const GOLD_ETF = new Set(["GLD", "GLDM", "IAU", "AAAU"]);
const HIGH_DIV_ETF = new Set(["HDV", "VYM", "SPYD", "SCHD", "DGRO", "JEPI", "JEPQ"]);

// 銘柄コード・名称からカテゴリーを推定する（ユーザーがプレビューで変更可能）。
export function guessBrokerCategory(code: string, name: string, valueCurrency: "USD" | "JPY"): string {
  const c = String(code ?? "").trim().toUpperCase();
  const n = String(name ?? "").normalize("NFKC");
  if (LEVERAGED.has(c) || /\b(BULL|[23]X)\b|ブル|レバレッジ/i.test(n)) return valueCurrency === "JPY" ? "レバレッジETF（日）" : "レバレッジETF（米）";
  if (SP500_ETF.has(c)) return "SP500";
  if (NASDAQ_ETF.has(c)) return "Nasdaq";
  if (GOLD_ETF.has(c)) return "ゴールド";
  if (HIGH_DIV_ETF.has(c)) return "高配当ETF・投信（米）";
  return valueCurrency === "JPY" ? "個別（日）" : "個別（米）";
}

// ポートフォリオ構成の「為替」は、ドル円相場の影響を把握するためのもの。上場市場や表示通貨ではなく中身で決める：
// 米国株関連（米国株・米国株指数・米国ETF）はドル、日本株関連は円。日本上場の投信・ETFでもS&P500等の米国株連動ならドル。
const USD_CATEGORIES = new Set(["SP500", "Nasdaq", "個別（米）", "テックETF・投信（米）", "高配当ETF・投信（米）", "その他ETF・投信（米）", "レバレッジETF（米）", "ゴールド"]);
export function exposureCurrency(category: string, valueCurrency?: "USD" | "JPY"): "ドル" | "円" {
  if (category === "現金") return valueCurrency === "USD" ? "ドル" : "円"; // 現金だけは保有通貨そのもの
  return USD_CATEGORIES.has(category) ? "ドル" : "円";
}

// 評価額が読み取れなかった場合は 数量×現在値 で補完する。
export function rowValue(r: Pick<PreviewRow, "marketValue" | "quantity" | "currentPrice">): number | null {
  if (r.marketValue != null && r.marketValue > 0) return r.marketValue;
  if (r.quantity != null && r.currentPrice != null) return Math.round(r.quantity * r.currentPrice * 100) / 100;
  return null;
}

// 現金は「現金(ドル)」「現金(円)」の行として取り込む（合算エントリを置き換えたときに口座の現金が抜け落ちないように）。
export function cashRowName(currency: "USD" | "JPY"): string { return currency === "USD" ? "現金(ドル)" : "現金(円)"; }
export function extractionToPreviewRows(extraction: Extraction, broker: BrokerConfig): PreviewRow[] {
  const cashRows: PreviewRow[] = (extraction.cash ?? []).filter((c) => c.amount > 0).map((c, i) => ({
    key: `cash-${i}-${c.currency}`, include: true, name: cashRowName(c.currency), code: "",
    quantity: null, marketValue: c.amount, currentPrice: null, avgCost: null,
    valueCurrency: c.currency, category: "現金", rank: "A",
  }));
  return [...extraction.holdings.map((h, i) => {
    const code = String(h.code ?? "").trim().toUpperCase();
    const valueCurrency = h.currency === "JPY" ? "JPY" : "USD";
    return {
      key: `${i}-${code || h.name}`, include: true,
      name: String(h.name ?? "").trim(), code,
      quantity: h.quantity, marketValue: h.market_value, currentPrice: h.current_price, avgCost: h.avg_cost,
      valueCurrency, category: guessBrokerCategory(code, h.name, valueCurrency), rank: broker.defaultRank,
    } as PreviewRow;
  }), ...cashRows];
}

// 保有資産の銘柄名は楽天証券CSVと同じ「ティッカー 銘柄名」形式にする
// （実質保有銘柄ランキングが先頭のティッカーで同一銘柄を合算できるように）。
export function holdingDisplayName(code: string, name: string): string {
  const c = String(code ?? "").trim().toUpperCase();
  const n = String(name ?? "").trim();
  if (!c) return n;
  if (!n || n === c) return c; // 大文字小文字だけ違う社名（例：IonQ）は社名として残す
  // 既に「TSLA Tesla」形式ならそのまま。大文字小文字だけ一致する社名（Meta Platforms / SoFi Technologies）は社名なので付け足す
  return n.startsWith(`${c} `) ? n : `${c} ${n}`;
}

export function previewRowsToHoldings(rows: PreviewRow[], broker: BrokerConfig, usdJpy: number | null, genId: () => string): { holdings: BrokerHolding[]; errors: string[] } {
  const errors: string[] = [];
  const holdings: BrokerHolding[] = [];
  for (const r of rows.filter((x) => x.include)) {
    const value = rowValue(r);
    const label = holdingDisplayName(r.code, r.name) || "（名称なし）";
    if (value == null) { errors.push(`${label}: 評価額（または数量×現在値）がありません`); continue; }
    if (r.valueCurrency === "USD" && !(usdJpy && usdJpy > 0)) { errors.push(`${label}: USD/JPYレートがありません`); continue; }
    const amount = Math.round(r.valueCurrency === "USD" ? value * (usdJpy as number) : value);
    holdings.push({
      id: genId(), name: label, category: r.category, rank: r.rank, currency: exposureCurrency(r.category, r.valueCurrency),
      account: broker.account, owner: broker.owner, amount,
      broker: broker.key, ticker: r.code, quantity: r.quantity, valueCurrency: r.valueCurrency,
      valueOriginal: value, price: r.currentPrice, avgCost: r.avgCost, fxRate: r.valueCurrency === "USD" ? usdJpy : null,
    });
  }
  return { holdings, errors };
}

// 登録：この証券会社の既存エントリ（前回取り込んだ個別銘柄＋合算1件のエントリ）をすべて削除してから、新しい個別銘柄を追加する。
// 何度取り込み直しても増殖しない。他の証券会社・楽天証券の保有データには影響しない。
export function replaceBrokerHoldings<T extends { broker?: string; name: string }>(existing: T[], broker: BrokerConfig, incoming: T[]): T[] {
  const kept = existing.filter((h) => h.broker !== broker.key && !(!h.broker && broker.aggregateNames.includes(h.name)));
  return [...kept, ...incoming];
}

// 個別銘柄が登録済みの証券会社について、投資収支Excel由来の「合算1件」の仮想エントリを出さないためのラベル集合。
export function aggregateLabelsReplacedByBrokers(holdings: { broker?: string }[]): Set<string> {
  const out = new Set<string>();
  for (const b of BROKERS) if (holdings.some((h) => h.broker === b.key)) for (const n of b.aggregateNames) out.add(n);
  return out;
}

/* ---------------- スクショの純資産（JPY）との照合 ---------------- */

export type Reconciliation = {
  accountTotalJpy: number; // スクショに表示された純資産（JPY）
  computedJpy: number; // 取り込む行（銘柄＋現金）を usdJpy で円換算した合計
  diffJpy: number; // computedJpy - accountTotalJpy
  diffPct: number;
  impliedRate: number | null; // 純資産に一致するUSD/JPY（＝証券会社自身の換算レート）
};

// 証券会社の純資産は証券会社自身のレートで円換算されているため、市場レートで換算した合計とはレート差の分だけずれる。
// 純資産から逆算したレート（(純資産 − 円建て合計) ÷ ドル建て合計）を使えば、合計は丸め誤差の範囲で一致する。
export function reconcileWithAccountTotal(rows: PreviewRow[], usdJpy: number | null, extraction: Pick<Extraction, "account_total" | "account_total_currency">): Reconciliation | null {
  if (extraction.account_total == null || extraction.account_total_currency !== "JPY") return null;
  const included = rows.filter((r) => r.include);
  let usd = 0, jpy = 0;
  for (const r of included) {
    const v = rowValue(r);
    if (v == null) continue;
    if (r.valueCurrency === "USD") usd += v; else jpy += v;
  }
  const accountTotalJpy = extraction.account_total;
  const impliedRate = usd > 0 ? (accountTotalJpy - jpy) / usd : null;
  const computedJpy = jpy + (usdJpy ? usd * usdJpy : 0);
  const diffJpy = computedJpy - accountTotalJpy;
  return { accountTotalJpy, computedJpy, diffJpy, diffPct: accountTotalJpy ? (diffJpy / accountTotalJpy) * 100 : 0, impliedRate };
}

// 逆算レートを採用してよいか：市場レートとの差が maxGapPct 以内なら証券会社のレートとみなす。
// それ以上ずれる場合は、評価額の読み取り誤り・行の漏れ（画面外の銘柄）などの可能性が高いので採用しない。
export function isPlausibleBrokerRate(impliedRate: number | null, marketRate: number | null, maxGapPct = 1.5): boolean {
  if (!impliedRate || impliedRate <= 0) return false;
  if (!marketRate) return impliedRate > 50 && impliedRate < 400;
  return Math.abs(impliedRate / marketRate - 1) * 100 <= maxGapPct;
}
