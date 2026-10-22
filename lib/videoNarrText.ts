// ナレーション（ひらがな）を、漢字・英字・数字まじりの通常の文章として表示するための変換と、
// 通常の文章の上での修正（ひらがなに直した箇所）から読みを組み立て直す処理。
// 読み（ひらがな）が真の元データ。表示文は読みを区切って対応づけたもの（逆変換ではない）。
// 学習：用語（S&P500 など）の読みを直すと、次回以降の同じ用語に自動で反映する。

export interface Seg {
  kana: string;            // もとの読み（ひらがな）
  surface: string;         // 通常の表記
  kind: 'term' | 'num' | 'plain';
  key?: string;            // 学習のキー（辞書の読み）。term のみ
}
export interface LearnedTerm { surface: string; to: string }
export type LearnedMap = Record<string, LearnedTerm>; // キー：辞書のもとの読み

const SEP = /[、。？！\s]/;

// ---- 辞書（読み → 表記）。読み上げ文の言い回しに限った、閉じた語彙 ----
const TERMS: [string, string][] = [
  ['えすあんどぴーごひゃく', 'S&P500'], ['なすだっくひゃく', 'NASDAQ100'], ['まっくすどろーだうん', 'MDD'], ['どろーだうん', 'DD'],
  ['ろーりんぐりたーん', 'ローリングリターン'], ['ろーりんぐ', 'ローリング'], ['りたーん', 'リターン'], ['ぼらてぃりてぃ', 'ボラティリティ'],
  ['ぺーす', 'ペース'], ['さんぷる', 'サンプル'], ['もーど', 'モード'], ['くりーん', 'クリーン'], ['れぽーと', 'レポート'], ['ちゃーと', 'チャート'],
  ['さいくる', 'サイクル'], ['りーまんしょっく', 'リーマンショック'], ['べあまーけっと', 'ベアマーケット'], ['けーす', 'ケース'],
  ['ぷらす', 'プラス'], ['まいなす', 'マイナス'],
  ['さいたかねこうしん', '最高値更新'], ['さいたかね', '最高値'], ['ねんしょうらい', '年初来'], ['ことし', '今年'], ['ちゅうおうち', '中央値'],
  ['じょうしょうかくりつ', '上昇確率'], ['かいふくりつ', '回復率'], ['げらくにっすう', '下落日数'], ['げらくりつ', '下落率'], ['とうらくりつ', '騰落率'],
  ['だいぼうらく', '大暴落'], ['ぼうらく', '暴落'], ['ちょうせい', '調整'], ['げらく', '下落'], ['じょうしょうび', '上昇日'], ['げらくび', '下落日'],
  ['じょうしょう', '上昇'], ['かくりつ', '確率'], ['へいきん', '平均'], ['じっせき', '実績'], ['ねんまつ', '年末'], ['ちょっきん', '直近'],
  ['げんきょくめん', '現局面'], ['げんざい', '現在'], ['こんご', '今後'], ['ぜんかい', '前回'], ['はっせい', '発生'], ['えいぎょうび', '営業日'],
  ['にちじ', '日次'], ['ぶんせきれぽーと', '分析レポート'], ['ぶんせき', '分析'], ['かいふく', '回復'], ['こうしん', '更新'], ['けいか', '経過'],
  ['おなじじき', '同じ時期'], ['おなじじてん', '同じ時点'], ['ひんど', '頻度'], ['よそう', '予想'], ['よそく', '予測'], ['そうごうよそく', '総合予測'], ['みとおし', '見通し'],
  ['るいじねん', '類似年'], ['だいとうりょう', '大統領'], ['ちゅうかんせんきょ', '中間選挙'], ['ぜんねん', '前年'], ['よくねん', '翌年'], ['かいり', '乖離'],
  ['いどうへいきん', '移動平均'], ['すいじゅん', '水準'], ['はんてい', '判定'], ['そこね', '底値'], ['たいしょうがい', '対象外'], ['きかん', '期間'],
  ['きじゅんび', '基準日'], ['さかのぼって', 'さかのぼって'], ['せいせき', '成績'], ['ばあい', '場合'], ['もちつづけた', '持ち続けた'], ['かんがえられます', '考えられます'],
  ['わりあい', '割合'], ['はんぶん', '半分'], ['はんい', '範囲'], ['おさまりました', '収まりました'], ['ほしょう', '保証'], ['しょうらい', '将来'],
  ['きせつせい', '季節性'], ['げつべつ', '月別'], ['ぜんきかん', '全期間'], ['ぶんぷ', '分布'], ['さんこうち', '参考値'], ['すくない', '少ない'],
  ['ふしめ', '節目'], ['ひょう', '表'], ['ほかの', '他の'], ['ひくい', '低い'], ['たかい', '高い'], ['ながく', '長く'], ['おおきく', '大きく'],
  ['のこりきかん', '残り期間'], ['げつまつじてん', '月末時点'], ['ふくすう', '複数'], ['しひょう', '指標'], ['かじゅう', '加重'], ['ごうせい', '合成'],
  ['くぶん', '区分'], ['すいい', '推移'], ['みどり', '緑'], ['したらくきょくめん', '下落局面'], ['きょくめん', '局面'], ['そこねの', '底値の'],
  ['じっせきへいきん', '実績平均'], ['とうたつ', '到達'], ['たっして', '達して'], ['ちょう', '超'], ['いじできた', '維持できた'], ['いじ', '維持'], ['けいかして', '経過して'],
  ['さいしゅうてきに', '最終的に'], ['ひとつ', '1つ'], ['いちど', '一度'], ['ふたたび', '再び'], ['やく', '約'], ['さいだい', '最大'], ['さいごに', '最後に'],
  ['つぎに', '次に'], ['ここからは', 'ここからは'], ['げつまつ', '月末'], ['ほうこう', '方向'], ['じょうけん', '条件'], ['けっか', '結果'], ['けいけん', '経験'],
  ['しょうとつ', '衝突'], ['ひかく', '比較'], ['くらべる', '比べる'], ['くらべて', '比べて'], ['くらべると', '比べると'], ['くらべ', '比べ'],
  ['おなじ', '同じ'], ['ほとんど', 'ほとんど'], ['かこ', '過去'],
  ['いじょうです', '以上です'], ['いじょう', '以上'], ['いない', '以内'], ['いってい', '一定'], ['さくじつひ', '昨日比'], ['さくじつ', '昨日'], ['にんき', '人気'], ['とうねん', '当年'],
  ['へいじょう', '平常'], ['うわまわる', '上回る'], ['じょうきょう', '状況'], ['さんぷるすう', 'サンプル数'], ['ねだん', '値段'], ['ちかく', '近く'], ['ひは', '日は'], ['ひの', '日の'], ['ねんかん', '年間'], ['ねん', '年'],
  ['きんきょう', '近況'], ['べいこくじかん', '米国時間'], ['じてん', '時点'], ['でーた', 'データ'], ['かいせつ', '解説'], ['じっさい', '実際'], ['おもいますか', '思いますか'],
  ['つづいた', '続いた'], ['こえる', '超える'], ['おきていて', '起きていて'], ['れべる', 'レベル'], ['ぜんたい', '全体'], ['あたま', '頭'],
];

