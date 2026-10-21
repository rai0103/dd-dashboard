// BGM（MP3）ライブラリ（ブラウザ内に保存）
import { run, STORE_BGMS, STORE_BGMS_LONG } from './videoLocalDB';

const store = (long?: boolean) => (long ? STORE_BGMS_LONG : STORE_BGMS);

export interface SavedBgm {
  id: string;
  name: string;
  blob: Blob;
  createdAt: number;
}

export async function listBgms(long = false): Promise<SavedBgm[]> {
  const all = await run<SavedBgm[]>(store(long), 'readonly', s => s.getAll());
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

// 同じファイル（名前・サイズ・更新日時が同じ）は重複登録しない
export async function saveBgm(file: File, long = false): Promise<SavedBgm> {
  const id = `${file.name}|${file.size}|${file.lastModified}`;
  const item: SavedBgm = { id, name: file.name.replace(/\.[^.]+$/, ''), blob: file, createdAt: Date.now() };
  await run(store(long), 'readwrite', s => s.put(item));
  return item;
}

export async function deleteBgm(id: string, long = false): Promise<void> {
  await run(store(long), 'readwrite', s => s.delete(id));
}
