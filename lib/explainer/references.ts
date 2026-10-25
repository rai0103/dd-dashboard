// 参考情報（テキスト・URL・PDF）の取り込みと、AIに渡す形（Anthropic Messages APIのdocumentブロック）への変換。
import { getTtsBaseUrl } from '../videoAudioMixer';
import type { ReferenceItem } from './types';

export const MAX_PDF_BYTES = 30 * 1024 * 1024;

export const newRefId = () => `ref-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => { const s = String(r.result || ''); resolve(s.slice(s.indexOf(',') + 1)); };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/** URLの本文をローカルサーバー（tts-server の /api/fetch-url）経由で取得する */
export async function fetchUrlReference(url: string): Promise<{ title: string; text: string; pdfBase64?: string; note?: string }> {
  let res: Response;
  try {
    res = await fetch(`${getTtsBaseUrl()}/api/fetch-url?url=${encodeURIComponent(url)}`, { cache: 'no-store' });
  } catch {
    throw new Error(`ローカルサーバー（${getTtsBaseUrl()}）に接続できません。「npm run dev:video」または「npm run tts-server」で起動してください。`);
  }
  let j: any = null;
  try { j = await res.json(); } catch { /* 下で扱う */ }
  if (!res.ok || !j) {
    if (res.status === 404) throw new Error('ローカルサーバーが古い版です。サーバーを再起動してください（URL取得機能が追加されています）。');
    throw new Error(j?.message || `取得に失敗しました（HTTP ${res.status}）`);
  }
  if (j.kind === 'pdf') return { title: j.title || url, text: '', pdfBase64: j.base64 };
  return { title: j.title || url, text: String(j.text || ''), note: typeof j.note === 'string' ? j.note : undefined };
}

/** 参考情報の文字（URL・テキスト）だけを集める（丸写しチェック用。PDFは中身を持たないため対象外） */
export function referenceTexts(refs: ReferenceItem[]): string[] {
  const out: string[] = [];
  for (const r of refs) {
    if (r.kind === 'text' && r.text.trim()) out.push(r.text);
    if (r.kind === 'url' && r.status === 'ok' && r.text) out.push(r.text);
  }
  return out;
}

export function refLabel(r: ReferenceItem): string {
  if (r.kind === 'url') return r.title && r.title !== r.url ? `${r.title}（${hostOf(r.url)}）` : r.url;
  return r.title;
}

export function hostOf(url: string): string { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } }

/**
 * AIへ渡すdocumentブロックの配列。最後のブロックにcache_controlを付け、目次・章ごとの複数回の呼び出しで
 * 参考資料の読み込みを使い回す（プロンプトキャッシュ）。
 */
export function referenceBlocks(refs: ReferenceItem[]): any[] {
  const blocks: any[] = [];
  refs.forEach((r, i) => {
    const n = i + 1;
    if (r.kind === 'text' && r.text.trim()) {
      blocks.push({ type: 'document', title: `参考${n}：${r.title || 'テキスト'}`, source: { type: 'text', media_type: 'text/plain', data: r.text.slice(0, 80000) } });
    } else if (r.kind === 'url' && r.status === 'ok') {
      if (r.pdfBase64) blocks.push({ type: 'document', title: `参考${n}：${r.title}（${r.url}）`, source: { type: 'base64', media_type: 'application/pdf', data: r.pdfBase64 } });
      else if (r.text) blocks.push({ type: 'document', title: `参考${n}：${r.title}（${r.url}）`, source: { type: 'text', media_type: 'text/plain', data: r.text.slice(0, 80000) } });
    } else if (r.kind === 'pdf') {
      blocks.push({ type: 'document', title: `参考${n}：${r.title}`, source: { type: 'base64', media_type: 'application/pdf', data: r.base64 } });
    }
  });
  if (blocks.length) blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], cache_control: { type: 'ephemeral' } };
  return blocks;
}