// ---- かなの数字 ----
const DW: [string, number][] = [['きゅう', 9], ['ろく', 6], ['なな', 7], ['しち', 7], ['はち', 8], ['さん', 3], ['よん', 4], ['いち', 1], ['ぜろ', 0], ['れい', 0], ['に', 2], ['ご', 5], ['し', 4], ['く', 9], ['よ', 4]];
const digitAt = (s: string, i: number): [number, number] | null => { for (const [w, v] of DW) if (s.startsWith(w, i)) return [v, w.length]; return null; };

/** かなの整数（じゅうさん・ひゃくにじゅう・いちまん…）を読む。i から始まる数と、読み終わりの位置 */
export function parseKanaInt(s: string, i: number): [number, number] | null {
  let p = i, total = 0, any = false;
  for (let g = 0; g < 3; g++) {
    // 4桁未満のかたまり
    let sec = 0, got = false, q = p;
    const sen = /^(?:はっせん|さんぜん|せん|(?:きゅう|ろく|なな|はち|よん|いち|に|ご)せん)/.exec(s.slice(q));
    if (sen) { const w = sen[0]; sec += w === 'せん' ? 1000 : w === 'はっせん' ? 8000 : w === 'さんぜん' ? 3000 : (digitAt(w, 0)![0]) * 1000; q += w.length; got = true; }
    const hyaku = /^(?:ろっぴゃく|はっぴゃく|さんびゃく|ひゃく|(?:きゅう|なな|よん|いち|に|ご)ひゃく)/.exec(s.slice(q));
    if (hyaku) { const w = hyaku[0]; sec += w === 'ひゃく' ? 100 : w === 'ろっぴゃく' ? 600 : w === 'はっぴゃく' ? 800 : w === 'さんびゃく' ? 300 : (digitAt(w, 0)![0]) * 100; q += w.length; got = true; }
    const jyu = /^(?:(?:きゅう|ろく|なな|はち|よん|さん|に|ご|いち)?じゅう|(?:に|さん|よん|ご|ろく|なな|はち|きゅう)?じゅっ(?=ぱー|かい|こ))/.exec(s.slice(q));
    if (jyu) { const w = jyu[0]; const d = digitAt(w, 0); sec += (w.startsWith('じゅ') ? 1 : d![0]) * 10; q += w.length; got = true; }
    const sok = /^(?:はっ|いっ|ろっ)(?=かい|かげつ)/.exec(s.slice(q));
    const one = sok ? ([sok[0] === 'はっ' ? 8 : sok[0] === 'いっ' ? 1 : 6, 2] as [number, number]) : digitAt(s, q);
    if (one && !(one[1] === 1 && /^(?:し|く|よ)$/.test(s.slice(q, q + 1)) && !/^(?:がつ|ねん|えん|にち|かい|けん|ぱー|ばい)/.test(s.slice(q + 1)))) {
      // 1桁目。「に」「ご」など1文字の読みは、直前までに桁があるか、単独の数として扱う
      sec += one[0]; q += one[1]; got = true;
    }
    if (!got) break;
    const nxt = s.slice(q, q + 2);
    if (nxt === 'まん') { total += sec * 10000; p = q + 2; any = true; continue; }
    if (nxt === 'おく') { total += sec * 100000000; p = q + 2; any = true; continue; }
    total += sec; p = q; any = true; break;
  }
  return any ? [total, p] : null;
}

