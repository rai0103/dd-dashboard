import { storage } from "@/lib/storage";

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
  "classification_overrides",
  "category_default_ranks",
  "portfolio_checkpoints",
  "lifecycle_settings",
  "fixed_positions",
  "summary_prev_snapshot",
  "investment_performance_data",
] as const;

const SYNC_API_URL = "https://stock-prices.shinichiogasawara0103.workers.dev/sync";
// 個人利用の簡易パスコード（本人のみが使う前提。公開静的サイトのバンドルに含まれるため機密情報ではない）。
const SYNC_TOKEN = "_lqcQ601gIYh2OKb-af62BXWcugyDJss";

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

// 対象キーいずれかのローカル保存直後に呼ぶ。連続保存をまとめて1回のPUTにするためデバウンスする。
export function scheduleSyncPush(onResult?: (ok: boolean) => void) {
  markLocalUpdated();
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    pushSyncNow().then(onResult);
  }, 800);
}

export async function pushSyncNow(): Promise<boolean> {
  try {
    const data: Record<string, string> = {};
    for (const key of SYNC_KEYS) {
      const res = await storage.get(key);
      if (res && res.value != null) data[key] = res.value;
    }
    const res = await fetch(SYNC_API_URL, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Sync-Token": SYNC_TOKEN },
      body: JSON.stringify({ data }),
    });
    if (!res.ok) throw new Error(`sync PUT failed: ${res.status}`);
    const body = await res.json();
    if (body?.updatedAt) {
      markLocalUpdated(new Date(body.updatedAt).getTime());
      markSynced(new Date(body.updatedAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" }));
    }
    return true;
  } catch (e) {
    console.error("dd-dashboard sync push failed", e);
    return false;
  }
}

// サーバー側が新しければIndexedDBを上書きする。上書きが発生した場合はtrueを返す（呼び出し側でリロード等の反映を行う）。
export async function pullSyncAndApply(): Promise<boolean> {
  try {
    const res = await fetch(SYNC_API_URL, { headers: { "X-Sync-Token": SYNC_TOKEN } });
    if (!res.ok) throw new Error(`sync GET failed: ${res.status}`);
    const body = await res.json();
    if (!body?.updatedAt || !body?.data) return false;
    const serverMs = new Date(body.updatedAt).getTime();
    markSynced(new Date(body.updatedAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" }));
    if (serverMs <= getLocalUpdatedAtMs()) return false;
    for (const key of SYNC_KEYS) {
      const value = body.data[key];
      if (typeof value === "string") await storage.set(key, value);
    }
    markLocalUpdated(serverMs);
    return true;
  } catch (e) {
    console.error("dd-dashboard sync pull failed", e);
    return false;
  }
}
