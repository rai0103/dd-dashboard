// AIによる台本生成：①目次（章立て・YouTube情報・出典）→②章ごとの場面（並列）→③宣伝用ショート。
// 長い出力を1回で作らせると途中で切れやすく時間もかかるため、章ごとに分けて生成する。
// 参考資料（PDF・URL本文・テキスト）は毎回同じ先頭部分として渡し、プロンプトキャッシュで再利用する。
import { callTool } from './aiClient';
import { ICON_NAMES, VISUAL_KINDS } from './types';
import type { ChapterPlan, ExplainerProject, ExplainerScene, SourceNote, YoutubeMeta } from './types';
import { assembleLong, normalizeScene } from './scriptModel';

export interface GenerateInput {
  topic: string;
  mode: 'news' | 'keyword';
  audience: 'beginner' | 'general' | 'advanced';
  targetMinutes: number;
  extraInstruction: string;
  /** referenceBlocks() の結果 */
  refBlocks: any[];
  today: string;
  /** 読み上げの速さ（声の「速さ」。長さの見積もりに使う。既定1.0） */
  speechRate?: number;
}

/** 日本語ナレーションの1分あたりの文字数の目安（話速1.0） */
export const CHARS_PER_MIN = 300;
/** 章の扉1枚あたりの秒数（scriptModel の minSecFor('chapter') と同じ） */
const CHAPTER_CARD_SEC = 3.2;

/**
 * 目標の長さ（分）と読み上げの速さから、場面数と1場面あたりの文字数を決める。
 * 1場面の長さ ≒ 0.3秒 ＋ 読み上げ ＋ 0.8秒。章の扉（約4枚）と余裕（5%）を差し引いて、目標を超えないようにする。
 */
export function planBudget(targetMinutes: number, speechRate = 1, bodyChapters = 4) {
  const cps = (CHARS_PER_MIN / 60) * Math.max(0.6, Math.min(2, speechRate));
  const content = targetMinutes * 60 * 0.95 - bodyChapters * CHAPTER_CARD_SEC;
  const sceneSec = 13;
  const sceneTotal = Math.max(6, Math.round(content / sceneSec));
  const perScene = Math.max(35, Math.min(110, Math.round((sceneSec - 1.1) * cps)));
  return { sceneTotal, perScene, minChars: Math.round(perScene * 0.75), maxChars: Math.round(perScene * 1.1), totalChars: sceneTotal * perScene };
}

/** 目次の場面数の合計が予算を超えないよう、各章の場面数を比例で縮める（各章2場面以上） */
export function fitSceneCounts(chapters: ChapterPlan[], sceneTotal: number): ChapterPlan[] {
  const sum = chapters.reduce((a, c) => a + c.sceneCount, 0);
  if (sum <= sceneTotal) return chapters;
  const out = chapters.map((c) => ({ ...c, sceneCount: Math.max(2, Math.floor((c.sceneCount * sceneTotal) / sum)) }));
  let over = out.reduce((a, c) => a + c.sceneCount, 0) - sceneTotal;
  for (let i = out.length - 1; over > 0 && i >= 0; i = i === 0 ? out.length - 1 : i - 1) {
    if (out.every((c) => c.sceneCount <= 2)) break;
    if (out[i].sceneCount > 2) { out[i].sceneCount -= 1; over -= 1; }
  }
  return out;
}

const AUDIENCE: Record<GenerateInput['audience'], string> = {
  beginner: '予備知識のない初心者（中学生にもわかる言葉。専門用語は必ず言い換えてから使う）',
  general: '一般の社会人（ニュースは見るが専門家ではない）',
  advanced: 'ある程度詳しい視聴者（基本用語の説明は短く、背景・影響の分析を厚めに）',
};