const MONTH_UNIT = 'がつ';
const DAY_WORDS: Record<string, number> = { ついたち: 1, ふつか: 2, みっか: 3, よっか: 4, いつか: 5, むいか: 6, なのか: 7, ようか: 8, ここのか: 9, とおか: 10, はつか: 20, じゅうよっか: 14, にじゅうよっか: 24 };
const UNITS: [string, string][] = [
  ['ぱーせんと', '%'], ['ぱー', '%'], ['ばんめ', '番目'], ['ねんかん', '年間'], ['ねんまつ', '年末'], ['ねんめ', '年目'], ['ねん', '年'], ['かげつ', 'ヶ月'], ['かいめ', '回目'], ['かい', '回'], ['けん', '件'],
  ['にちかん', '日間'], ['にち', '日'], ['えん', '円'], ['ばい', '倍'], ['ぶん', '分'], ['つ', 'つ'],
];

/** 数＋単位（ぷらすじゅうに、てん、よんぱーせんと → +12.4% など）。読めたら [表記, 読み終わり] */
function parseNumber(s: string, i: number): [string, number] | null {
  let p = i, sign = '';
  if (s.startsWith('ぷらす', p)) { sign = '+'; p += 3; if (s[p] === '、') p++; } else if (s.startsWith('まいなす', p)) { sign = '-'; p += 4; if (s[p] === '、') p++; }
  // 日付（じゅうがつはつか → 10月20日）
  const mm = parseKanaInt(s, p);
  if (mm && !sign && s.startsWith(MONTH_UNIT, mm[1]) && mm[0] >= 1 && mm[0] <= 12) {
    let end = mm[1] + 2, txt = `${mm[0]}月`;
    for (const w of Object.keys(DAY_WORDS).sort((a, b) => b.length - a.length)) if (s.startsWith(w, end)) { txt += `${DAY_WORDS[w]}日`; end += w.length; break; }
    return [txt, end];
  }
  for (const w of Object.keys(DAY_WORDS).sort((a, b) => b.length - a.length)) if (!sign && s.startsWith(w, p)) return [`${DAY_WORDS[w]}日`, p + w.length];
  if (!mm) return null;
  let [val, end] = mm;
  // 「にじゅう・にちかん」のように、最後の「に」が単位「にち」の一部のとき
  if (s[end] === 'ち' && s[end - 1] === 'に' && val % 10 === 2) { val -= 2; end -= 1; if (end <= p && val === 0) return null; }
  let text = String(val);
  // 小数（、てん、さん）
  let dec = '';
  let q = end;
  const tm = /^[、]?てん[、]?/.exec(s.slice(q));
  if (tm) {
    let r = q + tm[0].length, ds = '';
    for (let k = 0; k < 1; k++) { const d = digitAt(s, r); if (!d || (d[1] === 1 && /^[しくよ]$/.test(s[r]))) break; ds += d[0]; r += d[1]; }
    if (ds) { dec = `.${ds}`; end = r; }
  }
  text += dec;
  // 単位
  let unit = '';
  for (const [k, v] of UNITS) if (s.startsWith(k, end) && !(k === 'つ' )) { unit = v; end += k.length; break; }
  // 「いっかげつ」「ろっかげつ」など
  if (!unit && !sign && !dec && !(val >= 10) && !s.startsWith('から', end)) return null;
  return [`${sign}${text}${unit}`, end];
}

