// [dd-dashboard移植版] investment-shorts (lib/longAnalysis.ts) を移植。
// SummaryMd（sm）経由の分岐は移植しない（dd-dashboardはLongMdを直接組み立てるため、smを使う経路は発生しない。
// これにより longSummaryMd.ts の移植も不要になる）。
// 「えすあんどぴーごひゃく」決め打ちは instrumentNameKana 引数で任意銘柄に対応。
import { UpdateStats, buildUpdateScenes, fmtPct, pctKana, nichiKana, hitoKana, intervalKana, levelKana, monthDayKana } from './videoMarketUpdate';
import { integerToKana, yearsToKana } from './videoReading';
import { LongMd, buildMdScenes, SP500_KANA, ContentSectionId } from './videoLongMd';
import { LongBasis } from './videoLongBasis';

export type LongSceneId = 'open' | 'ytd' | 'ytdvs' | 'ath' | 'athcount' | 'updown' | 'outlook' | 'crash' | 'end' | 'position' | 'momentum' | 'risk' | 'range' | 'status' | 'bottom' | 'rolling' | 'forecast' | 'ddpace' | 'crashmd' | 'daily' | 'basis10' | 'basisCycle' | 'x_open' | 'x_ytd' | 'x_recent' | 'x_ytdvs' | 'x_rolling' | 'x_ath' | 'x_episodes' | 'x_athcount' | 'x_updown' | 'x_outlook' | 'x_range' | 'x_crash' | 'x_end';

export interface LongScene {
  id: LongSceneId;
  reading: string;      // 読み上げ（ひらがな）
  minSec: number;
  caption: string;      // アナリストの吹き出しに出す要点（表示用）
  detail: boolean;      // 詳細分析のシーン（左パネルを自前で描く）
}

