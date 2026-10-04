import { storage } from "@/lib/storage";
import { mergeSyncData, type SyncData } from "@/lib/syncMerge";

// PC⇔スマホ間で共有する必要があるキーのみを対象にする。
// voo_price_history: 名前に反しTwelve Data自動取得の値ではなく、S&P500本系列（Stooq CSV取り込み・直接入力）。
//   DD計算の根幹データであり手入力/取り込みのため同期対象に含める。
// spy_voo_price_history: VOO/QQQ終値。ページ読み込み時に自動取得した当日値もマージされるが、
//   Twelve Data APIが返さない過去日分の手動CSV取り込み・直接入力も同じキーに保存されるため同期対象に含める。
export const SYNC_KEYS = [
  "voo_price_history",
  "spy_voo_price_history",
  "portfolio_holdings",
  "holdings_as_of",
  "broker_summaries",
  "broker_holding_history",
  "classification_overrides",
  "category_default_ranks",
  "portfolio_checkpoints",
  "lifecycle_settings",
  "fixed_positions",
  "summary_prev_snapshot",
  "investment_performance_data",
] as const;

const SYNC_API_URL = "https://stock-prices.shinichiogasawara0103.workers.dev/sync";
// 個人利用の簡易パスコード。ビルド時にNEXT_PUBLIC_SYNC_TOKENから埋め込む（.env.local・CIのリポジトリシークレットで設定、
// git管理下には置かない）。静的サイトのJSバンドルには結局平文で含まれるため機密情報ではないが、リポジトリの検索性を避けるため。
const SYNC_TOKEN = process.env.NEXT_PUBLIC_SYNC_TOKEN || "";

const LOCAL_UPDATED_AT_KEY = "dd_sync_local_updated_at";
const LAST_SYNCED_AT_KEY = "dd_sync_last_synced_at";

function getLocalUpdatedAtMs(): number {
  try {
    const v = localStorage.getItem(LOCAL_UPDATED_AT_KEY);
    return v ? Number(v) : 0;
  } catch {
    return 0;
  }
}

function markLocalUpdated(atMs: number = Date.now()) {
  try {
    localStorage.setItem(LOCAL_UPDATED_AT_KEY, String(atMs));
  } catch {
    /* storage unavailable */
  }
}

export function getLastSyncedAt(): string | null {
  try {
    return localStorage.getItem(LAST_SYNCED_AT_KEY);
  } catch {
    return null;
  }
}

function markSynced(label: string) {
  try {
    localStorage.setItem(LAST_SYNCED_AT_KEY, label);
  } catch {
    /* storage unavailable */
  }
}

let pushTimer: ReturnType<typeof setTimeout> | null = null;

// 前回この端末が同期した時点のサーバーデータ（3-wayマージの基準）。IndexedDBに保存し、同期対象（SYNC_KEYS）には含めない。
const SYNC_BASE_KEY = "dd_sync_base";
type SyncBase = { updatedAt: string; data: SyncData };
async function loadBase(): Promise<SyncBase | null> {
  const res = await storage.get(SYNC_BASE_KEY);
  try { return res?.value ? (JSON.parse(res.value) as SyncBase) : null; } catch { return null; }
}
async function saveBase(updatedAt: string, data: SyncData) {
  await storage.set(SYNC_BASE_KEY, JSON.stringify({ updatedAt, data }));
}
async function readLocal(): Promise<SyncData> {
  const data: SyncData = {};
  for (const key of SYNC_KEYS) {
    const res = await storage.get(key);
    if (res && res.value != null) data[key] = res.value;
  }
  return data;
}
// マージ結果をIndexedDBに書き戻す。書き換えたキーがあればtrue
async function writeLocal(local: SyncData, merged: SyncData): Promise<boolean> {
  let changed = false;
  for (const key of SYNC_KEYS) {
    if (merged[key] === local[key]) continue;
    changed = true;
    if (merged[key] === undefined) await storage.delete(key);
    else await storage.set(key, merged[key]);
  }
  return changed;
}

// 送信時のマージで他端末の更新をこの端末のIndexedDBに取り込んだときの通知先（画面側で再読み込みして表示に反映する）
let mergedHandler: (() => void) | null = null;
export function onSyncMergedFromRemote(handler: (() => void) | null) { mergedHandler = handler; }

// 対象キーいずれかのローカル保存直後に呼ぶ。連続保存をまとめて1回のPUTにするためデバウンスする。
export function scheduleSyncPush(onResult?: (ok: boolean) => void) {
  markLocalUpdated();
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    pushSyncNow().then(onResult);
  }, 800);
}

// 送信前にサーバーの現在値を取得し、前回同期以降に他端末で更新されていれば3-wayマージしてから送る
// （丸ごと上書きすると、開きっぱなしの端末が他端末での取り込み・更新日を消してしまうため）。
export async function pushSyncNow(): Promise<boolean> {
  try {
    const local = await readLocal();
    let data = local;
    let mergedRemote = false;
    try {
      const cur = await fetch(SYNC_API_URL, { headers: { "X-Sync-Token": SYNC_TOKEN }, cache: "no-store" });
      if (cur.ok) {
        const server = await cur.json();
        const base = await loadBase();
        if (server?.updatedAt && server?.data && server.updatedAt !== base?.updatedAt) {
          data = mergeSyncData(base?.data ?? null, local, server.data);
          mergedRemote = await writeLocal(local, data);
        }
      }
    } catch { /* 取得できなければ従来どおりこの端末の値を送る */ }
    const res = await fetch(SYNC_API_URL, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Sync-Token": SYNC_TOKEN },
      body: JSON.stringify({ data }),
    });
    if (!res.ok) throw new Error(`sync PUT failed: ${res.status}`);
    const body = await res.json();
    if (body?.updatedAt) {
      await saveBase(body.updatedAt, data);
      markLocalUpdated(new Date(body.updatedAt).getTime());
      markSynced(new Date(body.updatedAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" }));
    }
    if (mergedRemote) mergedHandler?.();
    return true;
  } catch (e) {
    console.error("dd-dashboard sync push failed", e);
    return false;
  }
}

// サーバー側が新しければIndexedDBに反映する（未送信のこの端末の変更があれば3-wayマージで残す）。
// 反映が発生した場合はtrueを返す（呼び出し側でリロード等の反映を行う）。
export async function pullSyncAndApply(): Promise<boolean> {
  try {
    const res = await fetch(SYNC_API_URL, { headers: { "X-Sync-Token": SYNC_TOKEN }, cache: "no-store" });
    if (!res.ok) throw new Error(`sync GET failed: ${res.status}`);
    const body = await res.json();
    if (!body?.updatedAt || !body?.data) return false;
    const serverMs = new Date(body.updatedAt).getTime();
    markSynced(new Date(body.updatedAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" }));
    if (serverMs <= getLocalUpdatedAtMs()) return false;
    const local = await readLocal();
    const base = await loadBase();
    const merged = base ? mergeSyncData(base.data, local, body.data) : (body.data as SyncData);
    await writeLocal(local, merged);
    await saveBase(body.updatedAt, body.data);
    markLocalUpdated(serverMs);
    // この端末の未送信の変更を残した場合は、それを送る
    if (SYNC_KEYS.some((k) => merged[k] !== body.data[k])) scheduleSyncPush();
    return true;
  } catch (e) {
    console.error("dd-dashboard sync pull failed", e);
    return false;
  }
}
