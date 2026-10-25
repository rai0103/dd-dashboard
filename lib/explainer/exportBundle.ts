// 書き出し一式（動画・サムネ画像・概要欄テキスト）を、指定したフォルダの中に「サムネの文字」の名前のフォルダを作ってまとめて保存する。
// Chrome / Edge の File System Access API（showDirectoryPicker）を使う。使えない・選ばれなかった場合は、
// 同じファイル名で通常のダウンロードとして保存する（フォルダ分けはされない）。
import { getSetting, setSetting } from './imageStore';

const FOLDER_KEY = 'export-folder-v1';

/** Windowsでも使えるファイル名にする（使えない記号を全角に置き換え、末尾の点・空白を除き、長すぎるものは切る） */
export function safeFileName(s: string, fallback = '解説動画'): string {
  const map: Record<string, string> = { '\\': '＼', '/': '／', ':': '：', '*': '＊', '?': '？', '"': '”', '<': '＜', '>': '＞', '|': '｜' };
  let t = String(s || '').replace(/[\\/:*?"<>|]/g, (c) => map[c]).replace(/[\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim();
  t = t.replace(/[. ]+$/g, '');
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(t)) t = `${t}_`;
  t = Array.from(t).slice(0, 80).join('');
  return t || fallback;
}

export function canPickFolder(): boolean {
  return typeof window !== 'undefined' && typeof (window as any).showDirectoryPicker === 'function';
}

export async function getSavedFolder(): Promise<any | null> {
  try { return (await getSetting<any>(FOLDER_KEY)) ?? null; } catch { return null; }
}

/** 保存先のフォルダを選ぶ（ボタンを押した直後に呼ぶこと：ブラウザの制限） */
export async function pickFolder(): Promise<any | null> {
  if (!canPickFolder()) return null;
  try {
    const h = await (window as any).showDirectoryPicker({ id: 'explainer-export', mode: 'readwrite', startIn: 'videos' });
    await setSetting(FOLDER_KEY, h);
    return h;
  } catch { return null; } // 選ぶのをやめた
}

/** 保存先への書き込み許可を確認する（必要ならブラウザが確認を出す。ボタンを押した直後に呼ぶこと） */
export async function ensureWritable(h: any): Promise<boolean> {
  if (!h) return false;
  try {
    const opts = { mode: 'readwrite' };
    if ((await h.queryPermission?.(opts)) === 'granted') return true;
    return (await h.requestPermission?.(opts)) === 'granted';
  } catch { return false; }
}

export interface BundleFile { name: string; blob: Blob }

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 20000);
}

/**
 * 一式を保存する。parent があればその中に folderName のフォルダを作って書き込み、保存先の表示名を返す。
 * 書き込めなかった場合は通常のダウンロードにする（返り値 null）。
 */
export async function saveBundle(parent: any | null, folderName: string, files: BundleFile[]): Promise<string | null> {
  if (parent) {
    try {
      const dir = await parent.getDirectoryHandle(folderName, { create: true });
      for (const f of files) {
        const fh = await dir.getFileHandle(f.name, { create: true });
        const w = await fh.createWritable();
        await w.write(f.blob);
        await w.close();
      }
      return `${parent.name}\\${folderName}`;
    } catch (e) {
      console.error('フォルダへの保存に失敗したため、ダウンロードで保存します', e);
    }
  }
  for (const f of files) { download(f.blob, f.name); await new Promise((r) => setTimeout(r, 400)); }
  return null;
}

/** 概要欄テキスト（タイトル・概要欄・タグ） */
export function descriptionText(title: string, description: string, tags: string[]): string {
  return [
    '【タイトル】', title, '',
    '【概要欄】', description, '',
    '【タグ】', tags.map((t) => t.replace(/^#/, '')).join(', '),
  ].join('\r\n').replace(/\r?\n/g, '\r\n');
}
