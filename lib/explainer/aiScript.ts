// AIによる台本生成：①目次（章立て・YouTube情報・出典）→②章ごとの場面（並列）→③宣伝用ショート。
// 長い出力を1回で作らせると途中で切れやすく時間もかかるため、章ごとに分けて生成する。
// 参考資料（PDF・URL本文・テキスト）は毎回同じ先頭部分として渡し、プロンプトキャッシュで再利用する。
import { callTool } from './aiClient';
import { ICON_NAMES, VISUAL_KINDS } from './types';
import type { ChapterPlan, ExplainerProject, ExplainerScene, SourceNote, StockCatalog, YoutubeMeta } from './types';
import { assembleLong, normalizeScene, sanitizeReading } from './scriptModel';
import { resolveYearCompareItems, resolveCatalogKey } from './stockCatalog';

export interface GenerateInput {
  topic: string;
  mode: 'news' | 'stock' | 'keyword';
  audience: 'beginner' | 'general' | 'advanced' | 'expert';
  targetMinutes: number;
  extraInstruction: string;
  /** referenceBlocks() の結果 */
  refBlocks: any[];
  today: string;
  /** 読み上げの速さ（声の「速さ」。長さの見積もりに使う。既定1.0） */
  speechRate?: number;
  /** AIで画像を自動生成して挿入する場合の目安枚数（長尺動画全体で、visual.kind=imageにする場面のおおよその数）。0/未指定なら従来通りAIの判断に任せる */
  imageTarget?: number;
  /** [Stage E-4] mode==='stock' のときの実データカタログ。bar/line/donut/numberの数値はこの中のキーのみ使わせ、AIの創作値を禁止する */
  stockCatalog?: StockCatalog;
  /** [Stage E-5] 今回の生成で使う「切り口」（マンネリ防止）。未指定ならheader()は何も加えない。generateProject/generateShortが内部で自動選択する */
  sceneAngle?: string;
  /** [Stage E-7] 「必ず動画に含める」とマークした参考情報の説明（lib/explainer/references.tsのrequiredRefNotes）。
   *  指定があればheader()で名指しし、AIがその内容を省略しないよう強制する */
  requiredRefNotes?: string[];
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
  // [Stage E-10] 視聴者種別の中で最も専門的なレベル。基本用語の説明は省き、専門用語・数値をそのまま使い、
  // 前提条件・根拠・限界（データの出典や解釈の分かれ目）まで踏み込んだ分析を主軸にする
  expert: '実務家・専門家レベルの視聴者（基本用語の説明は省略し、専門用語や数値をそのまま使う。前提条件・根拠・解釈の分かれ目まで踏み込んで分析する）',
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
  '- 「ダッシュボード」という語は一般には意味が伝わりにくいため使わない。「過去の実績」「過去のデータ」のように言い換える。',
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
  '- 読み間違えやすい語に注意する：「最高値」は「さいたかね」（「さいこうね」ではない）。「下落」は「げらく」（「からく」ではない）。',
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
  '- yearCompare：株式情報モードのみ使える。複数の年・期間の値動きを同じ年内日数で重ねて比較するグラフ。itemsは空のままで良く、代わりにvisualのseriesKeysに下記yearCompare.*のキーを2〜6個指定してください（例：今年と直近の数年、または今年と平均系列）',
  '- point：emphasis=強調したい一文25字以内、subheading=補足、items=アイコン0〜1個',
  '- qa：heading=視聴者が抱きそうな疑問、emphasis=答えの要点（短く）、subheading=補足',
  '- summary：items 3〜5個（label=まとめの一文）',
  '- cta：heading と emphasis で締めの呼びかけ（チャンネル登録・関連動画など）',
  `- 使えるアイコン：${ICON_NAMES.join(', ')}`,
  '',
  '【caption】画面下に出す短いテロップ（20字以内）。【title】構成リスト用の短い場面名（12字以内）。',
].join('\n');

/** [Stage E-4] StockCatalogのキー一覧を、AIに渡す「使えるdataKey」のテキストにする */
function stockCatalogKeyList(cat: StockCatalog): string {
  const lines: string[] = [];
  for (const [key, v] of Object.entries(cat.scalars)) lines.push(`scalars.${key}：${v.label}`);
  for (const [key, v] of Object.entries(cat.series)) lines.push(`series.${key}：${v.label}（月ごとの値の推移）`);
  // [Stage E-9] yearCompare.* はseriesKeys（複数指定可）専用のキー一覧。series.* のseriesKey（1個のみ）とは別物
  if (cat.yearCompare) for (const [key, v] of Object.entries(cat.yearCompare.series)) lines.push(`yearCompare.${key}：${v.label}`);
  return lines.join('\n');
}