const SORTED_TERMS = TERMS.slice().sort((a, b) => b[0].length - a[0].length);

/** 読みを区切って、通常の表記と対応づける */
export function segmentReading(reading: string, extra: [string, string][] = [], learned: LearnedMap = {}): Seg[] {
  const dict = extra.length ? [...extra, ...SORTED_TERMS].sort((a, b) => b[0].length - a[0].length) : SORTED_TERMS;
  const segs: Seg[] = [];
  let i = 0, plain = '';
  const flush = () => { if (plain) { segs.push({ kana: plain, surface: plain, kind: 'plain' }); plain = ''; } };
  while (i < reading.length) {
    const ch = reading[i];
    if (SEP.test(ch)) { plain += ch; i++; continue; }
    // 語の途中（ひらがなが続いている途中）から始まる数や短い語は、別の語の一部なので読まない
    const atBoundary = plain === '' || SEP.test(plain[plain.length - 1]);
    // 1) 辞書
    let hit: [string, string] | null = null;
    for (const t of dict) if (reading.startsWith(t[0], i) && (atBoundary || t[0].length > 4)) { hit = t; break; }
    // 数（辞書の語より長く読めるときは数を優先：ぷらす〜ぱーせんと）
    const num = atBoundary ? parseNumber(reading, i) : null;
    if (num && (!hit || num[1] - i > hit[0].length)) {
      flush(); segs.push({ kana: reading.slice(i, num[1]), surface: num[0], kind: 'num' }); i = num[1]; continue;
    }
    if (hit) {
      flush();
      const L = learned[hit[0]];
      segs.push({ kana: L ? L.to : hit[0], surface: L ? L.to : hit[1], kind: 'term', key: hit[0] });
      i += hit[0].length; continue;
    }
    plain += ch; i++;
  }
  flush();
  return segs;
}

