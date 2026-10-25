// 台本データの検証・補正・組み立て（AIやブラウザに依存しない純粋な関数。lib/explainer/scriptModel.test.ts でテスト）。
import { ICON_NAMES, VISUAL_KINDS, emptyVisual } from './types.ts';
import type { ChapterPlan, ExplainerProject, ExplainerScene, IconName, SourceNote, VisualItem, VisualKind, VisualSpec } from './types.ts';

const ICON_SET = new Set<string>(ICON_NAMES);
const KIND_SET = new Set<string>([...VISUAL_KINDS, 'chapter', 'sources']);
export const DATA_KINDS = new Set<VisualKind>(['number', 'bar', 'line', 'donut']);

export const newSceneId = () => `sc-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e8).toString(36)}`;

/** "1,234.5兆円" "約12%" "−3.2" などから数値を取り出す。取り出せなければnull */
export function parseValue(v: string | number | null | undefined): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (!v) return null;
  const s = String(v).normalize('NFKC').replace(/[,，\s]/g, '').replace(/[−–—]/g, '-');
  // バージョン番号（8.4.27）・日付（2026-10-25、2026/10）・時刻は「量」ではないので数値として扱わない
  if (/\d+\.\d+\.\d+/.test(s) || /\d{4}[-/年]\d{1,2}/.test(s) || /\d{1,2}:\d{2}/.test(s)) return null;
  const m = /-?\d+(?:\.\d+)?/.exec(s);
  if (!m) return null;
  const n = parseFloat(m[0]);
  return Number.isFinite(n) ? n : null;
}

const str = (x: unknown, max = 400) => (typeof x === 'string' ? x : x == null ? '' : String(x)).trim().slice(0, max);

export function normalizeItem(raw: any): VisualItem {
  const icon = ICON_SET.has(raw?.icon) ? (raw.icon as IconName) : 'bulb';
  return { label: str(raw?.label, 60), value: str(raw?.value, 30), text: str(raw?.text, 200), icon };
}

const ITEM_LIMIT: Partial<Record<VisualKind, [number, number]>> = {
  points: [1, 4], number: [1, 1], bar: [1, 8], line: [2, 16], donut: [2, 6], timeline: [2, 7], flow: [2, 5],
  compare: [2, 2], cycle: [3, 6], illustration: [1, 5], image: [0, 5], summary: [1, 5], title: [0, 3], keyword: [0, 3], cta: [0, 3], point: [0, 1], qa: [0, 1],
};

export function normalizeVisual(raw: any): VisualSpec {
  const kind: VisualKind = KIND_SET.has(raw?.kind) ? raw.kind : 'point';
  const v: VisualSpec = {
    ...emptyVisual(kind),
    heading: str(raw?.heading, 80), subheading: str(raw?.subheading, 120), unit: str(raw?.unit, 20),
    source: str(raw?.source, 120), emphasis: str(raw?.emphasis, 80), imagePrompt: str(raw?.imagePrompt, 600),
    items: Array.isArray(raw?.items) ? raw.items.filter((r: any) => r && (r.label || r.text || r.value || ICON_SET.has(r.icon))).map(normalizeItem) : [],
  };
  const lim = ITEM_LIMIT[kind];
  if (lim) v.items = v.items.slice(0, lim[1]);
  // 数値のグラフなのに数値が足りない場合は、文字の図解（要点）に切り替える（数値をでっち上げない）
  if (kind === 'bar' || kind === 'line' || kind === 'donut' || kind === 'number') {
    const numeric = v.items.filter((it) => parseValue(it.value) !== null);
    const need = kind === 'number' ? 1 : 2;
    if (numeric.length < need) {
      v.kind = 'points';
      v.items = v.items.slice(0, 4).map((it) => ({ ...it, text: it.text || it.value }));
    } else {
      v.items = numeric;
    }
  }
  if (kind === 'compare' && v.items.length < 2) v.kind = v.items.length ? 'points' : 'point';
  if (kind === 'cycle' && v.items.length < 3) v.kind = v.items.length >= 2 ? 'flow' : 'point';
  if ((v.kind === 'point' || v.kind === 'qa') && !v.emphasis) v.emphasis = v.heading || v.subheading;
  return v;
}

