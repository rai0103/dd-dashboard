// 長尺用アバター（人物の動画。1人につきMP4を最大3本）のライブラリ（ブラウザ内に保存）
import { run, STORE_AVATARS } from './videoLocalDB';
import { Gender } from './videoAnalysts';

export const MAX_CLIPS = 3;

export interface AvatarClip { name: string; blob: Blob }

export interface SavedAvatar {
  id: string;
  name: string;
  gender: Gender;
  clips: (AvatarClip | null)[];  // 長さ MAX_CLIPS
  keyOn: boolean;                // 背景を消す
  tol: number;                   // 背景を消す感度（四隅の色との色の差）
  zoom: number;                  // 表示の大きさ（1=枠の高さにちょうど）
  createdAt: number;
}

export async function listAvatars(): Promise<SavedAvatar[]> {
  const all = await run<SavedAvatar[]>(STORE_AVATARS, 'readonly', s => s.getAll());
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export function newAvatar(name: string): SavedAvatar {
  return { id: `av-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, name, gender: 'male', clips: Array(MAX_CLIPS).fill(null), keyOn: true, tol: 22, zoom: 0.85, createdAt: Date.now() };
}

export async function saveAvatar(a: SavedAvatar): Promise<void> {
  await run(STORE_AVATARS, 'readwrite', s => s.put(a));
}

export async function deleteAvatar(id: string): Promise<void> {
  await run(STORE_AVATARS, 'readwrite', s => s.delete(id));
}
