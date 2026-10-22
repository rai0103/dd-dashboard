// 長尺動画作成：カスタム場面の指示文（プロンプト）をブラウザに保存するライブラリ（Stage D-4「記憶する」機能）。
// lib/videoAvatarLibrary.ts と同じ、薄いCRUDラッパーのパターン。サーバー送信なし（IndexedDBのみ）。
import { run, STORE_CUSTOM_PROMPTS } from './videoLocalDB';

export interface SavedCustomPrompt {
  id: string;
  name: string;
  prompt: string;
  createdAt: number;
}

export async function listCustomPrompts(): Promise<SavedCustomPrompt[]> {
  const all = await run<SavedCustomPrompt[]>(STORE_CUSTOM_PROMPTS, 'readonly', (s) => s.getAll());
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export async function saveCustomPrompt(p: { id?: string; name: string; prompt: string }): Promise<SavedCustomPrompt> {
  const saved: SavedCustomPrompt = {
    id: p.id ?? `csp-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    name: p.name,
    prompt: p.prompt,
    createdAt: Date.now(),
  };
  await run(STORE_CUSTOM_PROMPTS, 'readwrite', (s) => s.put(saved));
  return saved;
}

export async function deleteCustomPrompt(id: string): Promise<void> {
  await run(STORE_CUSTOM_PROMPTS, 'readwrite', (s) => s.delete(id));
}
