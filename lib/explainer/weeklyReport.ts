// 週次レポートの固定場面（実データ。AIに作文させない）。計算は weeklyReportCore.ts
import type { ChapterPlan, ExplainerScene, VisualItem } from './types';
import { emptyVisual } from './types';
import { newSceneId, minSecFor } from './scriptModel';
import { kanaizeReading } from './readingUtil';
import { shortFundName, yenJp, signed, pct1, md } from './weeklyReportCore';
import type { WeeklyData, Purchase } from './weeklyReportCore';
export * from './weeklyReportCore';

const plan = (title: string, reading: string, goal: string): ChapterPlan => ({ title, reading, role: 'body', goal, keyPoints: '', sceneCount: 0 });
function scene(title: string, caption: string, narration: string, visual: ExplainerScene['visual']): ExplainerScene {
  // 英字の銘柄名は、数字の読みかえ（kanaizeReading）より先にかなにしておく（「S&P500」が「S&Pごひゃく」にならないように）
  const pre = narration.replace(/S&P500/g, 'えすあんどぴーごひゃく').replace(/NASDAQ100/g, 'なすだっくひゃく').replace(/FANG\+/g, 'ふぁんぐぷらす').replace(/TOPIX/g, 'とぴっくす').replace(/日経225/g, 'にっけいにーにーご');
  return { id: newSceneId(), title, caption, narration, reading: kanaizeReading(pre), visual, chapter: 0, minSec: minSecFor(visual.kind), fixedKey: `fixed:weekly:${title}` };
}

/** 実データの固定場面（今週の資産状況の章）。AIの導入章の直後に入れる */
export function buildWeeklyFixedChapter(d: WeeklyData, purchases: Purchase[]): { plan: ChapterPlan; scenes: ExplainerScene[]; position: 'afterIntro' } {
  const scenes: ExplainerScene[] = [];
  const chg = d.change != null && d.prevDate ? `前の週から${signed(d.change, yenJp)}、率にして${signed(d.pct ?? 0, pct1)}でした` : '今週から報告を始めます';
  scenes.push(scene('今週の評価額', `評価額 ${yenJp(d.total)}`,
    `まずは今週の口座です。${md(d.asOf)}時点の評価額は${yenJp(d.total)}。${chg}。${d.buyTotal ? `今週買い付けた${yenJp(d.buyTotal)}は、この増減から除いています。` : ''}`,
    { ...emptyVisual('number'), heading: '今週の評価額', items: [{ label: `${md(d.asOf)}時点`, value: String(Math.round(d.total)), text: d.change != null ? `前週比 ${d.change >= 0 ? '+' : '−'}${Math.abs(Math.round(d.change)).toLocaleString()}円（${(d.pct ?? 0) >= 0 ? '+' : ''}${(d.pct ?? 0).toFixed(1)}%）` : '', icon: 'yen' }], unit: '円', source: '大和コネクト証券の口座（スクショ）' }));
  const moved = d.rows.filter((r) => r.pct != null);
  if (moved.length) {
    const best = moved.reduce((a, b) => ((b.pct as number) > (a.pct as number) ? b : a));
    const worst = moved.reduce((a, b) => ((b.pct as number) < (a.pct as number) ? b : a));
    const items: VisualItem[] = moved.map((r) => ({ label: r.short, value: (r.pct as number).toFixed(1), text: '', icon: (r.pct as number) >= 0 ? 'chartUp' : 'chartDown' }));
    scenes.push(scene('銘柄別の値動き', `一番上げたのは${best.short}`,
      `銘柄ごとの今週の値動きです。一番上げたのは${best.short}で${signed(best.pct as number, pct1)}。${worst.name !== best.name ? `一番下げたのは${worst.short}で${signed(worst.pct as number, pct1)}でした。` : ''}`,
      { ...emptyVisual('bar'), heading: '銘柄別の今週の値動き', subheading: `${md(d.prevDate!)}→${md(d.asOf)}（買い付け分を除く）`, items, unit: '%', source: '大和コネクト証券の口座（スクショ）' }));
  }
  if (purchases.length) {
    const sum = purchases.reduce((s, p) => s + p.amount, 0);
    scenes.push(scene('今月の買い付け', `今月は${yenJp(sum)}を買い付け`,
      `今月の買い付けです。${purchases.map((p) => `${shortFundName(p.name) || p.name}を${yenJp(p.amount)}`).join('、')}、合計${yenJp(sum)}を買いました。`,
      { ...emptyVisual('bar'), heading: '今月の買い付け', subheading: `合計 ${sum.toLocaleString()}円`, items: purchases.map((p) => ({ label: shortFundName(p.name) || p.name, value: String(Math.round(p.amount)), text: '', icon: 'yen' })), unit: '円', source: '大和コネクト証券の取引' }));
  }
  const rate = (d.total / d.goal) * 100;
  scenes.push(scene('目標までの距離', `1億円まであと${yenJp(d.goal - d.total)}`,
    `目標の1億円に対して、達成率は${rate.toFixed(2)}%。あと${yenJp(Math.max(0, d.goal - d.total))}です。`,
    { ...emptyVisual('number'), heading: '目標1億円までの達成率', items: [{ label: '評価額 ÷ 1億円', value: rate.toFixed(2), text: `あと ${Math.max(0, Math.round(d.goal - d.total)).toLocaleString()}円`, icon: 'target' }], unit: '%', source: '大和コネクト証券の口座（スクショ）' }));
  return { plan: { ...plan('今週の資産状況', 'こんしゅうの、しさんじょうきょう', '評価額・前週比・銘柄別の値動き・買い付け・目標の達成率'), sceneCount: scenes.length }, scenes, position: 'afterIntro' };
}
