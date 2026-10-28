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
// STORE_CUSTOM_PROMPTS（'custom-scene-prompts'）は、Stage D-4のカスタム場面チャット機能で使っていたストア。
// Stage E-5でlib/videoCustomScenePrompts.tsごと削除し、もう使っていない（既存ブラウザに残っていても害はないため、
// ストア自体の削除は行わない。新規作成もしない）。
// [Stage E-6の不具合修正] バージョン番号を6のまま据え置くと、過去の開発中（Stage D-8相当の試作、news-imagesストア追加）
// に一度バージョン7までブラウザ側のIndexedDBが進んでしまったユーザー環境で、indexedDB.openが
// 「requested version (6) is less than the existing version (7)」というVersionErrorで失敗し、アバター・背景・BGMが
// 一切読み込めなくなる不具合があった（IndexedDBはバージョンを下げて開けない仕様のため）。7に上げて解消する。
export function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 7);
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
