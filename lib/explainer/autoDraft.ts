// 自動ドラフト（毎朝の予約実行）：tts-server（/api/drafts）経由で、予約・ドラフトをPCのフォルダとやり取りする
import { getTtsBaseUrl } from '../videoAudioMixer';
import { listImages, putImage } from './imageStore';

export interface DraftKeyword { theme: string; mode: 'news' | 'keyword'; urgent?: boolean; note?: string }
export interface DraftSchedule { enabled: boolean; count: number; time: string; keywords: DraftKeyword[]; minutes?: number; /** 自動で選ぶテーマのジャンル（autoDraftTheme.ts の THEME_GENRES の key。空＝全ジャンルからシャッフル） */ genres?: string[] }
export interface DraftMeta { id: string; theme: string; mode: string; title: string; scenes: number; createdAt: number; source: 'reserved' | 'auto' | 'sequel' | 'backup' | string; /** 取り込み済み（drafts/imported）のフォルダ名と、取り込んだ時刻 */ dir?: string; importedAt?: number; images?: { id: string; name: string; caption?: string; credit?: unknown; createdAt: number; type: string }[] }
export interface DraftStatus { state: 'idle' | 'running' | 'done' | 'error'; startedAt?: number; finishedAt?: number; message?: string; step?: string; stepAt?: number; run?: string; results?: { theme: string; ok: boolean; error?: string }[] }