// systemは全呼び出しで同一にする（キャッシュが効くように、呼び出しごとの違いはuser本文に書く）
const SYSTEM_RULES = [
  'あなたは日本語のYouTube解説動画の構成作家です。ニュースや用語を、図解を多用してわかりやすく解説する台本を作ります。',
  '',
  '【内容の正確さ】',
  '- 事実・数値・日付は、渡された参考資料に書かれていることを最優先にする。参考資料にない最新の出来事を推測で書かない。',
  '- 一般常識として確立した基礎知識（用語の定義・仕組み）は補ってよいが、断定しにくいことは「〜とされています」「〜という見方があります」と表現する。',
  '- 意見が分かれる話題は、特定の立場に偏らず、主な見方を並べて紹介する。',
  '- バージョン番号（8.4.27 等）・日付・型番は量ではないので、数値の図解（number・bar・line・donut）にしない（points・timeline 等で表す）。unit は短く（%・兆円・万人・倍 など4文字以内）。',
  '- 数値を使う図解（number・bar・line・donut）は、参考資料にある数値だけを使い、visual.source に資料名（例：参考1 ○○）を必ず書く。資料に数値がなければ数値の図解は使わない。',
  '',
  '【著作権・肖像権への配慮】',
  '- 参考資料にYouTube動画の字幕がある場合は、発言の要点だけを参考にし、話し言葉をそのまま使わない。発言者の意見は「〇〇の動画では〜と解説されています」のように出典を示して紹介する。',
  '- 参考資料の文章をそのまま写さない。必ず自分の言葉で言い換えて要約する（引用が必要な場合も1文の一部・短く）。',
  '- 実在の人物の顔・似顔絵、企業や団体のロゴ・商標、既存のキャラクター・作品・写真を描写・再現しない。人物は役割（例：経営者、消費者）として汎用アイコン（person・group）で表す。',
  '- imagePrompt は、ユーザーが画像生成AIで自作する場合の英語のプロンプト案。実在の人物・有名人・政治家の名前、ブランド名・ロゴ、既存作品やキャラクター、画像内の文字を含めない。汎用的・抽象的な情景にし、末尾に "no text, no logos, no real people" を付ける。',
  '',
  '【飽きさせない構成】',
  '- 1場面は1つの要点だけ。ナレーションは1場面あたり40〜95文字（読み上げ約8〜18秒）。',
  '- 同じ種類の図解（visual.kind）を連続させない。数値の図解・流れ図・比較・年表・イメージ図などを織り交ぜる。',
  '- 冒頭で視聴者の疑問や驚きを引き出し、各章の終わりは次への興味をつなぐ一言で締める。',
  '- 話し言葉の「です・ます」調。1文は短く。専門用語は初出時に必ず言い換える。',
  '',
  '【読み上げ文（reading）】',
  '- narration と同じ内容を、ひらがなだけで書く（漢字・カタカナ・英数字は使わない。長音「ー」は可）。句読点は「、」「。」のみ。',
  '- 数字・単位・英字略語も読み方どおりにひらがなで書く（例：3.5% → さんてんごぱーせんと、GDP → じーでぃーぴー、2026年 → にせんにじゅうろくねん）。',
  '- 息継ぎしやすい位置に「、」を入れる。',
  '',
  '【図解（visual）の使い方】items の各項目は {label, value, text, icon}。使わない欄は空文字にする。',
  '- title：heading=動画タイトル、subheading=サブタイトル、emphasis=短いキャッチ、items=装飾用アイコン0〜3個',
  '- keyword：heading=用語、subheading=英語表記や正式名称、emphasis=ひとこと定義（25字以内）、items=関連語0〜3個',
  '- points：items 2〜4個（label=見出し12字以内、text=説明30字以内、icon）',
  '- number：items 1個（label=何の数字か、value=数値、text=比較・補足）、unit=単位、source必須',
  '- bar：items 2〜7個（label=項目、value=数値）、unit、source必須',
  '- line：items 3〜12個（label=時点、value=数値）、unit、source必須',
  '- donut：items 2〜5個（label、value=割合や構成比）、unit、source必須',
  '- timeline：items 3〜6個（label=時期、text=出来事20字以内、icon）',
  '- flow：items 3〜5個（label=段階8字以内、text=説明20字以内、icon）。原因→結果、手順の流れ',
  '- compare：items ちょうど2個（label=比べる対象、text=特徴を改行区切りで2〜4行、icon）',
  '- cycle：items 3〜5個（label、icon）。ぐるぐる回る関係',
  '- illustration：items 2〜5個（label=短い名前、icon）。1個目が中心。emphasis=情景を表す一言。抽象的なイメージ図',
  '- image：illustration と同じ指定に加え、imagePrompt を必ず書く（ユーザーが権利のある画像を追加する場面）',
  '- point：emphasis=強調したい一文25字以内、subheading=補足、items=アイコン0〜1個',
  '- qa：heading=視聴者が抱きそうな疑問、emphasis=答えの要点（短く）、subheading=補足',
  '- summary：items 3〜5個（label=まとめの一文）',
  '- cta：heading と emphasis で締めの呼びかけ（チャンネル登録・関連動画など）',
  `- 使えるアイコン：${ICON_NAMES.join(', ')}`,
  '',
  '【caption】画面下に出す短いテロップ（20字以内）。【title】構成リスト用の短い場面名（12字以内）。',
].join('\n');