export function buildLongScenes(s: UpdateStats, md?: LongMd | null, basis?: LongBasis | null, rolling?: { label: string; v: number }[], instrumentNameKana: string = SP500_KANA, sections?: ContentSectionId[]): LongScene[] {
  if (md) return buildMdScenes(md, basis, instrumentNameKana, sections).map(m => ({ id: m.id as LongSceneId, reading: m.reading, minSec: m.minSec, caption: m.caption, detail: m.id !== 'open' }));
  const base = buildUpdateScenes(s);
  const cap = (id: string): string => {
    switch (id) {
      case 'open': return `S&P500の近況と分析。${s.year}年${s.month}月${s.day}日（米国時間）のデータです。`;
      case 'ytd': return `年初来 ${fmtPct(s.ytd)}、昨日比 ${fmtPct(s.dayChange)}${s.oneYear !== null ? `、直近1年 ${fmtPct(s.oneYear)}` : ''}`;
      case 'ytdvs': return `過去${s.pastYtd.length}年の同時期と比べて${s.ytdRank}位。中央値は ${fmtPct(s.ytdMedian)}。`;
      case 'ath': return s.dd >= -0.005 ? `最高値を更新。今年の最大下落は ${s.ddMin.toFixed(1)}%。` : `最高値から ${s.dd.toFixed(1)}%、更新から${s.athDays}日経過。`;
      case 'athcount': return `今年の最高値更新は ${s.athCount} 回（過去平均 約${Math.max(1, Math.round(s.athAvg))}回）。`;
      case 'updown': return `上昇日 ${s.up}日・下落日 ${s.down}日。上昇日の割合 ${s.upRatio.toFixed(1)}%（過去平均 ${s.upRatioAvg.toFixed(1)}%）。`;
      case 'outlook': return `年末までに上昇した年は ${s.outlook.posCount}/${s.outlook.n}年（${s.outlook.posProb.toFixed(0)}%）。`;
      case 'crash': return '暴落の発生率は、過去の実績から見た目安です。';
      case 'end': return `${s.year}年${s.month}月${s.day}日のS&P500の分析レポートは以上です。`;
      default: return '';
    }
  };
  const out: LongScene[] = base.map(b => b.id === 'end'
    ? { id: b.id, reading: `${yearsToKana(s.year)}、${monthDayKana(s.month, s.day)}の、${instrumentNameKana}の、ぶんせきれぽーとは、いじょうです。`, minSec: 8, caption: cap(b.id), detail: true }
    : { id: b.id, reading: b.reading, minSec: b.minSec + 1, caption: cap(b.id), detail: false });

  const o = s.outlook;
  const last10Up = s.last10.filter(v => v > 0).length;
  const last10Dn = s.last10.length - last10Up;
  const diffAvg = s.ytd - s.ytdAvg;
  const detail: LongScene[] = [
    {
      id: 'position', detail: true, minSec: 10,
      caption: `分析①：年初来 ${fmtPct(s.ytd)} は、過去平均 ${fmtPct(s.ytdAvg)} より${diffAvg >= 0 ? '高い' : '低い'}水準です。`,
      reading: `ここからは、すこし、くわしく、ぶんせきします。まずは、げんざいの、いちです。ことしの、ねんしょうらいは、${pctKana(s.ytd)}。かこの、おなじじきの、へいきんは、${pctKana(s.ytdAvg)}、ちゅうおうちは、${pctKana(s.ytdMedian)}です。へいきんと、くらべて、${diffAvg >= 0 ? 'たかい' : 'ひくい'}、すいじゅんです。`,
    },
    {
      id: 'momentum', detail: true, minSec: 10,
      caption: `分析②：直近${s.last10.length}営業日は 上昇${last10Up}日・下落${last10Dn}日。勢いの強さを日次で確認します。`,
      reading: `つぎに、ちょっきんの、いきおいです。ちょっきん、${integerToKana(s.last10.length)}えいぎょうびの、うち、じょうしょうした、ひは、${nichiKana(last10Up)}、げらくした、ひは、${nichiKana(last10Dn)}でした。ことしぜんたいの、じょうしょうりつは、${pctKana(s.upRatio, false)}、かこの、へいきんは、${pctKana(s.upRatioAvg, false)}です。`,
    },
  ];
  if (s.crash && s.crash.length) {
    const r10 = s.crash.find(r => r.level === 10);
    const r20 = s.crash.find(r => r.level === 20);
    const parts: string[] = [];
    if (r10) parts.push(`${levelKana(10)}いじょうの、げらくは、${intervalKana(r10)}`);
    if (r20) parts.push(`${levelKana(20)}いじょうの、げらくは、${intervalKana(r20)}`);
    detail.push({
      id: 'risk', detail: true, minSec: 10,
      caption: `分析③：現在は最高値から ${s.dd.toFixed(1)}%、今年の最大下落は ${s.ddMin.toFixed(1)}%。下落リスクの目安を確認します。`,
      reading: `さんばんめは、げらくの、りすくです。げんざいは、さいたかねから、${pctKana(s.dd)}。ことしの、さいだいの、げらくりつは、${pctKana(s.ddMin, false)}でした。かこの、じっせきでは、${parts.join('。')}です。`,
    });
  }
  detail.push({
    id: 'range', detail: true, minSec: 11,
    caption: `分析④：過去${o.n}年、同時期から年末までの変化は中央値 ${fmtPct(o.median)}。半数は ${fmtPct(o.p25)}〜${fmtPct(o.p75)} に収まりました（予想ではなく過去の実績）。`,
    reading: `さいごは、ねんまつまでの、はばです。かこ、${hitoKana(o.n)}の、じっせきでは、おなじじきから、ねんまつまでの、へんかの、ちゅうおうちは、${pctKana(o.median)}。はんぶんの、ねんは、${pctKana(o.p25)}から、${pctKana(o.p75)}の、はんいに、おさまりました。これは、よそうでは、なく、かこの、じっせきです。`,
  });
  const endIdx = out.findIndex(x => x.id === 'end');
  out.splice(endIdx < 0 ? out.length : endIdx, 0, ...detail);
  return out;
}

export function buildAnalysisTitle(s: UpdateStats): string {
  return `S&P500の分析（${s.asOf.replace(/-/g, '/')}時点）年初来${fmtPct(s.ytd)}・過去実績で見る年末の確率とリスク`.slice(0, 100);
}