/** カタカナをひらがなにする（ヴ等も含め、コード位置を0x60ずらす） */
export function katakanaToHiragana(s: string): string {
  return s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/** 読み上げ文として使えるか（ひらがな・長音・句読点・空白のみ） */
export function isKanaReading(s: string): boolean {
  return /^[ぁ-ゟー、。，．・！？!?\s]*$/.test(s);
}

/**
 * 読み上げ文の補正：カタカナはひらがなに直し、使えない記号は読点に寄せる。
 * 漢字・英数字が残る場合は、読み上げを通常の文（narration）にする（音声合成側で読ませる。読み違いの可能性がある）。
 */
export function sanitizeReading(reading: string, narration: string): { reading: string; ok: boolean } {
  let r = katakanaToHiragana(str(reading, 2000)).replace(/[「」『』（）()【】［］\[\]"“”'’]/g, '').replace(/[！!？?]/g, '。').replace(/[，,]/g, '、').replace(/[．.]/g, '。').replace(/[・]/g, '、');
  r = r.replace(/\s+/g, '').replace(/、{2,}/g, '、').replace(/。{2,}/g, '。');
  if (r && isKanaReading(r)) return { reading: r, ok: true };
  return { reading: narration, ok: false };
}

/** 場面の種類ごとの、映像として必要な最短秒数 */
export function minSecFor(kind: VisualKind): number {
  switch (kind) {
    case 'chapter': return 3.2;
    case 'title': return 6;
    case 'sources': return 7;
    case 'line': case 'bar': case 'timeline': case 'flow': case 'compare': case 'cycle': return 9;
    default: return 6;
  }
}

export function normalizeScene(raw: any, chapter: number): ExplainerScene {
  const visual = normalizeVisual(raw?.visual);
  const narration = str(raw?.narration, 600).replace(/\s*\n\s*/g, '');
  const rd = sanitizeReading(str(raw?.reading, 1200), narration);
  return {
    id: newSceneId(),
    title: str(raw?.title, 40) || visual.heading || narration.slice(0, 16),
    caption: str(raw?.caption, 60),
    narration,
    reading: rd.reading,
    visual,
    chapter,
    minSec: minSecFor(visual.kind),
    imageId: null,
  };
}

/** 章の扉（章番号＋章タイトル）。短いナレーションで区切りを示す */
export function chapterCardScene(ch: ChapterPlan, chapterNo: number, bodyIndex: number): ExplainerScene {
  const reading = sanitizeReading(ch.reading || '', ch.title);
  return {
    id: newSceneId(), title: `第${bodyIndex}章 ${ch.title}`, caption: ch.title,
    narration: ch.title, reading: reading.reading,
    visual: { ...emptyVisual('chapter'), heading: ch.title, subheading: ch.goal, emphasis: String(bodyIndex) },
    chapter: chapterNo, minSec: minSecFor('chapter'), imageId: null,
  };
}

/** 末尾の「参考資料」場面（出典の明示） */
export function sourcesScene(sources: SourceNote[], chapterNo: number): ExplainerScene {
  return {
    id: newSceneId(), title: '参考資料', caption: '参考資料',
    narration: 'この動画は、以下の資料を参考に作成しました。',
    reading: 'このどうがは、いかのしりょうを、さんこうに、さくせいしました。',
    visual: { ...emptyVisual('sources'), heading: '参考資料', subheading: '内容は制作時点の情報にもとづきます', items: sources.slice(0, 8).map((s) => ({ label: s.title, value: '', text: s.detail, icon: 'document' as IconName })) },
    chapter: chapterNo, minSec: minSecFor('sources'), imageId: null,
  };
}

/** 章ごとに生成した場面を並べ、本編の章の前に章の扉を入れて長尺の場面一覧にする（参考資料の場面は既定では入れず、概要欄に記載する） */
export function assembleLong(chapters: ChapterPlan[], perChapter: ExplainerScene[][], sources: SourceNote[], withChapterCards = true, withSourcesScene = false): ExplainerScene[] {
  const out: ExplainerScene[] = [];
  let bodyNo = 0;
  chapters.forEach((ch, i) => {
    const scenes = perChapter[i] || [];
    if (ch.role === 'body') {
      bodyNo += 1;
      if (withChapterCards && scenes.length) out.push(chapterCardScene(ch, i, bodyNo));
    }
    scenes.forEach((s) => out.push({ ...s, chapter: i }));
  });
  if (withSourcesScene && sources.length) out.push(sourcesScene(sources, Math.max(0, chapters.length - 1)));
  return out;
}

/**
 * ナレーションが参考資料の文章をそのまま写していないかの確認（著作権への配慮）。
 * 句読点・空白を除いて比べ、minLen文字以上続けて一致する箇所を返す。
 */
export function findVerbatimOverlaps(narration: string, refTexts: string[], minLen = 22): string[] {
  const norm = (s: string) => s.normalize('NFKC').replace(/[\s、。，．,.・「」『』（）()“”"'!?！？:：;；]/g, '');
  const a = norm(narration);
  if (a.length < minLen) return [];
  const found: string[] = [];
  for (const t of refTexts) {
    const b = norm(t);
    if (b.length < minLen) continue;
    // aの各位置からminLen文字の断片がbに含まれるかを見て、含まれる区間を伸ばす
    let i = 0;
    while (i + minLen <= a.length) {
      const seed = a.slice(i, i + minLen);
      if (b.includes(seed)) {
        let j = i + minLen;
        while (j < a.length && b.includes(a.slice(i, j + 1))) j++;
        found.push(a.slice(i, j));
        i = j;
      } else i++;
    }
  }
  return Array.from(new Set(found));
}

export interface LintIssue { sceneIndex: number; level: 'warn' | 'info'; message: string }

/** 公開前チェック（出典の有無・丸写し・同じ図解の連続・長すぎる場面・画像未追加など） */
export function lintScenes(scenes: ExplainerScene[], refTexts: string[], sceneSecs: number[] = []): LintIssue[] {
  const out: LintIssue[] = [];
  scenes.forEach((sc, i) => {
    const k = sc.visual.kind;
    if (DATA_KINDS.has(k) && !sc.visual.source.trim()) out.push({ sceneIndex: i, level: 'warn', message: '数値を使う図解に出典がありません' });
    const ov = findVerbatimOverlaps(sc.narration, refTexts);
    if (ov.length) out.push({ sceneIndex: i, level: 'warn', message: `参考資料の文章とほぼ同じ箇所があります（言い換えを推奨）：「${ov[0].slice(0, 24)}…」` });
    if (i > 0 && scenes[i - 1].visual.kind === k && k !== 'chapter') out.push({ sceneIndex: i, level: 'info', message: '前の場面と同じ種類の図解が続いています' });
    const sec = sceneSecs[i];
    if (sec && sec >= 24 && k !== 'sources') out.push({ sceneIndex: i, level: 'info', message: `場面が長め（${Math.round(sec)}秒）です。分けると飽きにくくなります` });
    if (k === 'image' && !sc.imageId) out.push({ sceneIndex: i, level: 'info', message: '画像が未追加のため、イメージ図で代用しています' });
    if (!isKanaReading(sc.reading)) out.push({ sceneIndex: i, level: 'info', message: '読み上げ文に漢字・英数字が含まれます（読み違いがないか試聴で確認）' });
  });
  return out;
}

export function sceneTextForSearch(s: ExplainerScene): string {
  return [s.title, s.caption, s.narration, s.visual.heading, s.visual.emphasis].join(' ');
}

/** YouTube概要欄：AIの文案＋参考URL一覧＋AI利用の注記 */
export function buildDescription(p: Pick<ExplainerProject, 'youtube' | 'sources'>, urls: string[], short = false): string {
  const lines: string[] = [];
  lines.push(short ? p.youtube.shortDescription : p.youtube.description);
  if (!short) {
    if (p.sources.length || urls.length) {
      lines.push('', '■ 参考資料');
      p.sources.forEach((s) => lines.push(`・${s.title}${s.detail ? `（${s.detail}）` : ''}`));
      urls.forEach((u) => lines.push(u));
    }
    lines.push('', '※本動画は、参考資料をもとにAIで構成・原稿を作成し、内容を確認して制作しています。図解・イラストはオリジナルです。', '※内容は制作時点の情報にもとづきます。');
  }
  if (p.youtube.tags.length) lines.push('', p.youtube.tags.slice(0, 8).map((t) => `#${t.replace(/^#/, '').replace(/\s+/g, '')}`).join(' ') + (short ? ' #shorts' : ''));
  return lines.join('\n').trim();
}

// ---- 長さと声の速さ ----
/** 話速1.0での1秒あたりの文字数（aiScript の CHARS_PER_MIN=300 と同じ） */
const CPS_AT_1 = 5;
export interface NarrMeasure { rate: number; secs: number[] }

/** 指定の速さで読んだときの動画全体の秒数。実測（measure）があれば、その秒数を速さの比で伸び縮みさせて使う */
export function predictTotalSec(scenes: Pick<ExplainerScene, 'narration' | 'minSec'>[], rate: number, measure?: NarrMeasure | null): number {
  return scenes.reduce((sum, s, i) => {
    const base = measure && measure.secs.length === scenes.length ? measure.secs[i] * (measure.rate / rate) : s.narration.length / (CPS_AT_1 * rate);
    return sum + Math.max(s.minSec || 3, base > 0 ? base + 1.1 : 0);
  }, 0);
}

/**
 * 目標の秒数に収まる、いちばんゆっくりの速さ（0.6〜2.0）を探す。2.0でも収まらなければ null。
 * 聞き取りやすさの目安として 0.9〜1.5 を推奨範囲にする。
 */
export function suggestRate(scenes: Pick<ExplainerScene, 'narration' | 'minSec'>[], targetSec: number, measure?: NarrMeasure | null): number | null {
  if (predictTotalSec(scenes, 2.0, measure) > targetSec) return null;
  let lo = 0.6, hi = 2.0;
  if (predictTotalSec(scenes, lo, measure) <= targetSec) return lo;
  for (let k = 0; k < 30; k++) { const mid = (lo + hi) / 2; if (predictTotalSec(scenes, mid, measure) <= targetSec) hi = mid; else lo = mid; }
  return Math.ceil(hi * 20) / 20; // 0.05刻み（スライダーと同じ）で切り上げ
}
export const COMFORT_RATE = { min: 0.9, max: 1.5 };