function system(inp?: GenerateInput) {
  const blocks: { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }[] = [{ type: 'text', text: SYSTEM_RULES }];
  if (inp?.mode === 'stock' && inp.stockCatalog && (Object.keys(inp.stockCatalog.scalars).length || Object.keys(inp.stockCatalog.series).length)) {
    const cat = inp.stockCatalog;
    blocks.push({
      type: 'text',
      text: [
        `【株価データ】これは${cat.instrumentLabel}（${cat.asOf || '直近'}時点）の実際のデータです。`,
        '- bar・donut・numberの図解で数値を使う場合は、各itemのdataKeyに下記のscalars.*のキーを1つ指定してください（value・labelは仮の内容で構いません。実際の値・ラベルはdataKeyから自動的に差し替わります）。',
        '- line（折れ線）で実データの推移を見せる場合は、visualのseriesKeyに下記series.*のキーを1つ指定してください（itemsはダミーで構いません。実際の点はseriesKeyから自動的に生成されます）。',
        '- yearCompare（年比較グラフ）で複数年・複数期間の値動きを重ねて見せる場合は、visualのseriesKeysに下記yearCompare.*のキーを2〜6個指定してください（itemsはダミーで構いません。「今年」を強調表示したい場合はcurYearで終わるキーを含めてください）。',
        '- dataKey・seriesKey・seriesKeysに指定するキーは、下記【使えるキー一覧】に書かれた文字列（scalars./series./yearCompare.の接頭辞を除いた部分）を一字一句そのまま使ってください。銘柄名::が付いたキー（例：S&P500::curYear）は、銘柄名::の部分を省略せずそのまま含めてください（省略すると解決できず図解が表示されません）。',
        '- 下記のキーに無い数値を、数値の図解（bar・line・donut・number・yearCompare）で新たに作成することは禁止です（points・timeline等、数値を使わない図解であれば自由な内容にできます）。',
        '【使えるキー一覧】',
        stockCatalogKeyList(cat),
      ].join('\n'),
      cache_control: { type: 'ephemeral' },
    });
  } else {
    blocks[0].cache_control = { type: 'ephemeral' };
  }
  return blocks;
}

/**
 * [Stage E-4] 株式情報モード：AIの生データ（normalizeScene前）のうち、line.seriesKey／bar・donut・numberの
 * items[].dataKey を実データで解決する。解決できなければ値を空文字にするだけで、以降の処理
 * （normalizeVisual→既存の「数値が足りなければpointsへ自動降格」フォールバック、lib/explainer/scriptModel.ts）
 * に委ねる＝レンダラー側・既存の降格ロジックは一切変更しない。
 */
export function applyStockDataKeysToScene(raw: any, catalog: StockCatalog | undefined): any {
  if (!catalog || !raw || typeof raw !== 'object' || !raw.visual) return raw;
  const v = raw.visual;
  if (v.kind === 'line') {
    const key = typeof v.seriesKey === 'string' ? v.seriesKey.replace(/^series\./, '') : '';
    // [Stage E-10] resolveCatalogKeyで「銘柄名::」接頭辞の省略も救済する（複数銘柄統合時にAIが接頭辞を
    // 落として指定しても、候補が一意なら解決できるようにする。曖昧な場合は解決せず安全側に倒す）
    const resolvedKey = key ? resolveCatalogKey(key, catalog.series) : undefined;
    const entry = resolvedKey ? catalog.series[resolvedKey] : undefined;
    if (entry && entry.points.length >= 3) {
      const icon = Array.isArray(v.items) && v.items[0]?.icon ? v.items[0].icon : 'chart';
      const items = entry.points.map((p) => ({ label: p.label, value: String(Math.round(p.value * 10) / 10), text: '', icon }));
      return { ...raw, visual: { ...v, items, heading: v.heading || entry.label } };
    }
    return { ...raw, visual: { ...v, items: Array.isArray(v.items) ? v.items.map((it: any) => ({ ...it, value: '' })) : [] } };
  }
  if (v.kind === 'bar' || v.kind === 'donut' || v.kind === 'number') {
    if (!Array.isArray(v.items)) return raw;
    const items = v.items.map((it: any) => {
      const dk = typeof it?.dataKey === 'string' ? it.dataKey.replace(/^scalars\./, '') : '';
      const resolvedKey = dk ? resolveCatalogKey(dk, catalog.scalars) : undefined;
      const e = resolvedKey ? catalog.scalars[resolvedKey] : undefined;
      return e ? { ...it, label: e.label, value: String(Math.round(e.value * 10) / 10) } : { ...it, value: '' };
    });
    return { ...raw, visual: { ...v, items } };
  }
  // [Stage E-9] yearCompare：visual.seriesKeysに挙げられたyearCompare.*のキー（2〜8個）を実データの
  // 複数系列（items、系列ごとにseriesKeyでグループ化）に差し替える。正規化側（normalizeVisual）の
  // グループ化チェックで、有効な系列が2つ未満ならpointsへ降格する（でっち上げ防止の最終防衛線）
  if (v.kind === 'yearCompare') {
    const keys = Array.isArray(v.seriesKeys) ? v.seriesKeys.map((k: any) => String(k).replace(/^yearCompare\./, '')) : [];
    const items = resolveYearCompareItems(keys, catalog.yearCompare);
    return { ...raw, visual: { ...v, items } };
  }
  return raw;
}