function system() { return [{ type: 'text' as const, text: SYSTEM_RULES, cache_control: { type: 'ephemeral' as const } }]; }

const ITEM_SCHEMA = {
  type: 'object',
  properties: {
    label: { type: 'string' }, value: { type: 'string' }, text: { type: 'string' },
    icon: { type: 'string', enum: [...ICON_NAMES] },
  },
  required: ['label', 'value', 'text', 'icon'],
};
const VISUAL_SCHEMA = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: [...VISUAL_KINDS] },
    heading: { type: 'string' }, subheading: { type: 'string' },
    items: { type: 'array', items: ITEM_SCHEMA },
    unit: { type: 'string' }, source: { type: 'string' }, emphasis: { type: 'string' }, imagePrompt: { type: 'string' },
  },
  required: ['kind', 'heading', 'subheading', 'items', 'unit', 'source', 'emphasis', 'imagePrompt'],
};
const SCENE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: '構成リスト用の短い場面名（12字以内）' },
    caption: { type: 'string', description: '画面下のテロップ（20字以内）' },
    narration: { type: 'string', description: 'ナレーション（です・ます調、40〜95文字）' },
    reading: { type: 'string', description: 'narrationをひらがなのみで書いた読み上げ文' },
    visual: VISUAL_SCHEMA,
  },
  required: ['title', 'caption', 'narration', 'reading', 'visual'],
};
const SCENES_SCHEMA = { type: 'object', properties: { scenes: { type: 'array', items: SCENE_SCHEMA } }, required: ['scenes'] };

function header(inp: GenerateInput): string {
  const kind = inp.mode === 'news' ? 'ニュース' : 'キーワード（用語）';
  return [
    `【テーマ（${kind}）】${inp.topic}`,
    `【想定視聴者】${AUDIENCE[inp.audience]}`,
    `【制作日】${inp.today}`,
    inp.refBlocks.length ? '【参考資料】このメッセージ冒頭のドキュメントを参照してください。' : '【参考資料】なし（一般に確立した知識の範囲で解説し、最新の数値・出来事には触れない）',
    inp.extraInstruction.trim() ? `【制作者からの追加の指示】${inp.extraInstruction.trim()}` : '',
  ].filter(Boolean).join('\n');
}

export interface Outline {
  videoTitle: string;
  kicker: string;
  chapters: ChapterPlan[];
  youtube: YoutubeMeta;
  sources: SourceNote[];
}

