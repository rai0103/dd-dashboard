// 台本データの検証・補正・組み立て（AIやブラウザに依存しない純粋な関数。lib/explainer/scriptModel.test.ts でテスト）。
import { ICON_NAMES, VISUAL_KINDS, emptyVisual } from './types.ts';
import type { ChapterPlan, ExplainerProject, ExplainerScene, GlossTerm, IconName, ImageCredit, SourceNote, VisualItem, VisualKind, VisualSpec } from './types.ts';
export type { GlossTerm };

const ICON_SET = new Set<string>(ICON_NAMES);
const KIND_SET = new Set<string>([...VISUAL_KINDS, 'chapter', 'sources']);
export const DATA_KINDS = new Set<VisualKind>(['number', 'bar', 'line', 'donut', 'yearCompare']);

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

// [Stage G-1] システムプロンプトで「使わない」よう指示している語でも、AIがまれに使ってしまうことがある
// ため、生成後のテキストにも安全網として置換をかける（sanitizeReading()のさいこうね→さいたかね等と同じ考え方）。
// str()を通るAI生成テキスト（タイトル・ナレーション・図解の見出し／項目など）全てに自動的に効く。
const BANNED_WORDING: [RegExp, string][] = [[/ダッシュボード/g, '過去の実績']];
export function fixBannedWording(s: string): string {
  let r = s;
  for (const [re, rep] of BANNED_WORDING) r = r.replace(re, rep);
  return r;
}
const str = (x: unknown, max = 400) => fixBannedWording((typeof x === 'string' ? x : x == null ? '' : String(x)).trim()).slice(0, max);

export function normalizeItem(raw: any): VisualItem {
  const icon = ICON_SET.has(raw?.icon) ? (raw.icon as IconName) : 'bulb';
  const item: VisualItem = { label: str(raw?.label, 60), value: str(raw?.value, 30), text: str(raw?.text, 200), icon };
  // [Stage E-9] yearCompare専用の追加フィールド。他の図解では未指定（undefinedのまま）。
  if (Number.isFinite(raw?.x)) item.x = Number(raw.x);
  if (typeof raw?.seriesKey === 'string' && raw.seriesKey) item.seriesKey = str(raw.seriesKey, 80);
  if (typeof raw?.seriesLabel === 'string' && raw.seriesLabel) item.seriesLabel = str(raw.seriesLabel, 60);
  if (typeof raw?.seriesEmphasis === 'boolean') item.seriesEmphasis = raw.seriesEmphasis;
  return item;
}