const ITEM_SCHEMA = {
  type: 'object',
  properties: {
    label: { type: 'string' }, value: { type: 'string' }, text: { type: 'string' },
    icon: { type: 'string', enum: [...ICON_NAMES] },
    // [Stage E-4] 株式情報モードのみ使う。'scalars.xxx' か 'series.xxx' の形で指定すると、value/labelが実データに差し替わる
    dataKey: { type: 'string' },
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
    // [Stage E-4] 株式情報モードのline（折れ線）のみ使う。'series.xxx' の形で1つ指定すると、itemsが実データの点列に差し替わる
    seriesKey: { type: 'string' },
    // [Stage E-9] 株式情報モードのyearCompareのみ使う。'yearCompare.xxx' の形で2〜6個指定すると、itemsが実データの複数系列に差し替わる
    seriesKeys: { type: 'array', items: { type: 'string' } },
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

// [Stage E-5] マンネリ防止：モードごとに毎回ランダムで選ぶ「切り口」候補。同じテーマ・同じ日付でも、
// 生成するたびに違う構成になることを狙う（完全な一致防止ではなく、構成作家への「お題」を変える軽量な対策）。
const SCENE_ANGLES: Record<GenerateInput['mode'], string[]> = {
  news: [
    '背景にある歴史や経緯を丁寧にたどる構成',
    '複数の立場・意見の対立を軸にした構成',
    '専門用語を一つずつ丁寧に解きほぐす構成',
    '今後の影響・将来の展開を中心にした構成',
    '具体的な数字・統計を軸に説得力を持たせる構成',
    '似たような過去の出来事との比較を交えた構成',
  ],
  stock: [
    '直近の値動きの大きさに注目する構成',
    '年初来のトレンドを中心にした構成',
    '他の指数・銘柄との比較を交えた構成',
    '過去の似た局面との比較を軸にした構成',
    '長期的な資産形成の観点を中心にした構成',
    'リスク（下落シナリオ）に焦点を当てた構成',
  ],
  keyword: [
    '身近な具体例から入る構成',
    '歴史的な由来・語源から掘り下げる構成',
    '似た用語との違いを比較する構成',
    'よくある誤解を正すことを軸にした構成',
    '実務での使われ方・具体的な活用例を中心にした構成',
    '初心者が最初に疑問に思う点から始める構成',
  ],
};
function pickAngle(mode: GenerateInput['mode']): string {
  const list = SCENE_ANGLES[mode] ?? SCENE_ANGLES.news;
  return list[Math.floor(Math.random() * list.length)];
}

export function header(inp: GenerateInput): string {
  const kind = inp.mode === 'news' ? 'ニュース' : inp.mode === 'stock' ? '株式情報' : 'キーワード（用語）';
  return [
    `【テーマ（${kind}）】${inp.topic}`,
    `【想定視聴者】${AUDIENCE[inp.audience]}`,
    `【制作日】${inp.today}`,
    inp.refBlocks.length ? '【参考資料】このメッセージ冒頭のドキュメントを参照してください。' : '【参考資料】なし（一般に確立した知識の範囲で解説し、最新の数値・出来事には触れない）',
    inp.extraInstruction.trim() ? `【制作者からの追加の指示】${inp.extraInstruction.trim()}` : '',
    // [Stage E-5] マンネリ防止：今回選ばれた切り口を主軸にするよう明示する
    inp.sceneAngle ? `【今回の切り口】${inp.sceneAngle}（毎回変えています。前回と似た構成にならないよう、この切り口を主軸に章立てを考えてください）` : '',
    // [Stage E-7] 「必ず動画に含める」とマークされた参考情報を名指しし、省略を禁止する
    inp.requiredRefNotes && inp.requiredRefNotes.length
      ? `【必ず扱う参考情報】次の資料は、動画の中で必ず具体的に触れてください（存在を無視したり省略したりせず、該当する数値・固有名詞・出来事を実際に使うこと）：\n${inp.requiredRefNotes.map((s) => `・${s}`).join('\n')}`
      : '',
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
    '- youtube.title は検索されやすく誇張のないタイトル（40字以内）。thumbnailText はサムネ用の短い文字（12字以内）。tags は概要欄末尾のハッシュタグにそのまま使うので、関連する単語を10個（テーマ・固有名詞・分野などを組み合わせて重複なく）。shortTitle・shortDescription は宣伝用ショート動画用（本編へ誘導）。description は本編の概要（3〜5行、目次付き）。',
    '- sources は実際に使う参考資料（資料名と、発行元・日付などの補足）。参考資料がなければ空配列。',
  ].join('\n');
  const r = await callTool<any>({
    system: system(inp),
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
            title: { type: 'string' }, description: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' }, description: '概要欄末尾に付けるハッシュタグ用キーワード。10個。' },
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

/**
 * AIで画像を自動生成する場合（inp.imageTarget>0）、動画全体の目安枚数を各章の場面数に応じて按分し、
 * 「この章ではvisual.kind=imageをおおよそN個使う」という指示文を作る（内容に合わない場面まで無理に
 * imageにしないよう、あくまで目安として伝える）。imageTargetが0/未指定なら何も付け足さない（従来通り）。
 */
function imageQuotaNote(inp: GenerateInput, o: Outline, ch: ChapterPlan): string {
  const target = Math.max(0, Math.round(inp.imageTarget || 0));
  if (!target) return '';
  const totalScenes = o.chapters.reduce((a, c) => a + c.sceneCount, 0) || 1;
  const quota = Math.round(target * (ch.sceneCount / totalScenes));
  if (!quota) return '';
  return `- この章では、visual.kind=image の場面をおよそ${quota}個使う（画像生成AIで自動的に画像を作って挿入するため）。内容的に画像が合う場面だけに使い、無理に増やさない。`;
}

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
    imageQuotaNote(inp, o, ch),
    prev.length ? `【この章ですでに作った場面（続きから書き、内容を繰り返さない）】\n${prev.map((s) => `・[${s.visual.kind}] ${s.narration}`).join('\n')}` : '',
    partTotal > 1 && partNo < partTotal ? '- 章の途中なので、締めの言葉は入れない。' : '',
    '- 図解の種類を毎場面変え、数値の図解・流れ図・比較・イメージ図などをバランスよく使う。',
    `- 動画全体を${inp.targetMinutes}分以内に収めるため、ナレーションは1場面${planBudget(inp.targetMinutes, inp.speechRate ?? 1).minChars}〜${planBudget(inp.targetMinutes, inp.speechRate ?? 1).maxChars}文字にする（超えない）。`,
  ].filter(Boolean).join('\n');
  try {
    const r = await callTool<any>({
      system: system(inp),
      content: [...inp.refBlocks, { type: 'text', text: task }],
      toolName: 'write_chapter_scenes',
      toolDescription: '解説動画の1章分（またはその一部）の場面（ナレーション・読み上げ文・図解の指定）を作る。',
      inputSchema: SCENES_SCHEMA,
      maxTokens: 12000,
      signal,
    });
    return (Array.isArray(r?.scenes) ? r.scenes : []).slice(0, count + 1).map((s: any) => applyStockDataKeysToScene(s, inp.stockCatalog)).map((s: any) => normalizeScene(s, idx)).filter((s: ExplainerScene) => s.narration);
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
  // [Stage E-5] generateProjectから渡された場合はそのsceneAngleをそのまま使う。「ショートだけ作り直す」単独呼び出しの場合は
  // ここで新たに選び直す（本編と違う切り口になっても問題ない＝宣伝用の短い動画なので、作り直すたびに違う見せ方になる方が望ましい）。
  inp = { ...inp, sceneAngle: inp.sceneAngle ?? pickAngle(inp.mode) };
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
    system: system(inp),
    content: [...inp.refBlocks, { type: 'text', text: task }],
    toolName: 'write_short_scenes',
    toolDescription: '本編へ誘導する縦型ショート動画の場面を作る。',
    inputSchema: SCENES_SCHEMA,
    maxTokens: 12000,
    signal,
  });
  const scenes = (Array.isArray(r?.scenes) ? r.scenes : []).map((s: any) => applyStockDataKeysToScene(s, inp.stockCatalog)).map((s: any) => normalizeScene(s, 0)).filter((s: ExplainerScene) => s.narration);
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
    system: system(inp),
    content: [...inp.refBlocks, { type: 'text', text: task }],
    toolName: 'write_scene',
    toolDescription: '解説動画の場面を1つ作る（または指示どおりに作り直す）。',
    inputSchema: SCENES_SCHEMA,
    maxTokens: 4000,
    signal,
  });
  const raw = Array.isArray(r?.scenes) ? r.scenes[0] : null;
  if (!raw) throw new Error('AIから場面が返りませんでした。');
  const sc = normalizeScene(applyStockDataKeysToScene(raw, inp.stockCatalog), current?.chapter ?? 0);
  return current ? { ...sc, id: current.id, chapter: current.chapter, imageId: current.imageId ?? null } : sc;
}

