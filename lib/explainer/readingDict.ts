// 読み方辞書：AIや音声合成が読み違える語（続報→ぞっぽう、新たな→あたらしい 等）の正しい読みを覚えておき、
// ①台本生成時にAIへ「この語はこの読み方」と指示、②生成後の読み上げ文（ひらがな）を補正、
// ③読み上げ文が無い・古いときにナレーション（漢字の文）を音声合成へ渡す前に読みへ置き換える、の3か所で使う。
// 制作者が読み上げ文を手で直すと、直した部分から辞書の項目を作って覚える（learnFromReadingEdit）。
// 保存先はローカルTTSサーバー（~/.dd-dashboard/reading-dict.json。夜間の自動生成でも同じ辞書を使う）と、
// 予備としてブラウザのlocalStorage。

export interface ReadingEntry {
  /** ナレーション（漢字の文）での書き方。空のときは読み上げ文の置き換え（wrong→reading）だけを行う */
  word: string;
  /** 正しい読み（ひらがな） */
  reading: string;
  /** 読み上げ文に出てきたら直す、間違った読み（ひらがな） */
  wrong: string[];
  /** 制作者が覚えさせた項目か（組み込みの項目はfalse） */
  user?: boolean;
}

/** 組み込みの項目（制作者が同じ語を登録したら、そちらを優先する） */
export const BUILTIN_READINGS: ReadingEntry[] = [
  { word: '続報', reading: 'ぞくほう', wrong: ['ぞっぽう', 'ぞくぽう'] },
  { word: '新たな', reading: 'あらたな', wrong: ['あたらしいな', 'あたらしな', 'あたらしい'] },
  { word: '新たに', reading: 'あらたに', wrong: ['あたらしいに', 'あたらしく'] },
];

const LS_KEY = 'explainer-reading-dict-v1';
let userEntries: ReadingEntry[] = [];
const listeners = new Set<(list: ReadingEntry[]) => void>();

const kanaOnly = (s: string) => /^[ぁ-ゟー]+$/.test(s);

function cleanEntry(e: any): ReadingEntry | null {
  const word = String(e?.word ?? '').trim().slice(0, 20);
  const reading = String(e?.reading ?? '').trim().slice(0, 30);
  const wrong = (Array.isArray(e?.wrong) ? e.wrong : []).map((w: any) => String(w ?? '').trim().slice(0, 30)).filter((w: string) => w && kanaOnly(w) && w !== reading);
  if (!reading || !kanaOnly(reading)) return null;
  if (!word && !wrong.length) return null;
  return { word, reading, wrong: Array.from(new Set(wrong)), user: true };
}

const keyOf = (e: ReadingEntry) => (e.word ? `w:${e.word}` : `k:${e.wrong.join('|')}`);

/** 組み込み＋制作者の項目（同じ語は制作者の項目を優先。組み込みの間違い読みは引き継ぐ） */
export function getReadingDict(): ReadingEntry[] {
  const map = new Map<string, ReadingEntry>();
  for (const e of BUILTIN_READINGS) map.set(keyOf(e), { ...e, user: false });
  for (const e of userEntries) {
    const prev = map.get(keyOf(e));
    map.set(keyOf(e), prev && !prev.user ? { ...e, wrong: Array.from(new Set([...e.wrong, ...prev.wrong])).filter((w) => w !== e.reading) } : e);
  }
  return Array.from(map.values());
}

export function getUserReadings(): ReadingEntry[] { return userEntries.slice(); }

export function setUserReadings(list: any[]): void {
  const out: ReadingEntry[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(list) ? list : []) {
    const e = cleanEntry(raw);
    if (!e || seen.has(keyOf(e))) continue;
    seen.add(keyOf(e)); out.push(e);
  }
  userEntries = out.slice(0, 300);
  listeners.forEach((f) => f(getUserReadings()));
}

export function onReadingDictChange(f: (list: ReadingEntry[]) => void): () => void {
  listeners.add(f);
  return () => { listeners.delete(f); };
}

