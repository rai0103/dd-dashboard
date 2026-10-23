// 登録した「カスタム音声」（声の種類＋高さ＋話速）をブラウザに保存する。次回以降も選べる。
// investment-shorts（lib/voicePresets.ts）と同じ仕様（型・保存ロジック）をdd-dashboard用に移植したもの
// （investment-shorts自体は無改変）。

export type VoicePreset = {
  id: string;
  name: string;
  voice: string; // サーバー音声名（sapi:… / oc:…）またはAivisSpeechの声（aivis:…）
  pitch: number; // 声の高さ（1.0が標準）
  rate: number;  // 話速
};

const KEY = 'video-voice-presets-v1';

export function loadVoicePresets(): VoicePreset[] {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string') : [];
  } catch {
    return [];
  }
}

export function saveVoicePresets(list: VoicePreset[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* 保存できない環境では無視 */ }
}