const base = () => `${getTtsBaseUrl()}/api/drafts`;
async function post(body: unknown) {
  const r = await fetch(base(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error(d?.error || `HTTP ${r.status}`);
  return d;
}
/** 作ったテーマの記録（drafts/history.json）。theme はシリーズのテーマ（続編も最初のテーマのまま）、part は第何弾か */
export interface DraftHistory { id: string; theme: string; title?: string; createdAt?: number; mode?: 'news' | 'keyword'; part?: number; source?: string; sequelOf?: string; draftId?: string; /** 次の自動生成で続編を作る */ sequel?: boolean }

export async function getDraftState(): Promise<{ schedule: DraftSchedule; history: DraftHistory[]; status: DraftStatus; drafts: DraftMeta[]; importedDrafts?: DraftMeta[] }> {
  const r = await fetch(base(), { cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
export const saveDraftSchedule = (schedule: DraftSchedule, register = true) => post({ action: 'schedule', schedule, register });
export const saveDraftStatus = (status: DraftStatus) => post({ action: 'status', status });
export const addDraftHistory = (entries: Omit<DraftHistory, 'id'>[]) => post({ action: 'history', entries });
export const setHistorySequel = (id: string, sequel: boolean) => post({ action: 'historySequel', id, sequel });
export const deleteHistory = (id: string) => post({ action: 'historyDelete', id });

export { isSimilarTheme } from './autoDraftTheme';
export { THEME_GENRES, pickGenres, genreLabel } from './autoDraftTheme';
/** 話題のニュースからテーマ候補を集める。genres（{label, hint}）を渡すとジャンルごとの候補（items）も返る */
export const trendingThemes = (count: number, exclude: string[], genres?: { label: string; hint: string }[]): Promise<{ themes: string[]; items?: { genre: string; theme: string }[] }> =>
  post({ action: 'trending', count, exclude, ...(genres && genres.length ? { genres } : {}) });

/** 台本で使っている画像のID */
function imageIds(project: any): string[] {
  const ids = new Set<string>();
  for (const s of [...(project?.longScenes || []), ...(project?.shortScenes || [])]) if (s?.imageId) ids.add(s.imageId);
  return [...ids];
}

/** できた台本と画像を、フォルダ（drafts/pending）に保存する */
export async function exportDraft(project: any, info: { theme: string; mode: string; source: 'reserved' | 'auto' }, refs: any[] = []): Promise<string> {
  const id = `dd-${Date.now()}`;
  const want = new Set(imageIds(project));
  const all = await listImages().catch(() => []);
  const images: NonNullable<DraftMeta['images']> = [];
  for (const im of all) {
    if (!want.has(im.id)) continue;
    const r = await fetch(`${base()}/blob?draft=${encodeURIComponent(id)}&key=${encodeURIComponent(im.id)}`, { method: 'POST', headers: { 'Content-Type': im.blob.type || 'application/octet-stream' }, body: im.blob });
    if (r.ok) images.push({ id: im.id, name: im.name, caption: im.caption, credit: im.credit, createdAt: im.createdAt, type: im.blob.type });
  }
  const meta: DraftMeta = { id, theme: info.theme, mode: info.mode, title: project?.videoTitle || info.theme, scenes: (project?.longScenes || []).length, createdAt: Date.now(), source: info.source, images };
  // 参考情報（URL・要約テキスト）も一緒に保存する（概要欄の参考資料URL・丸写しチェックに使うため。PDFの中身は大きいので除く）
  const draftRefs = (refs || []).filter((r) => r && r.kind !== 'pdf').map((r) => { const { pdfBase64, ...rest } = r; return rest; });
  await post({ action: 'saveDraft', id, meta, project: { ...project, __draftRefs: draftRefs } });
  return id;
}

/** ドラフトを普段のブラウザに取り込む（画像はこのブラウザの画像一覧に入る）。台本を返す */
export async function importDraft(meta: DraftMeta): Promise<any> {
  const r = await fetch(`${base()}?draft=${encodeURIComponent(meta.id)}`, { cache: 'no-store' });
  const d = await r.json();
  if (!r.ok || !d.project) throw new Error(d?.error || 'ドラフトを読み込めませんでした');
  for (const im of meta.images || []) {
    const br = await fetch(`${base()}/blob?draft=${encodeURIComponent(meta.id)}&key=${encodeURIComponent(im.id)}`);
    if (!br.ok) continue;
    const blob = await br.blob();
    await putImage({ id: im.id, name: im.name, blob, rightsConfirmed: true, createdAt: im.createdAt || Date.now(), caption: im.caption, ...(im.credit ? { credit: im.credit as any } : {}) });
  }
  await post({ action: 'imported', id: meta.id });
  return d.project;
}

/** 取り込み済みのドラフト（または自動で残した控え）を、もう一度開く。台本を返す（取り込み済みのまま動かさない） */
export async function reopenImported(meta: DraftMeta): Promise<any> {
  if (!meta.dir) throw new Error('フォルダが分かりません');
  const q = `imported=${encodeURIComponent(meta.dir)}`;
  const r = await fetch(`${base()}?${q}`, { cache: 'no-store' });
  const d = await r.json();
  if (!r.ok || !d.project) throw new Error(d?.error || 'ドラフトを読み込めませんでした');
  const have = new Set((await listImages().catch(() => [])).map((im) => im.id));
  for (const im of meta.images || []) {
    if (have.has(im.id)) continue; // すでにこのブラウザにある画像は取り込み直さない
    const br = await fetch(`${base()}/blob?${q}&key=${encodeURIComponent(im.id)}`);
    if (!br.ok) continue;
    const blob = await br.blob();
    await putImage({ id: im.id, name: im.name, blob, rightsConfirmed: true, createdAt: im.createdAt || Date.now(), caption: im.caption, ...(im.credit ? { credit: im.credit as any } : {}) });
  }
  return d.project;
}

/** 別の台本を開く前に、今の台本の控えを PC のフォルダ（drafts/imported/backup-…）に残す。画像はこのブラウザに残っているので台本だけ */
export async function backupProject(project: any, info: { theme: string; mode: string }): Promise<void> {
  if (!project) return;
  await post({ action: 'backup', project, meta: { theme: info.theme || project.videoTitle || '', mode: project.mode || info.mode, title: project.videoTitle || info.theme || '（無題）', scenes: (project.longScenes || []).length, createdAt: Date.now() } });
}