export async function generateOutline(inp: GenerateInput, signal?: AbortSignal): Promise<Outline> {
  const { sceneTotal, totalChars, minChars, maxChars } = planBudget(inp.targetMinutes, inp.speechRate ?? 1);
  const task = [
    header(inp),
    '',
    `${inp.targetMinutes}分以内（ナレーション合計 約${totalChars}文字、場面は合計${sceneTotal}個以内、1場面${minChars}〜${maxChars}文字）の長尺解説動画の「目次」を作ってください。長さは必ず目標以内に収める（要点を絞る）。`,
    `- 本編の章は${inp.targetMinutes <= 5 ? '3〜4' : '3〜6'}章。各章の sceneCount の合計は${sceneTotal}以下にする。`,
    '- kicker には分数（○分でわかる 等）を入れない（実際の長さは読み上げで変わるため）。例：ニュース解説、やさしく解説。',
    '- chapters は、最初に role=intro（つかみ＋この動画でわかること、場面2〜3個）、次に role=body の本編を3〜6章、最後に role=outro（まとめ＋締め、場面2〜3個）。',
    inp.mode === 'news'
      ? '- 本編の流れの例：何が起きたか → 背景・そもそもの仕組み → なぜ重要か（影響） → 今後の注目点。'
      : '- 本編の流れの例：ひとことで言うと → 仕組み・具体例 → 似た用語との違い・よくある誤解 → 身近な影響・使われ方。',
    '- 各章の sceneCount の合計が、場面の目安数に近くなるようにする。goal は章で伝えること、keyPoints は章で扱う要点（他の章と重複させない）。',
    '- chapters[].reading は章タイトルのひらがな読み。',
    '- youtube.title は検索されやすく誇張のないタイトル（40字以内）。thumbnailText はサムネ用の短い文字（12字以内）。tags は5〜10個。shortTitle・shortDescription は宣伝用ショート動画用（本編へ誘導）。description は本編の概要（3〜5行、目次付き）。',
    '- sources は実際に使う参考資料（資料名と、発行元・日付などの補足）。参考資料がなければ空配列。',
  ].join('\n');
  const r = await callTool<any>({
    system: system(),
    content: [...inp.refBlocks, { type: 'text', text: task }],
    toolName: 'plan_explainer_video',
    toolDescription: '解説動画の目次（章立て）・YouTube用の情報・出典をまとめる。',
    inputSchema: {
      type: 'object',
      properties: {
        videoTitle: { type: 'string' },
        kicker: { type: 'string', description: '冒頭に出す短いラベル（分数は入れない。例：ニュース解説、やさしく解説）' },
        chapters: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' }, reading: { type: 'string' },
              role: { type: 'string', enum: ['intro', 'body', 'outro'] },
              goal: { type: 'string' }, keyPoints: { type: 'string' }, sceneCount: { type: 'integer' },
            },
            required: ['title', 'reading', 'role', 'goal', 'keyPoints', 'sceneCount'],
          },
        },
        youtube: {
          type: 'object',
          properties: {
            title: { type: 'string' }, description: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } },
            thumbnailText: { type: 'string' }, shortTitle: { type: 'string' }, shortDescription: { type: 'string' },
          },
          required: ['title', 'description', 'tags', 'thumbnailText', 'shortTitle', 'shortDescription'],
        },
        sources: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, detail: { type: 'string' } }, required: ['title', 'detail'] } },
      },
      required: ['videoTitle', 'kicker', 'chapters', 'youtube', 'sources'],
    },
    maxTokens: 8000,
    signal,
  });
  let chapters: ChapterPlan[] = (Array.isArray(r?.chapters) ? r.chapters : []).map((c: any) => ({
    title: String(c?.title || '').slice(0, 40), reading: String(c?.reading || ''),
    role: c?.role === 'intro' || c?.role === 'outro' ? c.role : 'body',
    goal: String(c?.goal || ''), keyPoints: String(c?.keyPoints || ''),
    sceneCount: Math.max(2, Math.min(10, Math.round(Number(c?.sceneCount) || 4))),
  })).filter((c: ChapterPlan) => c.title);
  if (!chapters.length) throw new Error('目次を作れませんでした。もう一度お試しください。');
  chapters = fitSceneCounts(chapters.slice(0, 9), sceneTotal);
  const y = r?.youtube || {};
  return {
    videoTitle: String(r?.videoTitle || inp.topic),
    kicker: String(r?.kicker || (inp.mode === 'news' ? 'ニュース解説' : 'キーワード解説')),
    chapters,
    youtube: {
      title: String(y.title || r?.videoTitle || inp.topic), description: String(y.description || ''),
      tags: Array.isArray(y.tags) ? y.tags.map(String).slice(0, 12) : [],
      thumbnailText: String(y.thumbnailText || ''), shortTitle: String(y.shortTitle || ''), shortDescription: String(y.shortDescription || ''),
    },
    sources: (Array.isArray(r?.sources) ? r.sources : []).map((s: any) => ({ title: String(s?.title || ''), detail: String(s?.detail || '') })).filter((s: SourceNote) => s.title),
  };
}

