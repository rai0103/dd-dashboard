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
import { buildSheetScenes } from './sp500SheetScenes';
import { kanaizeReading } from './readingUtil';
import type { Sp500Sheets } from '../sp500Sheets';

/** position：afterIntro＝AIの導入章の直後（既定）、beforeOutro＝AIのまとめ章の直前 */
export interface FixedDataChapter { plan: ChapterPlan; scenes: ExplainerScene[]; position?: 'afterIntro' | 'beforeOutro' }
/** [Stage E-16] 日次終値から計算したS&P500のシート（lib/sp500Sheets.ts）と、その元の日次終値 */
export interface SheetInput { sheets: Sp500Sheets | null; points: { date: string | Date; close?: number | null; price?: number | null }[] | null }

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

/**
 * モックアップ（25枚）の章立ての順に、実データの固定章を組み立てる。sheet（日次終値から計算したS&P500のシート）は
 * S&P500のときだけ渡す（無ければ、その章・場面は省く）。
 */
export function buildFixedDataChapters(snapshot: any, instrumentLabel = 'S&P500', sheet?: SheetInput | null): FixedDataChapter[] {
  if (!snapshot) return [];
  const out: FixedDataChapter[] = [];
  const push = (p: ChapterPlan, scenes: (ExplainerScene | null | undefined)[], position: FixedDataChapter['position'] = 'afterIntro') => {
    const list = scenes.filter((s): s is ExplainerScene => !!s).map((s) => ({ ...s, reading: kanaizeReading(s.reading), fixedKey: `fixed:${s.title}` }));
    if (list.length) out.push({ plan: { ...p, sceneCount: list.length }, scenes: list, position });
  };
  const sh = sheet?.sheets ? buildSheetScenes(sheet.sheets, sheet.points, instrumentLabel) : null;
  const accel = buildAccelScenes(snapshot.accel ?? null, instrumentLabel);
  // 2〜3（前提条件・DDの定義）
  // 3枚目（DDの定義）は実例のチャート（sheetがあるとき）。無ければ従来の「谷間」の概念図
  const intro = buildStockIntroScenes(snapshot.finalReach ?? null, instrumentLabel);
  const introFirst = intro[0], introRest = intro.slice(1).filter((s) => !(sh?.ddDefinition && s.title === '「谷間」の考え方'));
  push(plan('前提とドローダウンの基本', 'ぜんていと、どろーだうんの、きほん', 'データの前提、DD（ドローダウン）の定義、下落の発生回数・深さの分布'),
    [introFirst, sh?.ddDefinition, ...introRest]);
  // 4〜6（現在の状況）
  push(plan('現在の状況', 'げんざいの、じょうきょう', '年初来の値動き・直近の値動き・上昇日と下落日の数'), [sh?.zoom, sh?.upDown]);
  // 7〜10（DD速度センサー）
  push(plan('DD速度センサー：下落の深まり方', 'でぃーでぃー、そくどせんさー、げらくの、ふかまりかた', '下落の速さ別のその後・過去の局面との重ね描き・分岐・1日の大幅下落のその後'),
    [accel[0], sh?.ddOverlay, ...(sh?.branch ? [sh.branch] : accel.slice(1)), sh?.dropDay ?? buildDailyMoveScene(snapshot.dailyMoveDown ?? null, instrumentLabel)]);
  // 11（中期ローリングリターン）
  push(plan('保有期間で変わる勝率', 'ほゆうきかんで、かわる、しょうりつ', '1ヶ月〜1年の保有期間ごとのリターンの分布と勝率'),
    [buildRollingReturnScene(snapshot.rollingReturns ?? null, instrumentLabel)]);
  // 12（最高値更新ペース）
  push(plan('最高値更新のペース', 'さいたかねこうしんの、ぺーす', '最高値を更新する間隔の分布と、現在の位置'),
    [sh?.athPace ?? buildAthPaceScene(snapshot.athPace ?? null, instrumentLabel)]);
  // 13（暴落発生確率）
  push(plan('暴落の歴史', 'ぼうらくの、れきし', '全期間の下落率の推移と主な暴落、各水準に到達した年の割合'), [sh?.ddHistory]);
  // 14（現在地点からの深掘り）
  push(plan('現在地点からの深掘り', 'げんざいちてんからの、ふかぼり', '似た状態だった日の、その後の3つのパターン'), [sh?.athZone]);
  // 15（長期ローリングリターン）
  push(plan('長期で見ると', 'ちょうきで、みると', '5〜30年の保有期間ごとの年率リターンと勝率'), [sh?.longRolling]);
  // 16（年初来パス比較）
  push(plan('今年の値動きは強い？弱い？', 'ことしの、ねうごきは、つよい、よわい', '過去の各年の年初来の推移と比べた今年の位置'), [sh?.ytdPaths]);
  // 17〜23（将来シナリオ）＋類似局面サーチ
  push(plan('将来シナリオ', 'しょうらい、しなりお', '条件が似た過去の年・局面の、その後の値動き'),
    [...(sh?.scenarios ?? []), buildAnalogScene(snapshot.analogFinder ?? null, instrumentLabel)]);
  // 24〜25（まとめの事実・免責事項）はAIのまとめ章の直前
  push(plan('データで分かったこと', 'でーたで、わかったこと', '全期間のデータで分かった事実と、予測についての注意'), [sh?.facts, sh?.disclaimer], 'beforeOutro');
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
  const outroIdx = aiChapters.findIndex((c, i) => i >= pos && c.role === 'outro');
  const pos2 = outroIdx >= 0 ? outroIdx : aiChapters.length;
  const early = fixed.filter((f) => f.position !== 'beforeOutro'), late = fixed.filter((f) => f.position === 'beforeOutro');
  return {
    chapters: [...aiChapters.slice(0, pos), ...early.map((f) => f.plan), ...aiChapters.slice(pos, pos2), ...late.map((f) => f.plan), ...aiChapters.slice(pos2)],
    perChapter: [...perAi.slice(0, pos), ...early.map((f) => f.scenes), ...perAi.slice(pos, pos2), ...late.map((f) => f.scenes), ...perAi.slice(pos2)],
  };
}
