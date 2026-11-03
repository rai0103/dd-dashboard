// Stage F-3：画面の設定（声・アバター・BGM・背景・修正の記憶など）を、自動実行用の専用Chromeプロファイル
// （scripts/auto-run.mjsが使う別プロファイル）へ引き継ぐための書き出し／読み込み。
// investment-shortsのlib/profileSnapshot.ts（localStorage全体＋IndexedDBの全ストアを汎用的に
// シリアライズ／復元する仕組み）を参考に、dd-dashboard用（lib/videoLocalDB.ts）に合わせて新規実装した。
// investment-shorts本体のコードは一切コピーしていない。
import { openDB } from './videoLocalDB';

// 自動実行の実行状態（autorun-last等）はプロファイル間で共有させない
const SKIP_LS = /^(autorun-)/;

const toB64 = (buf: ArrayBuffer): Promise<string> =>
  new Promise((res) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] ?? '');
    r.readAsDataURL(new Blob([buf]));
  });
const fromB64 = (b64: string): Uint8Array => {
  const s = atob(b64);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function enc(v: any): Promise<any> {
  if (v instanceof Blob) return { __blob: await toB64(await v.arrayBuffer()), type: v.type };
  if (v instanceof ArrayBuffer) return { __ab: await toB64(v) };
  if (ArrayBuffer.isView(v)) {
    const ta = v as unknown as { constructor: { name: string }; buffer: ArrayBuffer; byteOffset: number; byteLength: number };
    return { __ta: ta.constructor.name, b64: await toB64(ta.buffer.slice(ta.byteOffset, ta.byteOffset + ta.byteLength) as ArrayBuffer) };
  }
  if (Array.isArray(v)) {
    const o: unknown[] = [];
    for (const x of v) o.push(await enc(x));
    return o;
  }
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v)) o[k] = await enc(v[k]);
    return o;
  }
  return v;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dec(v: any): any {
  if (Array.isArray(v)) return v.map(dec);
  if (v && typeof v === 'object') {
    if (typeof v.__blob === 'string') return new Blob([fromB64(v.__blob) as BlobPart], { type: v.type });
    if (typeof v.__ab === 'string') return fromB64(v.__ab).buffer;
    if (typeof v.__ta === 'string') {
      const u = fromB64(v.b64);
      const C = (globalThis as unknown as Record<string, new (b: ArrayBuffer) => unknown>)[v.__ta];
      return C ? new C(u.buffer as ArrayBuffer) : u;
    }
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v)) o[k] = dec(v[k]);
    return o;
  }
  return v;
}

/** 現在のブラウザの設定（localStorage全体＋lib/videoLocalDB.tsの全ストア）をJSON文字列にまとめる */
export async function exportVideoProfile(): Promise<string> {
  const ls: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (!SKIP_LS.test(k)) ls[k] = localStorage.getItem(k) ?? '';
    }
  } catch (e) { /* 無視（localStorageが使えない環境） */ }
  const idb: Record<string, unknown[]> = {};
  const db = await openDB();
  try {
    for (const name of Array.from(db.objectStoreNames)) {
      const rows = await new Promise<unknown[]>((res, rej) => {
        const r = db.transaction(name, 'readonly').objectStore(name).getAll();
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      idb[name] = await enc(rows);
    }
  } finally {
    db.close();
  }
  return JSON.stringify({ ls, idb });
}

/** exportVideoProfile() が作ったJSON文字列を、現在のブラウザのlocalStorage・IndexedDBへ反映する */
export async function importVideoProfile(text: string): Promise<void> {
  const d = JSON.parse(text) as { ls: Record<string, string>; idb: Record<string, unknown[]> };
  try {
    for (const [k, v] of Object.entries(d.ls ?? {})) localStorage.setItem(k, v);
  } catch (e) { /* 無視 */ }
  const db = await openDB();
  try {
    for (const [name, rows] of Object.entries(d.idb ?? {})) {
      if (!db.objectStoreNames.contains(name)) continue;
      await new Promise<void>((res, rej) => {
        const tx = db.transaction(name, 'readwrite');
        const st = tx.objectStore(name);
        for (const r of dec(rows) as unknown[]) st.put(r);
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
    }
  } finally {
    db.close();
  }
}