function outlineText(o: Outline): string {
  return o.chapters.map((c, i) => `${i + 1}. [${c.role}] ${c.title}（場面${c.sceneCount}個）— ${c.goal}／要点：${c.keyPoints}`).join('\n');
}

/** 1回の呼び出しで作る場面の上限（日本語のナレーション＋ひらがなの読み上げ文は長くなりやすいため、少しずつ作る） */
export const SCENES_PER_CALL = 4;

async function generateChapterPart(inp: GenerateInput, o: Outline, idx: number, count: number, partNo: number, partTotal: number, prev: ExplainerScene[], signal?: AbortSignal): Promise<ExplainerScene[]> {
  const ch = o.chapters[idx];
  const first = prev.length === 0;
  const roleNote = ch.role === 'intro'
    ? (first ? '- これは動画の冒頭です。1場面目は visual.kind=title（動画タイトル）で、視聴者の疑問や驚きを引き出す「つかみ」のナレーションにする。続けて「この動画でわかること」を示す。' : '- 動画の冒頭部分の続きです。')
    : ch.role === 'outro'
      ? '- これは動画の最後です。summary で要点をまとめ、最後の場面は visual.kind=cta で、チャンネル登録や関連動画への短い呼びかけで締める。'
      : (first ? '- 章の扉（章タイトルの場面）は自動で入るので作らない。章の1場面目は、前の章から自然につながる導入にする。' : '- 章の扉は作らない。');
  const task = [
    header(inp),
    '',
    `動画タイトル：${o.videoTitle}`,
    '【全体の目次】',
    outlineText(o),
    '',
    partTotal > 1
      ? `この中の「${idx + 1}. ${ch.title}」の章（全${ch.sceneCount}場面）を${partTotal}回に分けて作ります。今回はその${partNo}回目として、場面を${count}個作ってください。`
      : `この中の「${idx + 1}. ${ch.title}」の章の場面を、${count}個作ってください。`,
    `- 章で伝えること：${ch.goal}`,
    `- 扱う要点：${ch.keyPoints}（他の章の要点は扱わない）`,
    roleNote,
    prev.length ? `【この章ですでに作った場面（続きから書き、内容を繰り返さない）】\n${prev.map((s) => `・[${s.visual.kind}] ${s.narration}`).join('\n')}` : '',
    partTotal > 1 && partNo < partTotal ? '- 章の途中なので、締めの言葉は入れない。' : '',
    '- 図解の種類を毎場面変え、数値の図解・流れ図・比較・イメージ図などをバランスよく使う。',
    `- 動画全体を${inp.targetMinutes}分以内に収めるため、ナレーションは1場面${planBudget(inp.targetMinutes, inp.speechRate ?? 1).minChars}〜${planBudget(inp.targetMinutes, inp.speechRate ?? 1).maxChars}文字にする（超えない）。`,
  ].filter(Boolean).join('\n');
  try {
    const r = await callTool<any>({
      system: system(),
      content: [...inp.refBlocks, { type: 'text', text: task }],
      toolName: 'write_chapter_scenes',
      toolDescription: '解説動画の1章分（またはその一部）の場面（ナレーション・読み上げ文・図解の指定）を作る。',
      inputSchema: SCENES_SCHEMA,
      maxTokens: 12000,
      signal,
    });
    return (Array.isArray(r?.scenes) ? r.scenes : []).slice(0, count + 1).map((s: any) => normalizeScene(s, idx)).filter((s: ExplainerScene) => s.narration);
  } catch (e: any) {
    // 途中で切れたら、半分ずつに分けて作り直す
    if (e?.code === 'MAX_TOKENS' && count > 1) {
      const a = Math.ceil(count / 2);
      const p1 = await generateChapterPart(inp, o, idx, a, partNo, partTotal, prev, signal);
      const p2 = await generateChapterPart(inp, o, idx, count - a, partNo, partTotal, [...prev, ...p1], signal);
      return [...p1, ...p2];
    }
    throw e;
  }
}

