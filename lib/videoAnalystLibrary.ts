// 長尺用アナリスト画像（JPEG/PNG）のライブラリ（ブラウザ内に保存）
import { run, STORE_ANALYSTS } from './videoLocalDB';
import { Gender } from './videoAnalysts';

export interface MouthSetting {
  x: number;     // 口の中心（画像の幅に対する割合 0〜1）
  y: number;     // 口の中心（画像の高さに対する割合 0〜1）
  w: number;     // 口の幅（画像の幅に対する割合）
  open: number;  // 口を最大に開いたときの下あごの移動量（画像の高さに対する割合）
  eye?: number;  // 目の高さ（口の幅に対する、口から目までの距離）
}

export const DEFAULT_MOUTH: MouthSetting = { x: 0.5, y: 0.5, w: 0.2, open: 0.03, eye: 1.0 };

export interface SavedAnalyst {
  id: string;
  name: string;
  gender: Gender;
  mouth: MouthSetting;
  blob: Blob;
  createdAt: number;
}

export async function listAnalysts(): Promise<SavedAnalyst[]> {
  const all = await run<SavedAnalyst[]>(STORE_ANALYSTS, 'readonly', s => s.getAll());
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export async function saveAnalyst(file: File): Promise<SavedAnalyst> {
  const id = `${file.name}|${file.size}|${file.lastModified}`;
  const item: SavedAnalyst = { id, name: file.name.replace(/\.[^.]+$/, ''), gender: 'male', mouth: { ...DEFAULT_MOUTH }, blob: file, createdAt: Date.now() };
  await run(STORE_ANALYSTS, 'readwrite', s => s.put(item));
  return item;
}

export async function updateAnalyst(item: SavedAnalyst): Promise<void> {
  await run(STORE_ANALYSTS, 'readwrite', s => s.put(item));
}

export async function deleteAnalyst(id: string): Promise<void> {
  await run(STORE_ANALYSTS, 'readwrite', s => s.delete(id));
}
