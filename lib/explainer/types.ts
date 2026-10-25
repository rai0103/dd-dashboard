// ニュース・キーワード解説動画（長尺16:9＋宣伝用ショート9:16）の共通型。
// 長尺動画作成（DD戦略ダッシュボード）のアバター・声・BGM・背景はそのまま流用し、
// ここでは「台本（場面・ナレーション・図解の指定）」だけを新たに定義する。
//
// 著作権・肖像権への配慮：図解・イラストはすべてこのアプリ内でCanvasに描く自作の図形・アイコンのみを使い、
// 外部の画像を自動で取得・表示することはしない。写真等を使う場合は、ユーザーが権利を確認した画像を
// 場面ごとに手動で追加する（ImageAsset.rightsConfirmed）。

/** 図解の種類（AIはこの中から1つ選ぶ） */
export const VISUAL_KINDS = [
  'title',        // オープニングの大見出し
  'keyword',      // 用語カード（用語＋読み＋ひとこと定義）
  'points',       // 要点カード（2〜4個・アイコン付き）
  'number',       // 大きな数字（カウントアップ）
  'bar',          // 棒グラフ
  'line',         // 折れ線グラフ（推移）
  'donut',        // 円グラフ（割合）
  'timeline',     // 年表・経緯
  'flow',         // 原因→結果の流れ図
  'compare',      // 2つの比較（A vs B）
  'cycle',        // 循環する関係図
  'illustration', // アイコンを組み合わせたイメージ図
  'image',        // 画像（ユーザーが追加。未追加ならイメージ図で代用）
  'point',        // 大事なポイント（強調テキスト）
  'qa',           // よくある疑問（問い→答え）
  'summary',      // まとめ（チェックリスト）
  'cta',          // 締め（チャンネル登録・本編への誘導）
] as const;
export type VisualKind = typeof VISUAL_KINDS[number] | 'chapter' | 'sources';

/** 自作のアイコン（lib/explainer/icons.ts）。実在の人物・ロゴ・キャラクターは描かない汎用図形のみ */
export const ICON_NAMES = [
  'person', 'group', 'building', 'factory', 'bank', 'government', 'house', 'store',
  'money', 'coin', 'yen', 'dollar', 'chartUp', 'chartDown', 'globe', 'ship', 'plane', 'truck',
  'car', 'oil', 'bolt', 'chip', 'phone', 'computer', 'robot', 'shield', 'lock', 'warning',
  'check', 'cross', 'question', 'bulb', 'document', 'calendar', 'clock', 'scale', 'handshake',
  'leaf', 'fire', 'water', 'medical', 'food', 'target', 'rocket', 'search', 'megaphone',
  'battery', 'arrowUp', 'arrowDown', 'flag', 'star', 'heart', 'school', 'news',
] as const;
export type IconName = typeof ICON_NAMES[number];

export interface VisualItem {
  label: string;
  /** 数値（グラフ・数字用）。文字列で受け取り、数値に直せないものはグラフでは使わない */
  value: string;
  /** 補足の文（要点・年表の出来事・比較の箇条書き（改行区切り）など） */
  text: string;
  icon: IconName;
}

export interface VisualSpec {
  kind: VisualKind;
  heading: string;
  subheading: string;
  items: VisualItem[];
  /** 数値の単位（%・兆円・万人 など） */
  unit: string;
  /** 数値・事実の出典（参考資料名など。数値を使う場面は必須） */
  source: string;
  /** 強調したいひとこと（大きく表示） */
  emphasis: string;
  /** 画像を自分で用意する場合の生成AI用プロンプト案（実在の人物・ロゴ・既存作品を含めない） */
  imagePrompt: string;
}

export interface ExplainerScene {
  id: string;
  /** 構成リストに出す短い名前 */
  title: string;
  /** 画面下のテロップ用の短い要点 */
  caption: string;
  /** ナレーション（通常の日本語。字幕にも使う） */
  narration: string;
  /** 読み上げ用（ひらがな・句読点のみ）。音声合成はこちらで行う */
  reading: string;
  visual: VisualSpec;
  /** 章番号（目次バー用。オープニング=0） */
  chapter: number;
  /** 映像として最低限必要な秒数（ナレーションが長ければそちらに合わせて伸びる） */
  minSec: number;
  /** ユーザーが追加した画像（ImageAssetのid） */
  imageId?: string | null;
  /** ナレーションを手で直したあと、読み上げ文がまだ合わせられていない（このあいだは通常の文で読み上げる） */
  readingStale?: boolean;
}

export interface ChapterPlan {
  title: string;
  reading: string;
  role: 'intro' | 'body' | 'outro';
  goal: string;
  keyPoints: string;
  sceneCount: number;
}

export interface YoutubeMeta {
  title: string;
  description: string;
  tags: string[];
  thumbnailText: string;
  shortTitle: string;
  shortDescription: string;
}

export interface SourceNote { title: string; detail: string }

export interface ExplainerProject {
  version: 1;
  topic: string;
  mode: 'news' | 'keyword';
  audience: 'beginner' | 'general' | 'advanced';
  targetMinutes: number;
  videoTitle: string;
  kicker: string;
  chapters: ChapterPlan[];
  longScenes: ExplainerScene[];
  shortScenes: ExplainerScene[];
  youtube: YoutubeMeta;
  sources: SourceNote[];
  createdAt: number;
}

// ---- 参考情報 ----
export type ReferenceItem =
  | { id: string; kind: 'text'; title: string; text: string }
  | { id: string; kind: 'url'; url: string; title: string; text: string; status: 'pending' | 'ok' | 'error'; error?: string; pdfBase64?: string; note?: string }
  | { id: string; kind: 'pdf'; title: string; base64: string; sizeBytes: number };

export interface ImageAsset { id: string; name: string; blob: Blob; rightsConfirmed: boolean; createdAt: number }

export const emptyVisual = (kind: VisualKind = 'point'): VisualSpec => ({
  kind, heading: '', subheading: '', items: [], unit: '', source: '', emphasis: '', imagePrompt: '',
});
