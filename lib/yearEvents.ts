// 年比較の一覧表「イベント」列のデータと文言生成。
// 1. 市場イベント年表（静的データ）：金融危機・暴落・地政学イベントなど。複数年にわたるものは end（最終年、null＝現在も継続）を持ち、
//    2年目以降は「（〇年目）」を自動で付ける。追加・修正は MARKET_EVENTS に1行足すだけでよい。
// 2. 米大統領（静的データ＋自動算出）：就任日の年表から、各年の「〇〇大統領（〇党）〇年目」または政権交代を生成する。
// このファイルは外部importを持たないため、`node --test` から直接実行できる。

export interface MarketEvent {
  start: number; // 発生年
  end?: number | null; // 複数年にわたる場合の最終年（null＝現在も継続中。省略＝その年のみ）
  label: string; // 2年目以降にも使う名称
  note?: string; // 発生年だけに添える補足（月など）
}
export const MARKET_EVENTS: MarketEvent[] = [
  { start: 1962, label: "キューバ危機", note: "10月" },
  { start: 1963, label: "ケネディ大統領暗殺", note: "11月" },
  { start: 1966, label: "信用収縮（クレジット・クランチ）" },
  { start: 1970, label: "景気後退・ペン・セントラル破綻", note: "6月" },
  { start: 1973, end: 1974, label: "第1次オイルショック", note: "10月" },
  { start: 1974, label: "ウォーターゲート事件・ニクソン辞任", note: "8月" },
  { start: 1979, end: 1980, label: "第2次オイルショック" },
  { start: 1987, label: "ブラックマンデー", note: "10月" },
  { start: 1990, label: "湾岸危機・S&L危機", note: "8月" },
  { start: 1994, label: "債券大暴落（FRB急利上げ）" },
  { start: 1997, label: "アジア通貨危機", note: "7月〜" },
  { start: 1998, label: "ロシア危機・LTCM破綻", note: "8〜9月" },
  { start: 2000, end: 2002, label: "ITバブル崩壊" },
  { start: 2001, label: "米同時多発テロ", note: "9月" },
  { start: 2002, label: "エンロン・ワールドコム不正会計" },
  { start: 2003, label: "イラク戦争開戦", note: "3月" },
  { start: 2007, end: 2009, label: "サブプライム・世界金融危機" },
  { start: 2008, label: "リーマンショック", note: "9月破綻・10月暴落" },
  { start: 2010, label: "欧州債務危機・フラッシュクラッシュ", note: "5月" },
  { start: 2011, label: "米国債格下げショック", note: "8月" },
  { start: 2011, label: "東日本大震災", note: "3月" },
  { start: 2013, label: "テーパー・タントラム", note: "5〜6月" },
  { start: 2015, label: "チャイナショック", note: "8月" },
  { start: 2016, label: "英国EU離脱決定", note: "6月" },
  { start: 2018, label: "VIXショック", note: "2月" },
  { start: 2018, end: 2019, label: "米中貿易摩擦" },
  { start: 2020, label: "コロナショック", note: "3月" },
  { start: 2022, end: null, label: "ロシアのウクライナ侵攻", note: "2月" },
  { start: 2022, label: "米FRB急速利上げ" },
  { start: 2023, label: "SVB破綻", note: "3月" },
  { start: 2025, label: "トランプ関税ショック", note: "4月" },
  { start: 2026, label: "イラン情勢緊迫", note: "3月" },
];

// その年に該当する市場イベントの文言（発生年は補足付き、2年目以降は「（〇年目）」）。end: null の継続中イベントは currentYear まで続ける。
export function marketEventsFor(year: number, currentYear: number, events: MarketEvent[] = MARKET_EVENTS): string[] {
  return events
    .filter((e) => { const last = e.end === undefined ? e.start : e.end === null ? currentYear : e.end; return year >= e.start && year <= last; })
    .map((e) => (year === e.start ? `${e.label}${e.note ? `（${e.note}）` : ""}` : `${e.label}（${year - e.start + 1}年目）`));
}

export interface President { name: string; party: "民主党" | "共和党"; start: string; note?: string } // start: 就任日 YYYY-MM-DD
export const PRESIDENTS: President[] = [
  { name: "アイゼンハワー", party: "共和党", start: "1953-01-20" },
  { name: "ケネディ", party: "民主党", start: "1961-01-20" },
  { name: "ジョンソン", party: "民主党", start: "1963-11-22" },
  { name: "ニクソン", party: "共和党", start: "1969-01-20" },
  { name: "フォード", party: "共和党", start: "1974-08-09" },
  { name: "カーター", party: "民主党", start: "1977-01-20" },
  { name: "レーガン", party: "共和党", start: "1981-01-20" },
  { name: "ブッシュ（父）", party: "共和党", start: "1989-01-20" },
  { name: "クリントン", party: "民主党", start: "1993-01-20" },
  { name: "ブッシュ（子）", party: "共和党", start: "2001-01-20" },
  { name: "オバマ", party: "民主党", start: "2009-01-20" },
  { name: "トランプ", party: "共和党", start: "2017-01-20" },
  { name: "バイデン", party: "民主党", start: "2021-01-20" },
  { name: "トランプ", party: "共和党", start: "2025-01-20", note: "2期目" },
];

// 「〇〇大統領（〇党）〇年目」／政権交代の年は「〇（〇党）→□大統領（□党）に交代」（1月以外の交代は月を添える）。
export function presidentFor(year: number, presidents: President[] = PRESIDENTS): string | null {
  const list = [...presidents].sort((a, b) => a.start.localeCompare(b.start));
  const startYear = (p: President) => Number(p.start.slice(0, 4));
  const party = (p: President) => `${p.party}${p.note ? `・${p.note}` : ""}`; // 例：共和党・2期目
  const changes = list.filter((p) => startYear(p) === year);
  const before = [...list].reverse().find((p) => startYear(p) < year) ?? null;
  if (changes.length) {
    const next = changes[changes.length - 1];
    const month = Number(next.start.slice(5, 7));
    if (!before) return `${next.name}大統領（${party(next)}）就任`;
    return `${before.name}（${party(before)}）→${next.name}大統領（${party(next)}）に交代${month === 1 ? "" : `（${month}月）`}`;
  }
  if (!before) return null;
  return `${before.name}大統領（${party(before)}）${year - startYear(before) + 1}年目`;
}

// 一覧表のイベント欄：市場イベント（あれば）と大統領情報を「／」でつなぐ。
export function yearEventText(year: number, currentYear: number): { market: string[]; president: string | null } {
  return { market: marketEventsFor(year, currentYear), president: presidentFor(year) };
}
