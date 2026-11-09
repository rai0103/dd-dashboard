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
  // [Stage E-9] 株式情報モードのみ使う。ダッシュボードの「年比較」グラフ（複数年の値動きを同じ年内日数で重ねる）を
  // そのまま動画内に再現する。実データはStockCatalog.yearCompareから解決する（lib/explainer/stockCatalog.tsのresolveYearCompareItems）。
  'yearCompare',  // 年比較グラフ（複数年の推移を重ねて比較）
  // [Stage E-10] 投資情報・SP500分析モード向けの強化図解。既存の棒グラフ・折れ線等では再現できない、
  // ダッシュボードならではの分析チャートをそのまま動画に持ち込むために追加。このモードのAI台本生成
  // （lib/explainer/aiScript.ts）には渡さず、lib/explainer/に置く固定場面ビルダー（accelIntroSceneなど）
  // からのみ使う想定（数値をAIに作文させない既存の方針を踏襲）。
  'branch',       // 分岐図：ある時点までの実績パス→そこから分かれる複数の結末（結末ごとの統計パネル付き）
  'histogram',    // 区間ヒストグラム：間隔・幅などの分布を区間ごとの棒で示し、現在の区間を強調できる
  'distribution', // 分布（ビーズウォーム）：カテゴリごとの個別サンプルを1点1点のドットで示し、平均を併記する
  // [Stage E-13] 同上の理由で追加。カテゴリ（例：下落幅の区分）ごとに複数系列（例：翌営業日・20営業日後）を
  // 並べて比較したいときに使う（既存の'bar'は1カテゴリ1系列のみ）。
  'groupedBar',   // グループ棒グラフ：同じカテゴリ内で複数系列を並べて比較する
  // [Stage E-16] S&P500動画（モックアップ25枚）の固定場面専用。AIの台本生成には渡さない（FIXED_ONLY_KINDS）。
  'fan',          // 重ね描き＋レンジ帯：過去の各局面・各年の推移を細線で重ね、中央値・今年・レンジ帯を強調する
  'zoomLine',     // 年初来の折れ線→直近数営業日へズームして日々の騰落率を示す
  'butterfly',    // バタフライ：左右に上昇日・下落日の数を伸ばして複数の行（今年・平均など）を比べる
  'ddHistory',    // 全期間のドローダウン推移（主な暴落にラベル、到達水準の横線）
] as const;
/** [Stage E-16] 固定場面ビルダーだけが使う図解（専用の仕様データが必要なため、AIには選ばせない） */
export const FIXED_ONLY_KINDS: readonly string[] = ['fan', 'zoomLine', 'butterfly', 'ddHistory'];
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
  // [Stage E-9] yearCompareのみ使う：複数の系列（線）を1つのitems配列にまとめて持たせるための追加情報。
  // 同じseriesKeyの点を発生順につないで1本の線にする。xは系列間で揃えた横軸の実数位置（年比較＝年初からの経過日数）。
  /** 横軸の実数位置（系列間で共通の軸に揃える。例：年初からの経過日数） */
  x?: number;
  /** この点が属する系列のキー（例：yearCompareのカタログキー） */
  seriesKey?: string;
  /** この点が属する系列の表示名（凡例用） */
  seriesLabel?: string;
  /** 強調する系列（例：今年）かどうか */
  seriesEmphasis?: boolean;
  // [Stage E-10] yearCompare（drawOverlay）向けの追加オプション。
  /** この系列を「注意を引く参考事例」として着色する（例：2008年リーマンショックの系列を赤系で目立たせる）。
   * seriesEmphasisの強調系列とは別に、背景系列の中の1本だけを目立たせたい場合に使う */
  seriesTone?: 'warn';
  /** このデータ点に添える短い注釈（例：「11/5 現在」「3年後」）。該当する点にだけ丸印＋ラベルを出す */
  markerLabel?: string;
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
  // [Stage E-10] kind:'branch'・'distribution'のときだけ使う。他のkindではundefinedのままでよい
  // （AIには渡さない固定場面専用の図解なので、他のkind用の生成コードに影響しない）。
  branch?: BranchSpec;
  distribution?: DistributionSpec;
  // [Stage E-16] 固定場面専用の仕様データ（kindに対応するものだけ入る）
  fan?: FanSpec;
  zoomLine?: ZoomLineSpec;
  butterfly?: ButterflySpec;
  ddHistory?: DdHistorySpec;
  /** kind:'title'の背景にうっすら描く推移（例：全期間の指数の対数値） */
  background?: { x: number; y: number }[];
  /** kind:'title'の下部に小さく出す注意書き */
  titleNote?: string;
  /** histogram・groupedBar等の見出しの下に並べる数値チップ（任意） */
  chips?: { label: string; value: string; role?: FanRole }[];
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
  /** [Stage E-17] 台本生成の時点で自動生成されたナレーション（制作者の直しを記憶するときの「直す前」） */
  genNarration?: string;
  /** [Stage E-17] 実データの固定場面の識別子（例：fixed:DD速度センサー）。直しを次回の同じ場面に当てはめるのに使う */
  fixedKey?: string;
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
  mode: 'news' | 'stock' | 'sp500' | 'keyword';
  audience: 'beginner' | 'general' | 'advanced' | 'expert';
  targetMinutes: number;
  videoTitle: string;
  kicker: string;
  chapters: ChapterPlan[];
  longScenes: ExplainerScene[];
  shortScenes: ExplainerScene[];
  youtube: YoutubeMeta;
  sources: SourceNote[];
  /** 動画に出てくる用語と、初めて出てきたときに添える短い説明（目次の生成時にAIが作る。ショートの作り直しにも使う） */
  glossary?: GlossTerm[];
  createdAt: number;
}

