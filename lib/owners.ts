// 保有資産の「口座主」（owner）の値の定義と、旧値からの移行。
// 口座主は「どの証券会社の・誰の口座か」を表す。楽天証券は口座主ごとにCSVを取り込むため2つに分け、
// moomoo証券はスクショ取り込み（lib/brokerImport.ts の BROKERS の owner）で登録される。
// このファイルは外部importを持たないため、`node --test` から直接実行できる。

export const OWNER_RAKUTEN_SAKI = "楽天(saki)";
export const OWNER_RAKUTEN_SHIN = "楽天(shin)";
export const OWNER_MOOMOO = "moomoo";
export const OWNER_DAIWA = "大和コネクト証券";
export const OWNER_IDECO = "iDeCo";
export const OWNER_COINCHECK = "Coin Check"; // 投資収支Excelの口座名と同じ表記

// 保有銘柄一覧などで口座主を選ぶドロップダウンの選択肢
export const OWNER_OPTIONS = [OWNER_RAKUTEN_SAKI, OWNER_RAKUTEN_SHIN, OWNER_MOOMOO, OWNER_DAIWA, OWNER_IDECO, OWNER_COINCHECK];
// 楽天証券CSVの取り込み先として選べる口座主
export const RAKUTEN_OWNERS = [OWNER_RAKUTEN_SHIN, OWNER_RAKUTEN_SAKI];

// 画面表示用の口座名（凡例など表示だけに使う）。内部の値（集計・並び順・色・CSVの紐づけ・保存データ）は上の定数のまま変えない。
// 対応表に無い口座名はそのまま表示する。
export const OWNER_DISPLAY_LABELS: Record<string, string> = {
  [OWNER_RAKUTEN_SHIN]: "楽天証券（私）",
  [OWNER_RAKUTEN_SAKI]: "楽天証券（妻）",
  [OWNER_DAIWA]: "大和コネクト",
};
export function ownerDisplayLabel(owner: string): string {
  return OWNER_DISPLAY_LABELS[owner] ?? owner;
}

// 旧バージョンの値 → 新しい値
const LEGACY_OWNERS: Record<string, string> = { shin: OWNER_RAKUTEN_SHIN, saki: OWNER_RAKUTEN_SAKI };

export function migrateOwner(h: { owner?: string; broker?: string }): string | undefined {
  // moomooスクショ取り込みの初版は口座主を「moomoo証券」で登録していた
  if (h.broker === "moomoo") return OWNER_MOOMOO;
  return (h.owner && LEGACY_OWNERS[h.owner]) || h.owner;
}

// 保存済みの保有銘柄の口座主を新しい値に揃える。何度実行しても結果は同じ（冪等）。
export function migrateHoldingsOwners<T extends { owner?: string; broker?: string }>(list: T[]): { list: T[]; changed: boolean } {
  let changed = false;
  const out = list.map((h) => {
    const owner = migrateOwner(h);
    if (owner === h.owner) return h;
    changed = true;
    return { ...h, owner };
  });
  return { list: out, changed };
}

// 口座主ごとのCSVデータ日付（holdings_as_of）のキーも同様に移行する。
export function migrateAsOfKeys(map: Record<string, string>): { map: Record<string, string>; changed: boolean } {
  let changed = false;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(map ?? {})) {
    const nk = LEGACY_OWNERS[k] ?? k;
    if (nk !== k) changed = true;
    // 新旧両方のキーがある場合は新しい日付を残す
    if (!out[nk] || v > out[nk]) out[nk] = v;
  }
  return { map: out, changed };
}

// 楽天証券CSVのファイル名（例: assetbalance(all)_20260831_shin.csv）に含まれる shin / saki から口座主を判定する。
export function detectRakutenOwnerFromFileName(name: string): string | null {
  const lower = String(name ?? "").toLowerCase();
  if (/saki/.test(lower)) return OWNER_RAKUTEN_SAKI;
  if (/shin/.test(lower)) return OWNER_RAKUTEN_SHIN;
  return null;
}
