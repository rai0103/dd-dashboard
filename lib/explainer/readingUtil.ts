// [Stage E-16] 固定場面の読み上げ文に残った、区分ラベル由来の数字・漢字（例：「1〜2%」「翌営業日」「3ヶ月」「0〜3日（高速）」）を
// ひらがなに直す。固定場面ビルダーは読み上げ文をひらがなで組み立てているが、区分ラベルをそのまま埋め込んでいる箇所があり、
// 公開前チェックで「読み上げ文に漢字・英数字が含まれます」と出ていたため、最後にまとめて補正する。
import { numberStringToKana } from '../videoReading';

const MONTHS: Record<string, string> = { '1': 'いっかげつ', '3': 'さんかげつ', '6': 'ろっかげつ', '10': 'じゅっかげつ', '12': 'じゅうにかげつ' };
const PHRASES: [RegExp, string][] = [
  [/翌営業日/g, 'よくえいぎょうび'], [/営業日後/g, 'えいぎょうびご'], [/営業日/g, 'えいぎょうび'],
  [/（高速）|\(高速\)/g, '、こうそく'], [/（低速）|\(低速\)/g, '、ていそく'], [/（普通）|\(普通\)/g, '、ふつう'],
  [/以上/g, 'いじょう'], [/以内/g, 'いない'], [/未満/g, 'みまん'], [/超/g, 'ちょう'],
];
export function kanaizeReading(s: string): string {
  let r = s.replace(/[「」『』]/g, '');
  for (const [re, to] of PHRASES) r = r.replace(re, to);
  r = r.replace(/(\d+)\s*(?:ヶ月|か月|カ月)/g, (_, n: string) => MONTHS[n] ?? `${numberStringToKana(n)}かげつ`);
  r = r.replace(/〜|～/g, 'から、');
  r = r.replace(/(\d+(?:\.\d+)?)\s*%/g, (_, n: string) => `${numberStringToKana(n)}ぱーせんと`);
  r = r.replace(/(\d+(?:\.\d+)?)\s*年/g, (_, n: string) => `${numberStringToKana(n)}ねん`);
  r = r.replace(/(\d+(?:\.\d+)?)\s*日/g, (_, n: string) => `${numberStringToKana(n)}にち`);
  r = r.replace(/(\d+(?:\.\d+)?)\s*回/g, (_, n: string) => `${numberStringToKana(n)}かい`);
  r = r.replace(/\d+(?:\.\d+)?/g, (n) => numberStringToKana(n));
  return r.replace(/、{2,}/g, '、');
}
