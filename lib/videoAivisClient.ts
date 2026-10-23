// AivisSpeech（無料のローカル音声合成エンジン。VOICEVOX互換API）を、ブラウザから直接呼び出すためのクライアント。
// dd-dashboardは静的エクスポート（Cloudflare Pages）でサーバー側コードを持てないため、既存のローカルTTSサーバー
// （tts-server/、Windowsの音声合成をPowerShell経由で呼ぶ）とは別経路で、ブラウザのfetchからAivisSpeechエンジン
// （既定 http://127.0.0.1:10101）へ直接つなぐ。investment-shorts側（app/api/tts/route.ts の aivisVoices/aivisSpeak、
// サーバー側のNode fetch）と同じAPI呼び出し順序を、ブラウザのfetchに移植したもの（investment-shorts自体は無改変）。
//
// 本番ページ（https://...）からローカル（http://127.0.0.1:...）への直接アクセスは、ブラウザのCORS・
// プライベート/ローカルネットワークアクセス制限により失敗することがある。失敗は呼び出し側（videoAudioMixer.ts・
// DDDashboard.jsx）で捕捉し、既存の声（ローカルTTSサーバー）へ自動的に切り替える。

let AIVIS_URL = 'http://127.0.0.1:10101';
/** AivisSpeechエンジンのベースURLを変更する（既定: http://127.0.0.1:10101） */
export function setAivisUrl(url: string): void { AIVIS_URL = url.replace(/\/$/, ''); }
export function getAivisUrl(): string { return AIVIS_URL; }

/** 声の識別子（"aivis:{styleId}:{話者名}（{スタイル名}）"）の接頭辞 */
export const AIVIS_PREFIX = 'aivis:';
export function isAivisVoice(voice: string): boolean { return typeof voice === 'string' && voice.startsWith(AIVIS_PREFIX); }

/** "aivis:3:花音（ノーマル）" → 3（styleId）。形式が違えばnull */
export function parseAivisSpeakerId(voice: string): number | null {
  const m = /^aivis:(\d+):/.exec(voice);
  return m ? parseInt(m[1], 10) : null;
}

async function aFetch(url: string, init: RequestInit | undefined, ms: number): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...init, signal: ctl.signal, cache: 'no-store' }); }
  finally { clearTimeout(timer); }
}

/**
 * AivisSpeechが起動していて、ブラウザから到達できる場合だけ、声の一覧を返す。
 * 起動していない・CORSやプライベートネットワークアクセス制限で失敗する場合は、短いタイムアウト（既定1.5秒）で
 * 諦めて空配列を返す（呼び出し側でエラー表示はしない＝今の声の一覧のまま）。
 */
export async function listAivisVoices(timeoutMs = 1500): Promise<string[]> {
  try {
    const res = await aFetch(`${AIVIS_URL}/speakers`, undefined, timeoutMs);
    if (!res.ok) return [];
    const list = await res.json();
    if (!Array.isArray(list)) return [];
    const out: string[] = [];
    for (const sp of list) {
      if (!sp || !Array.isArray(sp.styles)) continue;
      for (const st of sp.styles) {
        if (st && typeof st.id !== 'undefined' && typeof sp.name === 'string' && typeof st.name === 'string') {
          out.push(`${AIVIS_PREFIX}${st.id}:${sp.name}（${st.name}）`);
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * AivisSpeechで音声合成する（audio_query → speedScaleを設定 → synthesis の2段階。VOICEVOX互換API）。
 * speedScale は1.0が通常の速さ（呼び出し側の「速さ」「高さ」の補正をそのまま渡す）。失敗時は例外を投げる
 * （呼び出し側で既存の声へのフォールバックに使う）。
 */
export async function synthesizeAivis(text: string, speakerId: number, speedScale: number, timeoutMs = 20000): Promise<ArrayBuffer> {
  const q = await aFetch(`${AIVIS_URL}/audio_query?speaker=${speakerId}&text=${encodeURIComponent(text)}`, { method: 'POST' }, timeoutMs);
  if (!q.ok) throw new Error(`AivisSpeechの音声クエリに失敗しました（${q.status}）`);
  const query = await q.json();
  query.speedScale = speedScale;
  const w = await aFetch(`${AIVIS_URL}/synthesis?speaker=${speakerId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(query),
  }, timeoutMs);
  if (!w.ok) throw new Error(`AivisSpeechの音声合成に失敗しました（${w.status}）`);
  return await w.arrayBuffer();
}