export async function generateChapter(inp: GenerateInput, o: Outline, idx: number, signal?: AbortSignal): Promise<ExplainerScene[]> {
  const ch = o.chapters[idx];
  const partTotal = Math.ceil(ch.sceneCount / SCENES_PER_CALL);
  const out: ExplainerScene[] = [];
  for (let k = 0; k < partTotal; k++) {
    const count = Math.min(SCENES_PER_CALL, ch.sceneCount - k * SCENES_PER_CALL);
    out.push(...await generateChapterPart(inp, o, idx, count, k + 1, partTotal, out, signal));
  }
  if (!out.length) throw new Error(`「${ch.title}」の場面を作れませんでした。`);
  return out;
}

/** 長尺の内容をもとに、本編へ誘導する宣伝用ショート（縦型・35〜55秒）を作る */
export async function generateShort(inp: GenerateInput, o: Outline, longScenes: ExplainerScene[], signal?: AbortSignal): Promise<ExplainerScene[]> {
  const digest = longScenes.filter((s) => s.visual.kind !== 'chapter' && s.visual.kind !== 'sources').map((s) => `・${s.narration}`).join('\n').slice(0, 6000);
  const task = [
    header(inp),
    '',
    `本編（長尺）動画「${o.videoTitle}」を宣伝する、縦型ショート動画（35〜55秒）の場面を5〜7個作ってください。`,
    '- 1場面目：視聴者が思わず止まる「問いかけ」か「意外な事実」（visual.kind は title・number・qa のいずれか）。最初の一言で引き込む。',
    '- 2〜5場面目：本編の見どころを短く小出しにする（答えを全部言わず、続きが気になるように）。1場面のナレーションは25〜55文字。',
    '- 最後の場面：visual.kind=cta。「くわしくは本編で」と本編動画への誘導（関連動画のリンクから）。',
    '- 縦長の画面なので、図解の項目数は少なめ（2〜4個）。',
    '【本編のナレーション（抜粋）】',
    digest,
  ].join('\n');
  const r = await callTool<any>({
    system: system(),
    content: [...inp.refBlocks, { type: 'text', text: task }],
    toolName: 'write_short_scenes',
    toolDescription: '本編へ誘導する縦型ショート動画の場面を作る。',
    inputSchema: SCENES_SCHEMA,
    maxTokens: 12000,
    signal,
  });
  const scenes = (Array.isArray(r?.scenes) ? r.scenes : []).map((s: any) => normalizeScene(s, 0)).filter((s: ExplainerScene) => s.narration);
  if (!scenes.length) throw new Error('ショートの場面を作れませんでした。');
  return scenes.map((s) => ({ ...s, minSec: Math.min(s.minSec, 4.5) }));
}

