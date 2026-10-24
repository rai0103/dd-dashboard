// 場面に追加した画像（ユーザーが権利を確認したもの）をブラウザ内（IndexedDB）に保存する。
// 長尺動画作成のDB（dd-dashboard-video）とは別のDBにして、既存のDBのバージョンには触れない。
import type { ImageAsset } from './types';

const DB = 'explainer-video';
const STORE = 'images';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then((db) => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  }));
}

export async function saveImage(file: File): Promise<ImageAsset> {
  const item: ImageAsset = { id: `img-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, name: file.name, blob: file, rightsConfirmed: true, createdAt: Date.now() };
  await run('readwrite', (s) => s.put(item));
  return item;
}
export async function listImages(): Promise<ImageAsset[]> { return run<ImageAsset[]>('readonly', (s) => s.getAll()); }
export async function deleteImage(id: string): Promise<void> { await run('readwrite', (s) => s.delete(id)); }