/** 項目を足す（同じ語・同じ間違い読みがあれば置き換える） */
export function upsertReading(e: ReadingEntry): ReadingEntry[] {
  const c = cleanEntry(e);
  if (!c) return getUserReadings();
  const rest = userEntries.filter((x) => keyOf(x) !== keyOf(c) && !(c.word && x.word === c.word));
  setUserReadings([c, ...rest]);
  return getUserReadings();
}

export function removeReading(e: ReadingEntry): ReadingEntry[] {
  setUserReadings(userEntries.filter((x) => keyOf(x) !== keyOf(e)));
  return getUserReadings();
}

/** AIへの指示文（台本生成のシステムプロンプトに足す）。項目が無ければ空文字 */
export function readingPromptLine(): string {
  const list = getReadingDict().filter((e) => e.word);
  if (!list.length) return '';
  return `【読み方の指定】次の語は、読み上げ文（reading）で必ずこの読み方のひらがなで書くこと（他の読み方にしない）：${list.slice(0, 120).map((e) => `${e.word}＝${e.reading}`).join('、')}`;
}

const allIndexes = (s: string, sub: string): number[] => {
  const out: number[] = [];
  if (!sub) return out;
  for (let i = s.indexOf(sub); i >= 0; i = s.indexOf(sub, i + sub.length)) out.push(i);
  return out;
};

/**
 * 読み上げ文（ひらがな）の補正。ナレーションに語が出てくる回数だけ、文中の位置が近い「間違った読み」を正しい読みに直す
 * （「新たな」と「新しい」が同じ文にあっても、「新しい」の読み「あたらしい」まで直さないため）。
 * 語が空の項目は、間違った読みをすべて直す（制作者が覚えさせた、ほかの語と紛れない読み）。
 */
export function applyReadingDict(reading: string, narration: string): string {
  let r = String(reading || '');
  const narr = String(narration || '');
  if (!r) return r;
  for (const e of getReadingDict()) {
    const wrongs = e.wrong.slice().sort((a, b) => b.length - a.length);
    if (!wrongs.length) continue;
    if (!e.word) {
      for (const w of wrongs) r = r.split(w).join(e.reading);
      continue;
    }
    const pos = allIndexes(narr, e.word);
    if (!pos.length) continue;
    // 候補：間違った読みの出現位置（長いものを先に取り、重なる短いものは除く）
    const cands: { at: number; len: number }[] = [];
    for (const w of wrongs) {
      for (const at of allIndexes(r, w)) {
        if (cands.some((c) => at < c.at + c.len && c.at < at + w.length)) continue;
        cands.push({ at, len: w.length });
      }
    }
    if (!cands.length) continue;
    const used = new Set<number>();
    const picks: { at: number; len: number }[] = [];
    for (const p of pos) {
      const rel = p / Math.max(1, narr.length);
      let best = -1, bestD = Infinity;
      cands.forEach((c, i) => {
        if (used.has(i)) return;
        const d = Math.abs(c.at / Math.max(1, r.length) - rel);
        if (d < bestD) { bestD = d; best = i; }
      });
      if (best >= 0 && bestD <= 0.35) { used.add(best); picks.push(cands[best]); }
    }
    picks.sort((a, b) => b.at - a.at).forEach((c) => { r = r.slice(0, c.at) + e.reading + r.slice(c.at + c.len); });
  }
  return r;
}

/** ナレーション（漢字の文）を音声合成へそのまま渡すときに、辞書の語を読み（ひらがな）に置き換える */
export function applyReadingDictToText(text: string): string {
  let s = String(text || '');
  const list = getReadingDict().filter((e) => e.word).sort((a, b) => b.word.length - a.word.length);
  for (const e of list) s = s.split(e.word).join(e.reading);
  return s;
}

const isPunct = (c: string | undefined) => !c || /[、。，．\s]/.test(c);

