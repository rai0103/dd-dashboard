// investment-shorts (lib/localDB.ts) を移植。DB名のみ 'dd-dashboard-video' に変更し、dd-dashboard本体のstorage.ts（idb使用）とは独立させる
// ブラウザ内データベース（IndexedDB）。背景画像・BGMの登録に共用する。サーバー送信なし
export const DB_NAME = 'dd-dashboard-video';
export const STORE_BACKGROUNDS = 'backgrounds';
export const STORE_BGMS = 'bgms';
// 長尺用（ショート用とは別に登録）
export const STORE_BACKGROUNDS_LONG = 'backgrounds-long';
export const STORE_BGMS_LONG = 'bgms-long';
export const STORE_ANALYSTS = 'analysts'; // 長尺のアナリスト画像
export const STORE_AVATARS = 'avatars'; // 長尺のアバター（人物の動画）

export function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 5);
    req.onupgradeneeded = () => {
      for (const name of [STORE_BACKGROUNDS, STORE_BGMS, STORE_BACKGROUNDS_LONG, STORE_BGMS_LONG, STORE_ANALYSTS, STORE_AVATARS]) {
        if (!req.result.objectStoreNames.contains(name)) {
          req.result.createObjectStore(name, { keyPath: 'id' });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then(db => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  }));
}
