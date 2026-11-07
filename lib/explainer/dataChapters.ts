// [Stage E-15] 「株式情報」「S&P500」モードの本編に入れる、実データの固定章（モックアップの章立てに沿う）。
// これまでは固定場面を動画の先頭（AIが作る導入章＝「つかみ」の章）にまとめて差し込んでいたため、
// ①画面上部の章タイトルが「つかみ：…」のまま固定場面が流れる、②AIが作る一般論の章が本編の大半を占め、
// ダッシュボードの分析（速度センサー・ローリングリターン等）が埋もれる、という問題があった。
// ここでは固定場面を内容ごとの章（ChapterPlan＋場面）にまとめ、ExplainerStudio側で導入章の直後に挿入する。
import type { ChapterPlan, ExplainerScene } from './types';
import { buildStockIntroScenes } from './stockIntroScenes';
import { buildAccelScenes } from './accelIntroScene';
import { buildAthPaceScene } from './athPaceScene';
import { buildRollingReturnScene } from './rollingReturnScene';
import { buildDailyMoveScene } from './dailyMoveScene';
import { buildAnalogScene } from './analogScene';

export interface FixedDataChapter { plan: ChapterPlan; scenes: ExplainerScene[] }

const plan = (title: string, reading: string, goal: string): ChapterPlan => ({ title, reading, role: 'body', goal, keyPoints: '', sceneCount: 0 });

/** スナップショット（stock-catalog:SP500等をJSON.parseしたもの）から、データの期間（年数と開始・終了年月）を読む */
export function dataPeriodOf(snapshot: any): { years: number; start: string; end: string } | null {
  const src = snapshot?.athPace ?? snapshot?.rollingReturns ?? snapshot?.accel;
  const start = String(src?.periodStart ?? ''), end = String(src?.periodEnd ?? snapshot?.asOf ?? '');
  const years = Number(src?.periodYears ?? snapshot?.finalReach?.totalYears);
  if (!start || !end || !Number.isFinite(years) || years <= 0) return null;
  return { years: Math.round(years), start, end };
}

/** 「1957年3月〜2026年11月（約70年・日次終値）」の形の説明 */
export function dataPeriodNoteOf(snapshot: any, instrumentLabel: string): string | null {
  const p = dataPeriodOf(snapshot);
  if (!p) return null;
  const ym = (iso: string) => `${iso.slice(0, 4)}年${Number(iso.slice(5, 7))}月`;
  return `${instrumentLabel}：${ym(p.start)}〜${ym(p.end)}（約${p.years}年・日次終値）`;
}

export function buildFixedDataChapters(snapshot: any, instrumentLabel = 'S&P500'): FixedDataChapter[] {
  if (!snapshot) return [];
  const out: FixedDataChapter[] = [];
  const push = (p: ChapterPlan, scenes: (ExplainerScene | null | undefined)[]) => {
    const list = scenes.filter((s): s is ExplainerScene => !!s);
    if (list.length) out.push({ plan: { ...p, sceneCount: list.length }, scenes: list });
  };
  push(plan('前提とドローダウンの基本', 'ぜんていと、どろーだうんの、きほん', 'データの前提と、下落（DD）の発生回数・深さの分布'),
    buildStockIntroScenes(snapshot.finalReach ?? null, instrumentLabel));
  push(plan('DD速度センサー：下落の深まり方', 'でぃーでぃー、そくどせんさー、げらくの、ふかまりかた', '下落の速さ別のその後と、1日の大幅下落のその後'),
    [...buildAccelScenes(snapshot.accel ?? null, instrumentLabel), buildDailyMoveScene(snapshot.dailyMoveDown ?? null, instrumentLabel)]);
  push(plan('保有期間で変わる勝率', 'ほゆうきかんで、かわる、しょうりつ', '保有期間ごとのリターンの分布と勝率'),
    [buildRollingReturnScene(snapshot.rollingReturns ?? null, instrumentLabel)]);
  push(plan('最高値更新のペース', 'さいたかねこうしんの、ぺーす', '最高値を更新する間隔の分布と、現在の位置'),
    [buildAthPaceScene(snapshot.athPace ?? null, instrumentLabel)]);
  push(plan('似た値動きの局面とその後', 'にた、ねうごきの、きょくめんと、そのご', '直近の値動きが似ていた過去の局面と、その後の値動き'),
    [buildAnalogScene(snapshot.analogFinder ?? null, instrumentLabel)]);
  return out;
}

/** AIに渡す「アプリが挿入するデータ章」の説明文 */
export function fixedChaptersNote(chapters: FixedDataChapter[]): string {
  return chapters.map((c, i) => `${i + 1}. ${c.plan.title}：${c.scenes.map((s) => s.caption || s.title).join('／')}`).join('\n');
}

/**
 * AIが作った章（導入・本編・まとめ）の間に、固定のデータ章を差し込む。導入章（role=intro）の直後に入れ、
 * 章の扉・章番号はscriptModel.assembleLongで振り直す前提で、章ごとの場面配列（扉・参考資料の場面は除く）を返す。
 */
export function mergeFixedChapters(aiChapters: ChapterPlan[], aiScenes: ExplainerScene[], fixed: FixedDataChapter[]): { chapters: ChapterPlan[]; perChapter: ExplainerScene[][] } {
  const perAi = aiChapters.map((_, i) => aiScenes.filter((s) => s.chapter === i && s.visual.kind !== 'chapter' && s.visual.kind !== 'sources'));
  const introIdx = aiChapters.findIndex((c) => c.role === 'intro');
  const pos = introIdx >= 0 ? introIdx + 1 : 0;
  return {
    chapters: [...aiChapters.slice(0, pos), ...fixed.map((f) => f.plan), ...aiChapters.slice(pos)],
    perChapter: [...perAi.slice(0, pos), ...fixed.map((f) => f.scenes), ...perAi.slice(pos)],
  };
}