/** 表示文（通常の文章） */
export const displayOf = (segs: Seg[]): string => segs.map(s => s.surface).join('');
/** 読み上げる文（ひらがな） */
export const readingOf = (segs: Seg[]): string => segs.map(s => s.kana).join('');
/** 緑にする範囲（学習済み・個別修正でひらがなに変えた用語） */
export function greenMask(segs: Seg[], learned: LearnedMap): boolean[] {
  const m: boolean[] = [];
  for (const s of segs) { const g = s.kind === 'term' && !!s.key && !!learned[s.key]; for (let k = 0; k < s.surface.length; k++) m.push(g); }
  return m;
}

// ---- 差分 ----
interface Op { from: string; to: string; fromAt: number; toAt: number }
function diffOps(a: string, b: string): Op[] {
  const n = a.length, m = b.length;
  if (n * m > 3_000_000) return a === b ? [] : [{ from: a, to: b, fromAt: 0, toAt: 0 }];
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops: Op[] = [];
  let i = 0, j = 0, cur: Op | null = null;
  const flush = () => { if (cur) { ops.push(cur); cur = null; } };
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { flush(); i++; j++; continue; }
    if (!cur) cur = { from: '', to: '', fromAt: i, toAt: j };
    if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) { cur.to += b[j]; j++; } else { cur.from += a[i]; i++; }
  }
  flush();
  return ops;
}

/** 緑にする範囲（表示文 base に対して、text で変わった文字） */
export function changedMask(base: string, text: string): boolean[] {
  const mask = new Array<boolean>(text.length).fill(false);
  for (const op of diffOps(base, text)) {
    for (let k = 0; k < op.to.length; k++) mask[op.toAt + k] = true;
    if (!op.to.length && text.length) mask[Math.min(text.length - 1, Math.max(0, op.toAt))] = true;
  }
  return mask;
}

const KANA_ONLY = /^[ぁ-ゖー、ゔ]+$/;

export interface EditResult {
  reading: string;                         // 修正後の読み（この場面）
  learn: { key: string; surface: string; to: string }[];  // 学習する用語
  changed: boolean;
}

/**
 * 通常の文章 shown を text に直したときの、読みと学習内容を求める。
 * 区切り（segs）ごとに、直した後の文字を割り当てる。用語がひらがなに直されていれば学習する。
 */
export function applyMixedEdit(segs: Seg[], text: string): EditResult {
  const shown = displayOf(segs);
  if (text === shown) return { reading: readingOf(segs), learn: [], changed: false };
  const ops = diffOps(shown, text);
  // 表示文の各文字 → 区切りの番号
  const owner: number[] = [];
  segs.forEach((s, k) => { for (let c = 0; c < s.surface.length; c++) owner.push(k); });
  const out: string[] = segs.map(() => '');
  const removed = new Array<boolean>(shown.length).fill(false);
  const ins: Record<number, string> = {}; // 表示文の位置 → そこへ入る文字列
  for (const op of ops) {
    for (let c = 0; c < op.from.length; c++) removed[op.fromAt + c] = true;
    ins[op.fromAt] = (ins[op.fromAt] ?? '') + op.to;
  }
  for (let p = 0; p <= shown.length; p++) {
    if (ins[p] !== undefined) { const k = p < shown.length ? owner[p] : (owner[shown.length - 1] ?? 0); if (segs.length) out[k] += ins[p]; }
    if (p < shown.length && !removed[p]) out[owner[p]] += shown[p];
  }
  const learn: EditResult['learn'] = [];
  let reading = '';
  segs.forEach((s, k) => {
    const t = out[k];
    if (t === s.surface) { reading += s.kana; return; }
    if (s.kind === 'term' && s.key && t && KANA_ONLY.test(t)) { learn.push({ key: s.key, surface: s.key ? (TERMS.find(x => x[0] === s.key)?.[1] ?? s.surface) : s.surface, to: t }); reading += t; return; }
    reading += t; // 数や言い回しの直しは、この場面だけ
  });
  return { reading, learn, changed: true };
}

export function termSurface(key: string, extra: [string, string][] = []): string {
  return extra.find(x => x[0] === key)?.[1] ?? TERMS.find(x => x[0] === key)?.[1] ?? key;
}
