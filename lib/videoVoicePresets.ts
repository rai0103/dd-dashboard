// 登録した「カスタム音声」（声の種類＋高さ＋話速）をブラウザに保存する。次回以降も選べる。

export type VoicePreset = {
  id: string;
  name: string;
  voice: string; // サーバー音声名（sapi:… / oc:…）またはブラウザ音声の番号
  pitch: number; // 声の高さ（1.0 が標準）
  rate: number;  // 話速
};

const KEY = 'shorts-voice-presets';

export function loadVoicePresets(): VoicePreset[] {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter(p => p && typeof p.id === 'string' && typeof p.name === 'string') : [];
  } catch { return []; }
}

export function saveVoicePresets(list: VoicePreset[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* 保存できない環境では無視 */ }
}