/** 用語の説明：初出のナレーションで「gloss＋の＋term」（例：低軌道衛星を使ったインターネット通信サービスのスターリンク） */
export interface GlossTerm { term: string; termReading?: string; gloss: string; glossReading?: string; chapter?: number }

// ---- 参考情報 ----
// [Stage E-7] どの参考情報にも共通で持たせる「必ず動画に含める」フラグ。trueのものは、AIへの指示
// （lib/explainer/aiScript.tsのheader()）で名指しして、省略せず実際に扱うよう強制する。
interface ReferenceItemBase { id: string; required?: boolean }
export type ReferenceItem =
  | (ReferenceItemBase & { kind: 'text'; title: string; text: string })
  | (ReferenceItemBase & { kind: 'url'; url: string; title: string; text: string; status: 'pending' | 'ok' | 'error'; error?: string; pdfBase64?: string; note?: string })
  | (ReferenceItemBase & { kind: 'pdf'; title: string; base64: string; sizeBytes: number })
  // [Stage E-3] 株式情報モード：株価CSV（Date/Close列。lib/csvPrice.tsのparseStooqCSVと同じ形式）をそのまま原文で保持する
  | (ReferenceItemBase & { kind: 'csv'; title: string; text: string; sizeBytes: number })
  // [Stage E-3] ニュース・株式情報どちらのモードでも使えるスクリーンショット参照（画像としてAIに渡す）
  | (ReferenceItemBase & { kind: 'image'; title: string; base64: string; mediaType: string; sizeBytes: number });

/** フリー素材（「フリー素材を検索」で取り込んだ画像）の出典。概要欄のクレジット表記に使う */
export interface ImageCredit { source: string; caption?: string; credit?: string; pageUrl?: string }
export interface ImageAsset { id: string; name: string; blob: Blob; rightsConfirmed: boolean; createdAt: number; /** どんな画像か（銘柄・期間・グラフの内容など）の短い説明。グラフ作成ページが自動で付ける（任意） */ caption?: string; /** フリー素材の出典（任意） */ credit?: ImageCredit }

// [Stage E-4] 株式情報モード：台本生成に実数を保証して渡すためのデータカタログ。
// scalars＝1時点の数値（前日比・年初来騰落率など）、series＝複数時点の推移（折れ線用）。
// value は常に数値のまま保持し、文字列化（単位付け）はaiScript.tsのapplyStockDataKeysが行う。
// [動画連携] ダッシュボードの加速度センサー（lib/accelSensor.tsのsummarizeAccelForVideo）が書き出す要約と
// 同じ形。AIには渡さず、lib/explainer/accelIntroScene.tsが固定場面を組み立てるためだけに使う
// （数値をAIに作文させず、ダッシュボードの実データをそのまま場面にする既存の方針を踏襲）。
export interface AccelRateSummary { threshold: number; hits: number; p: number | null }
export interface AccelBucketSummary { label: string; min: number; max: number | null; n: number; lowSample: boolean; rates: AccelRateSummary[] }
export interface AccelSummary {
  periodStart: string | null; periodEnd: string | null; periodYears: number;
  episodeCount: number; judgedCount: number; judgedRate: number | null;
  overall: { n: number; lowSample: boolean; rates: AccelRateSummary[] };
  buckets: AccelBucketSummary[];
  accMedian: number | null;
  current: {
    status: 'normal' | 'over3' | 'reached5'; currentDD: number | null; startDate: string | null;
    elapsedDays: number | null; acc: number | null; maxDD: number | null; bucketLabel: string | null;
  } | null;
}