const ITEM_LIMIT: Partial<Record<VisualKind, [number, number]>> = {
  points: [1, 4], number: [1, 1], bar: [1, 8], line: [2, 16], donut: [2, 6], timeline: [2, 7], flow: [2, 5],
  compare: [2, 2], cycle: [3, 6], illustration: [1, 5], image: [0, 5], summary: [1, 5], title: [0, 3], keyword: [0, 3], cta: [0, 3], point: [0, 1], qa: [0, 1],
  // [Stage E-10] yearCompareはITEM_LIMITに含めない：下のitems全体を均一に切り詰める処理（v.items.slice(0,lim[1])）を
  // yearCompareに適用すると、先頭の1系列だけで上限に達し、後続の系列が丸ごと消える不具合が実際に発生した
  // （lib/explainer/stockCatalog.tsのresolveYearCompareItems参照）。系列ごとの点数上限は解決側（resolveYearCompareItemsの
  // MAX_POINTS_PER_SERIES）と系列数上限（最大8系列）ですでに抑えているため、ここでの一律な切り詰めは不要かつ有害。
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
  // [Stage E-9] yearCompare：系列（seriesKey）ごとに3点以上そろった系列が2つ以上無ければ、数値をでっち上げず要点カードに落とす
  if (kind === 'yearCompare') {
    const bySeries = new Map<string, VisualItem[]>();
    for (const it of v.items) {
      if (parseValue(it.value) === null || !it.seriesKey) continue;
      const arr = bySeries.get(it.seriesKey) ?? [];
      arr.push(it);
      bySeries.set(it.seriesKey, arr);
    }
    const validGroups = [...bySeries.values()].filter((arr) => arr.length >= 3);
    if (validGroups.length < 2) {
      const labels = [...new Set(v.items.map((it) => it.seriesLabel).filter((s): s is string => !!s))];
      v.kind = 'points';
      v.items = labels.slice(0, 4).map((label) => ({ label, value: '', text: '', icon: 'chartUp' as IconName }));
    } else {
      v.items = validGroups.flat();
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
/**
 * [Stage E-18] 用語の読み方の統一：MDD→まっくすどろーだうん、DD→どろーだうん、ATH→かこさいたかね（過去最高値）、
 * 最高値→さいたかね。英字・漢字のままの表記（読み上げ文が古く、ナレーションをそのまま読む場合）と、AIが英字読み・音読みにした
 * ひらがな（でぃーでぃー・さいこうち等）の両方を置き換える。MDDはDDより、過去最高値は最高値より先に置き換える。
 * 「ドローダウン、DD」のように言い換えが続く場合は、同じ読みが2回続かないよう1つにまとめる。
 */
export function applyTermReadings(s: string): string {
  return String(s || '')
    .replace(/ＭＤＤ|MDD/g, 'まっくすどろーだうん').replace(/えむ、?でぃー、?でぃー/g, 'まっくすどろーだうん')
    .replace(/ＡＴＨ|ATH/g, 'かこさいたかね').replace(/(?:えー|えい)、?てぃー、?えいち/g, 'かこさいたかね')
    .replace(/ＤＤ|DD/g, 'どろーだうん').replace(/でぃー、?でぃー/g, 'どろーだうん')
    .replace(/過去最高値/g, 'かこさいたかね').replace(/最高値/g, 'さいたかね').replace(/さいこう(?:ち|ね)/g, 'さいたかね')
    .replace(/(ドローダウン|どろーだうん)[、,（(\s]*(?:ドローダウン|どろーだうん)[）)]?/g, '$1');
}

export function sanitizeReading(reading: string, narration: string): { reading: string; ok: boolean } {
  let r = katakanaToHiragana(str(reading, 2000)).replace(/[「」『』（）()【】［］\[\]"“”'’]/g, '').replace(/[！!？?]/g, '。').replace(/[，,]/g, '、').replace(/[．.]/g, '。').replace(/[・]/g, '、');
  r = r.replace(/\s+/g, '').replace(/、{2,}/g, '、').replace(/。{2,}/g, '。');
  // [Stage G-1] AIが時々間違える読み方の安全網（システムプロンプトでも指示しているが、生成後にも補正する）。
  // 「からく」→「げらく」は「からくり」との混同を避けるため、直後が「り」でないときだけ置き換える。
  // 「だっしゅぼーど」は「ダッシュボード」の読みそのものなので、同じく「過去の実績」の読みに置き換える。
  r = r.replace(/さいこうね/g, 'さいたかね').replace(/からく(?!り)/g, 'げらく').replace(/だっしゅぼーど/g, 'かこのじっせき');
  r = applyTermReadings(r);
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
  // 「参考1によると」などの参考資料の番号は、視聴者には意味がないので取り除く
  return stripRefMarksScene({
    id: newSceneId(),
    title: str(raw?.title, 40) || visual.heading || narration.slice(0, 16),
    caption: str(raw?.caption, 60),
    narration,
    reading: rd.reading,
    visual,
    chapter,
    minSec: minSecFor(visual.kind),
    imageId: null,
  });
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
/**
 * フリー素材のクレジット行（日本文化動画アプリと同じ書き方）：CC BY・CC BY-SA の画像は作者・ライセンス・元ページを
 * 1枚ずつ明記し（ライセンスの表示義務）、パブリックドメイン・CC0・Pixabay等は提供元の名前をまとめて書く。
 */
const NEEDS_ATTRIBUTION = /CC BY/i;
export function imageCreditLines(credits: ImageCredit[]): string[] {
  const seen = new Set<string>();
  const uniq = credits.filter((c) => { const k = `${c.source}|${c.pageUrl || c.caption || ''}`; if (seen.has(k)) return false; seen.add(k); return true; });
  if (!uniq.length) return [];
  const lines: string[] = ['', '■ 画像クレジット'];
  for (const c of uniq.filter((x) => NEEDS_ATTRIBUTION.test(`${x.source} ${x.credit || ''}`))) {
    lines.push(`・${c.caption ? `${c.caption.slice(0, 60)} — ` : ''}${c.credit || c.source}${c.modified ? `（${c.modified}）` : ''}${c.pageUrl ? ` ${c.pageUrl}` : ''}`);
  }
  const free = Array.from(new Set(uniq.filter((x) => !NEEDS_ATTRIBUTION.test(`${x.source} ${x.credit || ''}`)).map((x) => x.source.replace(/\s*\((?:CC0|Free|Public domain|PD[^)]*)\)\s*$/i, '').replace(/^Openverse \/ /, ''))));
  if (free.length) lines.push(`・パブリックドメイン／CC0・フリー素材：${free.join('、')}`);
  const mods = Array.from(new Set(uniq.filter((x) => x.modified && !NEEDS_ATTRIBUTION.test(`${x.source} ${x.credit || ''}`)).map((x) => x.modified)));
  if (mods.length) lines.push(`※一部の画像は${mods.join('・')}しています。`);
  return lines;
}

export function buildDescription(p: Pick<ExplainerProject, 'youtube' | 'sources'>, urls: string[], short = false, credits: ImageCredit[] = []): string {
  const lines: string[] = [];
  lines.push(short ? p.youtube.shortDescription : p.youtube.description);
  if (!short) {
    if (p.sources.length || urls.length) {
      lines.push('', '■ 参考資料');
      p.sources.forEach((s) => lines.push(`・${s.title}${s.detail ? `（${s.detail}）` : ''}`));
      urls.forEach((u) => lines.push(u));
    }
    lines.push(...imageCreditLines(credits));
    lines.push('', `※本動画は、参考資料をもとにAIで構成・原稿を作成し、内容を確認して制作しています。${credits.length ? '図解はオリジナル、写真・画像は上記のフリー素材（各ライセンスに従って使用）です。' : '図解・イラストはオリジナルです。'}`, '※内容は制作時点の情報にもとづきます。');
  } else if (credits.length) {
    // ショートは概要欄が短いので、画像クレジットだけを付ける（CC BY の表示義務があるため省略しない）
    lines.push(...imageCreditLines(credits));
  }
  // 概要欄の末尾に関連ハッシュタグを10個まで並べる（#shortsはショート用に別途追加する、10個のカウントには含めない）
  if (p.youtube.tags.length) lines.push('', p.youtube.tags.slice(0, 10).map((t) => `#${t.replace(/^#/, '').replace(/\s+/g, '')}`).join(' ') + (short ? ' #shorts' : ''));
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

// ---- 参考資料の番号（「参考1」「添付2」等）を動画から取り除く ----
// AIには参考資料が「参考1：○○」の名前で渡るため、ナレーション・字幕・図解の出典に「参考1によると」「（添付2）」の
// ような番号がそのまま出てしまうことがある。視聴者には意味がないため、生成した台本から機械的に取り除く（AIへの指示でも禁止している）。
const REF_NUM = '[0-9０-９]+';
const REF_LIST = `${REF_NUM}(?:\\s*(?:[・、,，と〜~\\-－]|および|及び)\\s*${REF_NUM})*`;
const REF_LABEL = `(?:参考資料|参考情報|参考文献|参考|添付資料|添付ファイル|添付|資料|文献)\\s*(?:No\\.?|＃|#)?\\s*${REF_LIST}`;
const REF_BRACKETED = new RegExp(`[（(［\\[【〔＜<]\\s*(?:出典\\s*[:：]?\\s*)?${REF_LABEL}[^）)］\\]】〕＞>]{0,40}[）)］\\]】〕＞>]`, 'g');
const REF_INLINE = new RegExp(`${REF_LABEL}\\s*(?:[:：]\\s*)?(?:の(?:資料|記事|データ|報告|文書|ファイル|内容)?)?(?:によると|によれば|では|でも|より|から|にある(?:ように|とおり|通り)|に(?:は|も)?|で|が|は|も|を|と)?\\s*[、,]?`, 'g');
const KANA_NUM = '(?:[0-9０-９]+|(?:いち|に|さん|よん|ご|ろく|なな|しち|はち|きゅう|じゅう)+)';
const REF_READING = new RegExp(`(?:さんこう(?:しりょう|じょうほう|ぶんけん)?|てんぷ(?:しりょう|ふぁいる)?|しりょう)${KANA_NUM}(?:(?:と|、)${KANA_NUM})*(?:の(?:しりょう|きじ|でーた)?|によると|によれば|では|でも|より|から|で|に|が|は|も)、?`, 'g');

function tidy(t: string): string {
  return t
    .replace(/[（(［\[【〔]\s*[）)］\]】〕]/g, '')
    .replace(/[、,]\s*([、,。．.！!？?」』）)])/g, '$1')
    .replace(/^[\s、,：:]+/, '')
    .replace(/[ \t　]{2,}/g, ' ')
    .replace(/\s+([、。])/g, '$1')
    .trim();
}

/** 文中の「参考1」「添付2」「（参考3）」などの参考資料の番号を取り除く */
export function stripRefMarks(text: string): string {
  if (!text) return text;
  const t = text.replace(REF_BRACKETED, '').replace(REF_INLINE, '');
  return t === text ? text : tidy(t);
}
/** 読み上げ文（ひらがな）から「さんこういちによると」等を取り除く */
export function stripRefMarksReading(reading: string): string {
  if (!reading) return reading;
  const t = reading.replace(REF_BRACKETED, '').replace(REF_INLINE, '').replace(REF_READING, '');
  return t === reading ? reading : tidy(t);
}

/** 場面の全テキスト（ナレーション・読み上げ文・テロップ・見出し・図解の文字・出典）から参考資料の番号を取り除く */
export function stripRefMarksScene<T extends ExplainerScene>(sc: T): T {
  const narration = stripRefMarks(sc.narration);
  let reading = sc.reading;
  let readingStale = sc.readingStale;
  if (narration !== sc.narration) {
    const r2 = stripRefMarksReading(sc.reading);
    // ナレーションから番号を取ったのに読み上げ文から取れなかった場合は、読み上げ文を「要確認」にしてナレーションで読む
    if (r2 !== sc.reading) reading = r2; else readingStale = true;
  }
  const v = sc.visual;
  const visual = {
    ...v,
    heading: stripRefMarks(v.heading), subheading: stripRefMarks(v.subheading), emphasis: stripRefMarks(v.emphasis),
    source: stripRefMarks(v.source),
    items: v.items.map((it) => ({ ...it, label: stripRefMarks(it.label), text: stripRefMarks(it.text) })),
  };
  return { ...sc, narration, reading, ...(readingStale ? { readingStale } : {}), title: stripRefMarks(sc.title), caption: stripRefMarks(sc.caption), visual };
}

// ---- 用語の説明（初めて出てきたときだけ、短い説明を添える） ----
const WORDISH = /[\p{Script=Han}\p{Script=Katakana}A-Za-z0-9０-９Ａ-Ｚａ-ｚーｰ・]/u;
const KATALAT = /[\p{Script=Katakana}A-Za-z0-9０-９Ａ-Ｚａ-ｚーｰ]/u;
/** 用語が単語として出てくる位置（「スター」が「スターリンク」の一部に当たる、などを除く） */
function findTerm(text: string, term: string, from = 0): number {
  let i = text.indexOf(term, from);
  while (i >= 0) {
    const prev = text[i - 1] || '';
    const next = text[i + term.length] || '';
    const okPrev = !prev || !(KATALAT.test(term[0]) && KATALAT.test(prev));
    const okNext = !next || !(KATALAT.test(term[term.length - 1]) && KATALAT.test(next));
    if (okPrev && okNext) return i;
    i = text.indexOf(term, i + 1);
  }
  return -1;
}
/** 用語の近くですでに説明しているか（「〇〇とは」「〇〇（…）」「〇〇という」「〇〇は、…のこと」） */
function explainedNear(text: string, i: number, term: string, gloss: string): boolean {
  if (gloss && text.includes(gloss)) return true;
  const after = text.slice(i + term.length, i + term.length + 30);
  return /^(?:とは|って|（|\(|という|、つまり|は、?[^。]{2,28}(?:のこと|を指し|を意味))/.test(after);
}

/**
 * 動画全体で、用語が初めて出てくるナレーションにだけ説明を添え（無ければ「説明＋の＋用語」を差し込む）、
 * 2回目以降に同じ説明が繰り返されていたら取り除く。章の扉・参考資料・固定のデータ場面は対象外。
 * 読み上げ文は、用語の読み（termReading）が見つかればそこに説明の読みを差し込み、見つからなければ「要確認」にする。
 */
export function applyGlossary<T extends ExplainerScene>(scenes: T[], glossary: GlossTerm[] | undefined): T[] {
  if (!glossary?.length) return scenes;
  const out = scenes.map((s) => ({ ...s }));
  for (const g of glossary) {
    const term = (g.term || '').trim(), gloss = (g.gloss || '').trim().replace(/の$/, '');
    if (term.length < 2 || !gloss || gloss.includes(term)) continue;
    const dup = `${gloss}の${term}`;
    const dupR = g.glossReading && g.termReading ? `${g.glossReading.replace(/の$/, '')}の${g.termReading}` : '';
    let seen = false;
    for (const sc of out) {
      if (sc.fixedKey || sc.visual.kind === 'chapter' || sc.visual.kind === 'sources') continue;
      const i = findTerm(sc.narration, term);
      if (i < 0) continue;
      if (!seen) {
        seen = true;
        if (!explainedNear(sc.narration, i, term, gloss)) {
          const prev = sc.narration[i - 1] || '';
          if (prev && WORDISH.test(prev) && !/[・]/.test(prev)) continue; // 複合語の途中（例：新〇〇）には差し込まない
          sc.narration = `${sc.narration.slice(0, i)}${gloss}の${sc.narration.slice(i)}`;
          const ri = g.termReading ? sc.reading.indexOf(g.termReading) : -1;
          if (ri >= 0 && g.glossReading) sc.reading = `${sc.reading.slice(0, ri)}${g.glossReading.replace(/の$/, '')}の${sc.reading.slice(ri)}`;
          else sc.readingStale = true;
        }
        // 同じ場面の2回目以降の説明は取り除く
        const first = sc.narration.indexOf(dup);
        if (first >= 0) sc.narration = sc.narration.slice(0, first + dup.length) + sc.narration.slice(first + dup.length).split(dup).join(term);
        if (dupR) { const fr = sc.reading.indexOf(dupR); if (fr >= 0) sc.reading = sc.reading.slice(0, fr + dupR.length) + sc.reading.slice(fr + dupR.length).split(dupR).join(g.termReading!); }
      } else if (sc.narration.includes(dup)) {
        sc.narration = sc.narration.split(dup).join(term);
        if (dupR && sc.reading.includes(dupR)) sc.reading = sc.reading.split(dupR).join(g.termReading!);
        else if (g.glossReading) sc.readingStale = true;
      }
    }
  }
  return out;
}
