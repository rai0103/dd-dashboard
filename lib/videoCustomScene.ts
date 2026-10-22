// [新規] 長尺動画作成：自由記述プロンプトによるカスタム場面の生成（Stage D-4）。
// AIには「どのデータ系列を使うか（存在する系列キーのみ）」「ラベル」「ナレーション文（ひらがな）」という
// 構造化された範囲でのみ出力させ、コードや任意の描画命令を生成させることは一切しない
// （lib/videoAiClient.ts 参照。呼び出し側がさらにキーの存在を検証する）。
import { StockDataPoint } from './videoTypes';
import { yearPath, valueAt } from './videoLongBasis';
import { presidentialTermYear } from './yearCompare';

export interface SeriesCatalogEntry {
  label: string;
  pts: { t: number; v: number }[];
}
export type SeriesCatalog = Record<string, SeriesCatalogEntry>;

/** 複数年の{t,v}[]を同じtグリッド（0〜1、201点）で平均する（videoLongAnalysisRendererのbasis10シーンの平均折れ線と同じ考え方） */
function averagePaths(paths: { t: number; v: number }[][]): { t: number; v: number }[] {
  if (!paths.length) return [];
  const grid: number[] = [];
  for (let k = 0; k <= 200; k++) grid.push(k / 200);
  return grid.map((t) => ({ t, v: paths.reduce((acc, pts) => acc + valueAt(pts, t), 0) / paths.length }));
}

/**
 * グラフ化できる named series の辞書を作る。
 * - curYear：今年の推移（前年末=100、asOfDateまで）
 * - cyclePos1〜cyclePos4：大統領任期1〜4年目（4＝選挙年、2＝中間選挙年）それぞれの、確定年（今年より前）の平均推移
 * - recent5/10/15/20：直近N年の平均推移
 * - allYears：全確定年の平均推移
 * - y{YYYY}：個別の確定年の推移
 */
export function buildSeriesCatalog(daily: StockDataPoint[], curYear: number, asOfDate: string): SeriesCatalog {
  const catalog: SeriesCatalog = {};
  if (!daily.length) return catalog;

  const years: number[] = [];
  for (const d of daily) {
    const y = parseInt(d.date.slice(0, 4), 10);
    if (y < curYear && !years.includes(y)) years.push(y);
  }
  years.sort((a, b) => a - b);
  const pathsByYear = new Map<number, { t: number; v: number }[]>();
  for (const y of years) {
    const pts = yearPath(daily, y);
    if (pts.length > 20) pathsByYear.set(y, pts);
  }
  const confirmedYears = [...pathsByYear.keys()].sort((a, b) => a - b);

  catalog.curYear = { label: `${curYear}年（今年）`, pts: yearPath(daily, curYear, asOfDate) };

  const CYCLE_LABEL: Record<1 | 2 | 3 | 4, string> = { 1: '任期1年目の平均', 2: '中間選挙年の平均', 3: '任期3年目の平均', 4: '大統領選挙年の平均' };
  ([1, 2, 3, 4] as const).forEach((pos) => {
    const ys = confirmedYears.filter((y) => presidentialTermYear(y) === pos);
    if (ys.length) catalog[`cyclePos${pos}`] = { label: CYCLE_LABEL[pos], pts: averagePaths(ys.map((y) => pathsByYear.get(y)!)) };
  });

  [5, 10, 15, 20].forEach((n) => {
    const ys = confirmedYears.slice(-n);
    if (ys.length) catalog[`recent${n}`] = { label: `直近${ys.length}年平均`, pts: averagePaths(ys.map((y) => pathsByYear.get(y)!)) };
  });

  if (confirmedYears.length) catalog.allYears = { label: `全期間（${confirmedYears.length}年）平均`, pts: averagePaths(confirmedYears.map((y) => pathsByYear.get(y)!)) };

  confirmedYears.forEach((y) => { catalog[`y${y}`] = { label: `${y}年`, pts: pathsByYear.get(y)! }; });

  return catalog;
}

/** AIのtoolスキーマに渡す、利用可能な系列キーの一覧（ラベル付き） */
export function catalogKeyOptions(catalog: SeriesCatalog): { key: string; label: string }[] {
  return Object.entries(catalog).map(([key, v]) => ({ key, label: v.label }));
}

export interface CustomSceneSeriesSpec {
  key: string;
  label: string;
  style: 'solid' | 'dashed';
  emphasis: boolean;
}

export interface CustomSceneSpec {
  id: string; // `custom:${uuid}` 形式
  title: string;
  subtitle: string;
  series: CustomSceneSeriesSpec[];
  yUnit: 'index' | 'pct';
  reading: string;   // ひらがなのみのナレーション文
  caption: string;   // 字幕用の短い要点
  minSec: number;
  sourcePrompt: string; // 「記憶する」で保存する元の指示文
}

export interface ResolvedCustomSceneSeries extends CustomSceneSeriesSpec {
  pts: { t: number; v: number }[];
  rgb: string;
}

export interface ResolvedCustomScene {
  id: string;
  title: string;
  subtitle: string;
  series: ResolvedCustomSceneSeries[];
  yUnit: 'index' | 'pct';
}

const PALETTE = ['46,230,184', '255,190,80', '90,169,255', '255,107,107', '200,210,225', '186,104,255'];

/** CustomSceneSpecのseries[].keyを、実際の系列データ（catalog）に解決する。存在しないキーは除外する（事前検証はAI呼び出し側で行う） */
export function resolveCustomScene(spec: CustomSceneSpec, catalog: SeriesCatalog): ResolvedCustomScene {
  const series: ResolvedCustomSceneSeries[] = spec.series
    .filter((s) => catalog[s.key])
    .map((s, i) => ({ ...s, pts: catalog[s.key].pts, rgb: PALETTE[i % PALETTE.length] }));
  return { id: spec.id, title: spec.title, subtitle: spec.subtitle, series, yUnit: spec.yUnit };
}