/**
 * 読み上げ文を手で直したとき、直した部分から辞書の項目を推定する。
 * 直す前と後の共通の前後を除いた差分を、前後1文字ずつ（句読点の手前まで）広げて「間違った読み→正しい読み」とし、
 * ナレーションの同じあたりにある漢字の語（送りがな込み）を語の候補にする。推定できなければnull。
 */
export function learnFromReadingEdit(before: string, after: string, narration: string): ReadingEntry | null {
  const a = String(before || ''), b = String(after || '');
  if (!a || !b || a === b) return null;
  let L = 0;
  while (L < a.length && L < b.length && a[L] === b[L]) L++;
  let R = 0;
  while (R < a.length - L && R < b.length - L && a[a.length - 1 - R] === b[b.length - 1 - R]) R++;
  let s = L, ea = a.length - R, eb = b.length - R;
  if (ea - s > 12 || eb - s > 12) return null; // 大きく書き換えた場合は読み方の直しとみなさない
  // 前に1文字広げ（句読点は含めない）、4文字に満たなければ後ろにも広げる
  if (s > 0 && !isPunct(a[s - 1])) s--;
  for (let k = 0; k < 2 && Math.max(ea - s, eb - s) < 4; k++) {
    if (ea < a.length && !isPunct(a[ea])) { ea++; eb++; } else if (s > 0 && !isPunct(a[s - 1])) s--;
  }
  const wrong = a.slice(s, ea), right = b.slice(s, eb);
  if (!kanaOnly(wrong) || !kanaOnly(right) || wrong === right) return null;
  // 語の候補：ナレーション中の「漢字の並び＋送りがな」。送りがなは正しい読みの末尾と一致する分だけ含める
  const narr = String(narration || '');
  const rel = s / Math.max(1, a.length);
  let best = '', bestD = Infinity;
  const re = /[一-龯々〆ヶ]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(narr))) {
    const tail = narr.slice(m.index + m[0].length).match(/^[ぁ-ゖ]{0,3}/)?.[0] || '';
    let oku = '';
    for (let n = tail.length; n > 0; n--) if (right.endsWith(tail.slice(0, n))) { oku = tail.slice(0, n); break; }
    const d = Math.abs(m.index / Math.max(1, narr.length) - rel);
    if (d < bestD) { bestD = d; best = m[0] + oku; }
  }
  const word = bestD <= 0.3 && best.length <= 8 ? best : '';
  return { word, reading: right, wrong: [wrong], user: true };
}

// ---- 保存・読み込み ----
type BaseUrlFn = () => string;
let loading: Promise<ReadingEntry[]> | null = null;

/** 辞書を読み込む（TTSサーバー→だめならlocalStorage）。何度呼んでも1回だけ読み込む */
export function loadReadingDict(baseUrl: BaseUrlFn): Promise<ReadingEntry[]> {
  if (loading) return loading;
  loading = (async () => {
    let list: any[] | null = null;
    try {
      const res = await fetch(`${baseUrl()}/api/reading-dict`);
      if (res.ok) { const j = await res.json(); if (Array.isArray(j)) list = j; }
    } catch { /* サーバーが古い・止まっている */ }
    if (!list) { try { const v = JSON.parse(localStorage.getItem(LS_KEY) || '[]'); if (Array.isArray(v)) list = v; } catch { /* ignore */ } }
    else { try { localStorage.setItem(LS_KEY, JSON.stringify(list)); } catch { /* ignore */ } }
    setUserReadings(list || []);
    return getUserReadings();
  })();
  return loading;
}

/** 辞書を保存する（TTSサーバーとlocalStorageの両方） */
export async function saveReadingDict(baseUrl: BaseUrlFn): Promise<boolean> {
  const list = getUserReadings().map(({ word, reading, wrong }) => ({ word, reading, wrong }));
  try { localStorage.setItem(LS_KEY, JSON.stringify(list)); } catch { /* ignore */ }
  try {
    const res = await fetch(`${baseUrl()}/api/reading-dict`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(list) });
    return res.ok;
  } catch { return false; }
}
