// 読み上げ文（ひらがな）を音声合成に渡す前の手直し。
// 音声合成（AivisSpeech・Windowsの音声）は、ひらがなの「は」を文の区切り方から助詞（わ）と判断して読むため、
// 「推進派は」の読み上げ文「すいしんはは」が「すいしんわわ」と読まれてしまう。
// そこで、元のナレーション（漢字かな交じり）と読み上げ文の文字の対応を取り、漢字の読みの最後の「は」
// （派・葉・歯など。後ろに助詞や句読点が続くもの）だけをカタカナの「ハ」に変えて、必ず「は」と発音させる。
// 助詞の「は」はそのまま（音声合成が「わ」と読む）。画面に表示する読み上げ文は変えない。

const isHira = (c: string) => /[ぁ-ゖ]/.test(c);
const isKata = (c: string) => /[ァ-ヺ]/.test(c);
const isPunct = (c: string) => /[、。，．,.！？!?「」『』（）()［］[\]・…‥—―〜~：:；;\s]/.test(c);
const toHira = (c: string) => (isKata(c) ? String.fromCharCode(c.charCodeAt(0) - 0x60) : c);
const VOWELS = 'あいうえおぁぃぅぇぉゃゅょん';
/** 単語の最後で「は」と読むことがある漢字（推進派・葉・歯・刃・羽・覇） */
const HA_KANJI = /[派葉歯刃羽覇]/;

type Tok = { kind: 'hira' | 'kata' | 'long' | 'punct' | 'other'; text: string; kanji: number };

function tokenize(narr: string): Tok[] {
  const out: Tok[] = [];
  for (const c of Array.from(narr)) {
    if (isHira(c)) out.push({ kind: 'hira', text: c, kanji: 0 });
    else if (c === 'ー') out.push({ kind: 'long', text: c, kanji: 0 });
    else if (isKata(c)) out.push({ kind: 'kata', text: c, kanji: 0 });
    else if (isPunct(c)) out.push({ kind: 'punct', text: c, kanji: 0 });
    else {
      const last = out[out.length - 1];
      const kanji = /[一-鿿々〆ヶ]/.test(c) ? 1 : 0;
      if (last && last.kind === 'other') { last.text += c; last.kanji += kanji; } else out.push({ kind: 'other', text: c, kanji });
    }
  }
  return out;
}

/**
 * ナレーションと読み上げ文の対応を取る（動的計画法）。各トークンが読み上げ文のどこからどこまでに当たるかを返す。
 * ひらがな・カタカナ（ひらがなに直して）は同じ文字に、漢字・数字などのかたまりは0〜数文字に対応させる。
 * 対応がうまく取れない（費用が大きい）ときは null。
 */
export function alignReading(narr: string, reading: string): { toks: Tok[]; spans: [number, number][] } | null {
  const toks = tokenize(narr);
  const r = Array.from(reading);
  const n = toks.length, m = r.length;
  if (!n || !m) return null;
  const INF = 1e9;
  const dp: Float64Array[] = Array.from({ length: n + 1 }, () => new Float64Array(m + 1).fill(INF));
  const from: Int32Array[] = Array.from({ length: n + 1 }, () => new Int32Array(m + 1).fill(-1)); // 直前の j（読み上げ文のどこまで使ったか）
  dp[0][0] = 0;
  // 読み上げ文の先頭に余分な文字があっても対応が取れるよう、読み飛ばし（1文字1）を許す
  for (let j = 1; j <= m; j++) { dp[0][j] = dp[0][j - 1] + 1; from[0][j] = j - 1; }
  for (let i = 0; i < n; i++) {
    const t = toks[i];
    for (let j = 0; j <= m; j++) {
      const base = dp[i][j];
      if (base >= INF) continue;
      const relax = (j2: number, cost: number) => { const v = base + cost; if (v < dp[i + 1][j2]) { dp[i + 1][j2] = v; from[i + 1][j2] = j; } };
      if (t.kind === 'hira' || t.kind === 'kata') {
        const want = toHira(t.text);
        if (j < m && r[j] === want) relax(j + 1, 0);
        relax(j, 3); // ナレーション側の文字を読み上げ文が持たない
        if (j < m && r[j] !== want && !isPunct(r[j])) relax(j + 1, 2.5); // 別の文字に置き換わっている
      } else if (t.kind === 'long') {
        if (j < m && VOWELS.includes(r[j])) relax(j + 1, 0);
        relax(j, 0.5);
      } else if (t.kind === 'punct') {
        if (j < m && r[j] === t.text) relax(j + 1, 0);
        if (j < m && isPunct(r[j])) relax(j + 1, 0.1);
        relax(j, 0.2); // 読み上げ文では句読点を省いた
      } else {
        // 漢字・数字・英字などのかたまり：読みはだいたい漢字1字に2文字、それ以外は1字に2〜3文字
        const len = Array.from(t.text).length;
        const expect = t.kanji * 1.8 + (len - t.kanji) * 2.5;
        // 最後の漢字が「派・葉・歯」など「は」と読む字なら、読みが「は」で終わる取り方を優先する
        const endsHa = HA_KANJI.test(Array.from(t.text).pop() || '');
        const maxK = Math.min(m - j, len * 6 + 4);
        for (let k = 0; k <= maxK; k++) {
          if (k > 0 && isPunct(r[j + k - 1])) break; // かたまりの読みに句読点はふくめない
          relax(j + k, (k === 0 ? 3 : 0) + Math.abs(k - expect) * 0.15 + (endsHa && r[j + k - 1] !== 'は' ? 0.6 : 0));
        }
      }
    }
    // 読み上げ文側の余分な文字（読み飛ばし）
    for (let j = 1; j <= m; j++) { const v = dp[i + 1][j - 1] + 1; if (v < dp[i + 1][j]) { dp[i + 1][j] = v; from[i + 1][j] = -(j - 1) - 2; } }
  }
  if (dp[n][m] > Math.max(6, n * 0.5)) return null;
  // 戻りながら、各トークンの範囲を決める
  const spans: [number, number][] = new Array(n);
  let i = n, j = m;
  while (i > 0) {
    let f = from[i][j];
    while (f <= -2) { j = -f - 2; f = from[i][j]; } // 読み飛ばしをさかのぼる
    spans[i - 1] = [f, j];
    j = f; i--;
  }
  return { toks, spans };
}

/** 音声合成に渡す読み上げ文：漢字の読みの最後の「は」で、後ろに助詞・句読点が続くものをカタカナの「ハ」にする */
export function fixHaForTts(reading: string, narration: string): string {
  if (!reading || !reading.includes('は')) return reading;
  const r = Array.from(reading);
  const al = narration ? alignReading(narration, reading) : null;
  if (al) {
    const { toks, spans } = al;
    toks.forEach((t, i) => {
      if (t.kind !== 'other' || !HA_KANJI.test(Array.from(t.text).pop() || '')) return;
      const [a, b] = spans[i];
      if (b <= a || r[b - 1] !== 'は') return;
      const next = toks[i + 1];
      if (!next || next.kind === 'hira' || next.kind === 'punct') r[b - 1] = 'ハ';
    });
    return r.join('');
  }
  // 対応が取れないときは変えない（取り違えて別の「は」を変えるほうが害が大きいため）
  return reading;
}