const NARRATION_SCHEMA = {
  type: 'object',
  properties: {
    narration: { type: 'string', description: 'ナレーション（です・ます調、40〜95文字）' },
    reading: { type: 'string', description: 'narrationをひらがなのみで書いた読み上げ文' },
  },
  required: ['narration', 'reading'],
};

/**
 * スライド（図解・見出し・テロップ）は変えず、ナレーションだけを指示どおりに書き直す（スライドはしっくりくるが、
 * ナレーションの言い回しだけ直したいときに使う）。現在の図解の内容を「変えない前提」としてAIに渡し、
 * 図解と矛盾しない文だけを作らせる。instructionが空なら「別の言い回しを1つ提案する」既定の指示にする。
 */
export async function rewriteNarration(inp: GenerateInput, videoTitle: string, instruction: string, current: ExplainerScene, neighbors: string[], format: 'long' | 'short', signal?: AbortSignal): Promise<{ narration: string; reading: string }> {
  const instr = instruction.trim() || '図解の内容・数値と矛盾しないまま、今とは違う自然な言い回しに書き直してください。';
  const task = [
    header(inp),
    '',
    `動画タイトル：${videoTitle}（${format === 'short' ? '縦型ショート' : '長尺16:9'}）`,
    neighbors.length ? `【前後の場面のナレーション】\n${neighbors.map((n) => `・${n}`).join('\n')}` : '',
    `【この場面の図解（変更しない。ナレーションはこの内容と矛盾しないこと）】${JSON.stringify({ title: current.title, caption: current.caption, visual: current.visual })}`,
    `【現在のナレーション】${current.narration}`,
    `【指示】${instr}`,
    'スライド（図解・見出し・テロップ）は変えず、ナレーションと読み上げ文（reading）だけを書き直してください。',
  ].filter(Boolean).join('\n');
  const r = await callTool<any>({
    system: system(inp),
    content: [...inp.refBlocks, { type: 'text', text: task }],
    toolName: 'rewrite_narration',
    toolDescription: 'スライドは変えずに、解説動画の1場面のナレーションだけを指示どおりに書き直す。',
    inputSchema: NARRATION_SCHEMA,
    maxTokens: 1200,
    signal,
  });
  const narration = typeof r?.narration === 'string' ? r.narration.trim() : '';
  if (!narration) throw new Error('AIから空の応答が返りました。');
  const rd = sanitizeReading(typeof r?.reading === 'string' ? r.reading : '', narration);
  return { narration, reading: rd.reading };
}

export interface GenerateProgress { step: string; done: number; total: number }

/** 目次→章ごと（最初の1章のあとは3並列）→ショート の順に生成し、プロジェクト一式を返す */
export async function generateProject(inp: GenerateInput, onProgress: (p: GenerateProgress) => void, signal?: AbortSignal, withShort = true, withSourcesScene = false): Promise<ExplainerProject> {
  // [Stage E-5] マンネリ防止：切り口は動画1本につき1回だけ選び、目次・各章・ショートの全呼び出しで同じものを使う
  // （章ごとに別の切り口になると構成が散らかるため、ここで固定したinpを以降すべてに渡す）。
  inp = { ...inp, sceneAngle: inp.sceneAngle ?? pickAngle(inp.mode) };
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