export interface StockCatalog {
  instrumentLabel: string;
  asOf: string;
  scalars: Record<string, { label: string; value: number }>;
  series: Record<string, { label: string; points: { label: string; value: number }[] }>;
  // [Stage E-9] 「年比較グラフ」専用のカタログ。seriesは個別の年・平均などの系列（lib/videoCustomScene.tsの
  // buildSeriesCatalogと同じ材料だが、こちらはダウンサンプルせず年内の実際の日数(x)をそのまま持つ＝
  // 長さの異なる系列同士を正しい横軸位置で重ねて描けるようにするため）。
  yearCompare?: {
    xLabel: string;
    unit: string;
    series: Record<string, { label: string; emphasis: boolean; points: { x: number; value: number }[] }>;
  };
  // [動画連携] ダッシュボードの加速度センサー（lib/accelSensor.ts）の要約。未対応の銘柄・未計算のときはundefined。
  accel?: AccelSummary;
  // [動画連携][Stage E-11] 最高値更新ペース（lib/accelSensor.tsのsummarizeAthPaceForVideo）の要約。
  // 未対応の銘柄・未計算のときはundefined。
  athPace?: AthPaceSummary;
  // [動画連携][Stage E-12] 保有期間別ローリングリターン（lib/rollingReturn.tsのsummarizeRollingReturnsForVideo）
  // の要約。未対応の銘柄・未計算のときはundefined。
  rollingReturns?: RollingReturnSummary;
  // [動画連携][Stage E-13] 1日の騰落率の区分別「その後」（lib/dailyMoveBuckets.tsのsummarizeDailyMoveBucketsForVideo）
  // の要約（下落日のみ）。未対応の銘柄・未計算のときはundefined。
  dailyMoveDown?: DailyMoveBucketSummary;
  // [動画連携][Stage E-14] 類似局面サーチ（lib/analogFinder.tsのfindHistoricalAnalogs）の結果。
  // 未対応の銘柄・履歴不足のときはundefined。
  analogFinder?: AnalogFinderSummary;
}

// [動画連携][Stage E-14] 類似局面サーチ（lib/analogFinder.tsのfindHistoricalAnalogs）が返す結果と同じ形。
// AIには渡さず、ダッシュボードのUIカードと、lib/explainer/に置く固定場面ビルダーの両方から使う。
export interface AnalogFunnelStepSummary { label: string; lookbackDays: number; targetPct: number; remaining: number }
export interface AnalogMatchSummary {
  idx: number; date: string; checkpointPct: number[]; distance: number;
  forward: { date: string; pct: number }[];
}
export interface AnalogFinderSummary {
  asOfDate: string | null;
  checkpointTargets: { label: string; lookbackDays: number; targetPct: number }[];
  funnel: AnalogFunnelStepSummary[];
  matches: AnalogMatchSummary[];
  /** matchesが満たしている基準点の数（全段一致しない場合は1件以上残った最も深い段まで）。古い書き出しには無い */
  matchedSteps?: number;
  currentPath: { x: number; pct: number }[];
}

// [動画連携][Stage E-13] 1日の騰落率の区分別「その後」（lib/dailyMoveBuckets.tsのsummarizeDailyMoveBucketsForVideo）
// が書き出す要約と同じ形。AIには渡さず、lib/explainer/に置く固定場面ビルダーが'groupedBar'の場面を
// 組み立てるためだけに使う。
export interface MoveHorizonStatsSummary { horizonDays: number; n: number; mean: number | null; median: number | null; winRate: number | null }
export interface MoveBucketStatsSummary { label: string; min: number; max: number | null; n: number; perYear: number; horizons: MoveHorizonStatsSummary[] }
export interface DailyMoveBucketSummary {
  periodStart: string | null; periodEnd: string | null; periodYears: number;
  direction: 'down' | 'up';
  buckets: MoveBucketStatsSummary[];
}

// [動画連携][Stage E-12] 保有期間別ローリングリターン（lib/rollingReturn.tsのsummarizeRollingReturnsForVideo）が
// 書き出す要約と同じ形。AIには渡さず、lib/explainer/に置く固定場面ビルダーが'distribution'の場面を
// 組み立てるためだけに使う。
export interface RollingReturnGroupSummary {
  label: string; tradingDays: number; samples: number[]; n: number;
  winRate: number | null; mean: number | null; median: number | null;
}
export interface RollingReturnSummary {
  periodStart: string | null; periodEnd: string | null; periodYears: number;
  groups: RollingReturnGroupSummary[];
}

// [動画連携][Stage E-11] 最高値更新ペース（lib/accelSensor.tsのsummarizeAthPaceForVideo）が書き出す要約と同じ形。
// AIには渡さず、lib/explainer/に置く固定場面ビルダーが'histogram'の場面を組み立てるためだけに使う。
export interface AthPaceBinSummary { label: string; min: number; max: number | null; count: number }
export interface AthPaceSummary {
  periodStart: string | null; periodEnd: string | null; periodYears: number;
  updateCount: number;
  avgIntervalDays: number | null; medianIntervalDays: number | null;
  bins: AthPaceBinSummary[];
  currentElapsedDays: number;
  currentBinIndex: number | null;
}