/** 1場面をAIへの指示で作り直す（既存場面の書き直し・新しい場面の追加の両方に使う） */
export async function rewriteScene(inp: GenerateInput, videoTitle: string, instruction: string, current: ExplainerScene | null, neighbors: string[], format: 'long' | 'short', signal?: AbortSignal): Promise<ExplainerScene> {
  const task = [
    header(inp),
    '',
    `動画タイトル：${videoTitle}（${format === 'short' ? '縦型ショート' : '長尺16:9'}）`,
    neighbors.length ? `【前後の場面のナレーション】\n${neighbors.map((n) => `・${n}`).join('\n')}` : '',
    current ? `【現在の場面】${JSON.stringify({ title: current.title, caption: current.caption, narration: current.narration, visual: current.visual })}` : '【新しい場面を1つ作る】',
    `【指示】${instruction}`,
    '場面を1つだけ返してください（scenes は1要素）。',
  ].filter(Boolean).join('\n');
  const r = await callTool<any>({
    system: system(),
    content: [...inp.refBlocks, { type: 'text', text: task }],
    toolName: 'write_scene',
    toolDescription: '解説動画の場面を1つ作る（または指示どおりに作り直す）。',
    inputSchema: SCENES_SCHEMA,
    maxTokens: 4000,
    signal,
  });
  const raw = Array.isArray(r?.scenes) ? r.scenes[0] : null;
  if (!raw) throw new Error('AIから場面が返りませんでした。');
  const sc = normalizeScene(raw, current?.chapter ?? 0);
  return current ? { ...sc, id: current.id, chapter: current.chapter, imageId: current.imageId ?? null } : sc;
}

export interface GenerateProgress { step: string; done: number; total: number }

/** 目次→章ごと（最初の1章のあとは3並列）→ショート の順に生成し、プロジェクト一式を返す */
export async function generateProject(inp: GenerateInput, onProgress: (p: GenerateProgress) => void, signal?: AbortSignal, withShort = true, withSourcesScene = false): Promise<ExplainerProject> {
  onProgress({ step: '目次を作成中…', done: 0, total: 1 });
  const step = async <T,>(label: string, fn: () => Promise<T>): Promise<T> => {
    try { return await fn(); } catch (e: any) { if (e && typeof e.message === 'string' && e.code !== 'ABORTED') e.message = `【${label}】${e.message}`; throw e; }
  };
  const o = await step('目次', () => generateOutline(inp, signal));
  const n = o.chapters.length;
  const total = n + 1 + (withShort ? 1 : 0);
  let done = 1;
  const per: ExplainerScene[][] = new Array(n).fill(null).map(() => []);
  const runOne = async (i: number) => {
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try { per[i] = await step(`${i + 1}章「${o.chapters[i].title}」`, () => generateChapter(inp, o, i, signal)); lastErr = null; break; }
      catch (e: any) { lastErr = e; if (e?.code === 'NO_API_KEY' || e?.code === 'SERVER_UNREACHABLE' || e?.code === 'ABORTED') break; }
    }
    if (lastErr) throw lastErr;
    done += 1;
    onProgress({ step: `章ごとの場面を作成中…（${done - 1}/${n}章）`, done, total });
  };
  onProgress({ step: `章ごとの場面を作成中…（0/${n}章）`, done, total });
  await runOne(0); // 1章目で参考資料のキャッシュを作ってから、残りを並列にする
  const rest = Array.from({ length: n - 1 }, (_, k) => k + 1);
  const workers = Array.from({ length: Math.min(3, rest.length) }, async () => { while (rest.length) { const i = rest.shift()!; await runOne(i); } });
  await Promise.all(workers);
  const longScenes = assembleLong(o.chapters, per, o.sources, true, withSourcesScene);
  let shortScenes: ExplainerScene[] = [];
  if (withShort) {
    onProgress({ step: '宣伝用ショートを作成中…', done, total });
    shortScenes = await step('ショート', () => generateShort(inp, o, longScenes, signal));
    done += 1;
  }
  onProgress({ step: '完了', done: total, total });
  return {
    version: 1, topic: inp.topic, mode: inp.mode, audience: inp.audience, targetMinutes: inp.targetMinutes,
    videoTitle: o.videoTitle, kicker: o.kicker, chapters: o.chapters, longScenes, shortScenes,
    youtube: o.youtube, sources: o.sources, createdAt: Date.now(),
  };
}
