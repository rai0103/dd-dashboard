// 証券会社アプリで省略・略称表示される銘柄名 → 正式名称の辞書。
// 大和コネクト証券の「株式」画面は日経新聞掲載名などの略称（例：純金信託・NF日経レバ）、「投資信託」画面は画面幅で
// 末尾が「…」に切れた名称（例：eMAXIS Slim 国内株式（TOPIX…）で表示されるため、読み取り後にここで正式名称へ補完する。
// 新しい略称が出てきたら1件追加する（辞書に無い名称はAIの読み取り結果のまま返し、プレビュー画面で手動修正してもらう）。
// このファイルは外部importを持たないため、`node --test` からも直接読み込める。

export type FundNameEntry = {
  name: string; // 正式名称
  code?: string; // 証券コード（上場銘柄のみ）
  aliases?: string[]; // 画面に出る略称・通称
};

export const FUND_NAME_DICTIONARY: FundNameEntry[] = [
  // 東証ETF・ETN（大和コネクト証券「株式」画面）
  { name: "純金上場信託（現物国内保管型）", code: "1540", aliases: ["純金信託", "金の果実", "純金上場信託", "1540"] },
  { name: "NEXT FUNDS 日経平均レバレッジ・インデックス連動型上場投信", code: "1570", aliases: ["NF日経レバ", "NF・日経レバ", "NF・日経レバETF", "日経レバ", "日経レバETF", "1570"] },
  // 投資信託（大和コネクト証券「投資信託」画面）
  { name: "eMAXIS Slim 国内株式(TOPIX)" },
  { name: "eMAXIS Slim 米国株式(S&P500)" },
  { name: "eMAXIS Slim 全世界株式(オール・カントリー)", aliases: ["オルカン"] },
  { name: "iFree 日経225インデックス", aliases: ["iFree日経225インデックス"] },
  { name: "iFreeNEXT NASDAQ100インデックス" },
  { name: "iFreeNEXT FANG+インデックス" },
  { name: "iFreeレバレッジ FANG+" },
  { name: "iFreeレバレッジ NASDAQ100" },
];

// 照合用の正規化：全角/半角（NFKC）・空白・中黒・末尾の省略記号の違いを無視する。
function normalize(s: string): string {
  return String(s ?? "").normalize("NFKC").replace(/[\s・]/g, "").replace(/(…|\.{2,}|‥)+$/, "").toUpperCase();
}
const isTruncated = (s: string) => /(…|\.{2,}|‥)\s*$/.test(String(s ?? "").normalize("NFKC"));

// 略称・省略表示を正式名称に解決する。解決できなければ null。
// 1) 正式名称・略称との完全一致 2) 末尾が「…」で切れている場合は、正式名称の先頭一致（候補が1件に絞れるときだけ）。
export function resolveFundName(raw: string): FundNameEntry | null {
  const key = normalize(raw);
  if (!key) return null;
  for (const e of FUND_NAME_DICTIONARY) {
    if (normalize(e.name) === key || (e.aliases ?? []).some((a) => normalize(a) === key)) return e;
  }
  if (isTruncated(raw)) {
    const hits = FUND_NAME_DICTIONARY.filter((e) => normalize(e.name).startsWith(key));
    if (hits.length === 1) return hits[0];
  }
  return null;
}
