// 背景画像ライブラリ（ブラウザ内に保存）
import { run, STORE_BACKGROUNDS, STORE_BACKGROUNDS_LONG } from './videoLocalDB';

const store = (long?: boolean) => (long ? STORE_BACKGROUNDS_LONG : STORE_BACKGROUNDS);

export interface SavedBackground {
  id: string;
  name: string;
  blob: Blob;
  createdAt: number;
}

export async function listBackgrounds(long = false): Promise<SavedBackground[]> {
  const all = await run<SavedBackground[]>(store(long), 'readonly', s => s.getAll());
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

// 同じ画像（名前・サイズ・更新日時が同じ）は重複登録しない
export async function saveBackground(file: File, long = false): Promise<SavedBackground> {
  const id = `${file.name}|${file.size}|${file.lastModified}`;
  const item: SavedBackground = { id, name: file.name, blob: file, createdAt: Date.now() };
  await run(store(long), 'readwrite', s => s.put(item));
  return item;
}

export async function deleteBackground(id: string, long = false): Promise<void> {
  await run(store(long), 'readwrite', s => s.delete(id));
}