// [Stage E-10] 'branch'専用：ある時点（分岐点）までの実績パスと、そこから分かれる複数の結末。
export interface BranchPoint { x: number; n: number }
export interface BranchOutcome {
  key: string;
  /** 分岐の結末ラベル（例：「新高値を回復」「さらに下落」） */
  label: string;
  /** 色味（up=良い方向＝テール、down=悪い方向＝ラスト） */
  tone: 'up' | 'down';
  /** 分岐後の経路（先頭は分岐点と同じ座標にする） */
  path: BranchPoint[];
  /** 結末ごとの統計パネル（見出し＋複数行の説明） */
  stat?: { title: string; lines: string[] };
}
export interface BranchSpec {
  /** 分岐点までの実績パス（白い太線で表示） */
  lead: BranchPoint[];
  outcomes: BranchOutcome[];
  /** 横軸・縦軸の単位（任意） */
  xLabel?: string;
  unit?: string;
  /** 分岐の基準線（例：「-3%（分岐の起点）」）を横線で添える場合のy値とラベル */
  thresholdY?: number;
  thresholdLabel?: string;
}

// [Stage E-10] 'distribution'専用：カテゴリごとの個別サンプル値（ビーズウォーム表示に使う）。
export interface DistributionGroup { label: string; samples: number[]; mean?: number }
export interface DistributionSpec { groups: DistributionGroup[]; unit?: string; logScale?: boolean }

export const emptyVisual = (kind: VisualKind = 'point'): VisualSpec => ({
  kind, heading: '', subheading: '', items: [], unit: '', source: '', emphasis: '', imagePrompt: '',
});

// [Stage E-16] 'fan'専用：系列（role=bg は細い白線で背景、focus=アクセント色の太線、median=黄、avg=青、warn=赤）、
// レンジ帯（lo〜hi）、注釈の丸印、横軸の目盛り、「現在」の縦線、基準の横線、数値チップ。
export type FanRole = 'bg' | 'focus' | 'median' | 'avg' | 'warn' | 'lead'; // lead＝白の太線（実績線）
export interface FanSeries { key: string; label: string; role: FanRole; points: { x: number; y: number }[]; endLabel?: string; /** 点線で描く（例：予測の上限・平均・下限） */ dash?: boolean }
export interface FanSpec {
  series: FanSeries[];
  band?: { label: string; points: { x: number; lo: number; hi: number }[] };
  markers?: { x: number; y: number; label: string; role?: FanRole }[];
  xTicks?: { x: number; label: string }[];
  /** 自動の目盛りに付ける単位（例：営業日） */
  xUnit?: string;
  yUnit?: string;
  nowX?: number; nowLabel?: string;
  hLines?: { y: number; label: string }[];
  chips?: { label: string; value: string; role?: FanRole }[];
  /** 背景の細線の凡例（例：「各年（67本）」） */
  bgLegend?: string;
  /** 縦軸の範囲を、背景の細線は3〜97%の範囲だけで決める（外れ値で他の線がつぶれないように） */
  clipBg?: boolean;
  /** グラフ内に添える補足（最大3行）。notePos='bottom'なら左下 */
  note?: string;
  notePos?: 'top' | 'bottom';
  /** x≧fromXを「予測」として赤枠で囲む */
  predictBox?: { fromX: number; label: string };
}
// [Stage E-16] 'zoomLine'専用：年初来の推移（%）→ points[zoomFrom..]の区間へズームし、各日の騰落率を表示する。
export interface ZoomLineSpec {
  points: { label: string; y: number }[];
  zoomFrom: number;
  zoomDays: { label: string; dayPct: number }[];
  yUnit: string;
  zoomTitle: string;
  chips: { label: string; value: string; role?: FanRole }[];
}
// [Stage E-16] 'butterfly'専用：左（下落日）・右（上昇日）に棒を伸ばして行どうしを比べる。
export interface ButterflySpec {
  leftLabel: string; rightLabel: string;
  rows: { label: string; left: number; right: number; leftSub: string; rightSub: string; emphasis?: boolean }[];
  note?: string;
}
// [Stage E-16] 'ddHistory'専用：全期間のドローダウン（%）と主な暴落のラベル、到達水準の横線、最長の回復期間の帯。
export interface DdHistorySpec {
  points: { x: number; y: number }[];
  labels: { x: number; y: number; label: string }[];
  hLines: { y: number; label: string }[];
  highlight?: { from: number; to: number; label: string };
  highlights?: { from: number; to: number; label: string }[];
}
