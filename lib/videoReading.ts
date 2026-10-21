// 読み上げ用のひらがな文を生成する（表示用の字幕とは別）

const DIGIT: Record<string, string> = {
  '0': 'ぜろ', '1': 'いち', '2': 'に', '3': 'さん', '4': 'よん',
  '5': 'ご', '6': 'ろく', '7': 'なな', '8': 'はち', '9': 'きゅう',
};

// 4桁未満の整数（1〜9999）を読む
function under10000(n: number): string {
  const sen = Math.floor(n / 1000);
  const hyaku = Math.floor((n % 1000) / 100);
  const jyu = Math.floor((n % 100) / 10);
  const one = n % 10;
  let s = '';
  if (sen) s += sen === 1 ? 'せん' : sen === 3 ? 'さんぜん' : sen === 8 ? 'はっせん' : `${DIGIT[sen]}せん`;
  if (hyaku) s += hyaku === 1 ? 'ひゃく' : hyaku === 3 ? 'さんびゃく' : hyaku === 6 ? 'ろっぴゃく' : hyaku === 8 ? 'はっぴゃく' : `${DIGIT[hyaku]}ひゃく`;
  if (jyu) s += jyu === 1 ? 'じゅう' : `${DIGIT[jyu]}じゅう`;
  if (one) s += DIGIT[one];
  return s;
}

/** 整数を読む（億・万の区切り対応）。counter4 が true のとき 4 を「よ」で読む（円・年用） */
export function integerToKana(n: number, yoForFour = false): string {
  const v = Math.round(n);
  if (v === 0) return 'ぜろ';
  const oku = Math.floor(v / 100000000);
  const man = Math.floor((v % 100000000) / 10000);
  const rest = v % 10000;
  let s = '';
  if (oku) s += `${under10000(oku)}おく`;
  if (man) s += `${man === 1 && !oku ? 'いち' : under10000(man)}まん`;
  if (rest) s += under10000(rest);
  if (yoForFour && s.endsWith('よん')) s = s.slice(0, -2) + 'よ';
  return s;
}

/** 数値文字列（"1.9" など小数含む）を読む */
export function numberStringToKana(text: string): string {
  const [i, d] = text.split('.');
  const iv = parseInt(i, 10);
  let s = iv === 0 ? 'れい' : integerToKana(iv); // 0.7倍 → 「れいてんななばい」
  if (d) {
    const digits = d.split('').map(ch => DIGIT[ch] ?? ch).join('');
    // 2桁以上は「じゅうてん（十点）」「にじゅってん」などに誤読されるので、小数点の前後に短い間を入れる
    s += iv >= 10 ? `、てん、${digits}` : `てん${digits}`;
  }
  return s;
}

export const amountToKana = (n: number): string => `${integerToKana(n, true)}えん`;

export function yearsToKana(y: number): string {
  if (y === 7) return 'ななねん';
  if (y === 9) return 'きゅうねん';
  const base = integerToKana(y, true);
  return `${base}ねん`;
}

const LETTER: Record<string, string> = {
  A: 'えー', B: 'びー', C: 'しー', D: 'でぃー', E: 'いー', F: 'えふ', G: 'じー', H: 'えいち',
  I: 'あい', J: 'じぇー', K: 'けー', L: 'える', M: 'えむ', N: 'えぬ', O: 'おー', P: 'ぴー',
  Q: 'きゅー', R: 'あーる', S: 'えす', T: 'てぃー', U: 'ゆー', V: 'ぶい', W: 'だぶりゅー',
  X: 'えっくす', Y: 'わい', Z: 'ぜっと',
};

// 読み慣れた銘柄の通称（ひらがな）
const TICKER_KANA: Record<string, string> = {
  SOXL: 'そくせる', SOXS: 'そっくす', SOXX: 'そっくす', TECL: 'てくる', TECS: 'てっくす',
  TQQQ: 'てぃーきゅーきゅーきゅー', SQQQ: 'えすきゅーきゅーきゅー', QQQ: 'きゅーきゅーきゅー',
  SPXL: 'えすぴーえっくすえる', SPY: 'えすぴーわい', SPUU: 'えすぴーゆーゆー', UPRO: 'あっぷろ',
  TSLA: 'てすら', TESLA: 'てすら', NVDA: 'えぬびでぃあ', AAPL: 'あっぷる', MSFT: 'まいくろそふと',
  AMZN: 'あまぞん', GOOGL: 'ぐーぐる', META: 'めた', VOO: 'ぶいおーおー', VTI: 'ぶいてぃーあい',
  FNGU: 'ふぁんぐ', LABU: 'らぶ', TNA: 'てぃーえぬえー', FAS: 'ふぁす',
};

export function tickerToKana(ticker: string): string {
  // 括弧（）()とその中身は読み上げない（字幕にだけ表示する補足）
  const t = ticker.replace(/[（(][^）)]*[）)]/g, '').trim();
  if (TICKER_KANA[t.toUpperCase()]) return TICKER_KANA[t.toUpperCase()];
  // 英数字の連続は読みに変換（登録がなければ一文字ずつ読む）、カタカナはひらがなに。
  // 漢字・ひらがななど、それ以外はそのまま残す
  return t.replace(/[A-Za-z0-9.\-]+|[\u30A1-\u30F6]+/g, (m) => {
    if (/^[\u30A1-\u30F6]+$/.test(m)) {
      return m.replace(/[\u30A1-\u30F6]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
    }
    const up = m.toUpperCase();
    if (TICKER_KANA[up]) return TICKER_KANA[up];
    return up.split('').map(ch => LETTER[ch] ?? DIGIT[ch] ?? '').join('');
  });
}

const FREQUENCY_KANA: Record<string, string> = { '毎日': 'まいにち', '毎月': 'まいつき', '毎年': 'まいとし' };

export interface ReadingInput {
  // 2銘柄比較（指定時は比較用の文になる）
  ticker2?: string;
  finalEvaluation2?: number;
  multiplier2?: string;
  method: 'lump' | 'daily' | 'monthly' | 'yearly';
  frequency: string;          // '' / '毎日' / '毎月' / '毎年'
  ticker: string;
  years: number;
  amount: number;
  finalEvaluation: number;
  totalInvested: number;
  multiplier: string;         // formatMultiplier の結果（"1.9" / "875"）
}

/** オープニングの読み（ひらがな） */
export function buildOpeningReading(i: ReadingInput): string {
  const t = tickerToKana(i.ticker);
  if (i.ticker2) {
    return `${yearsToKana(i.years)}まえに、${t}と、${tickerToKana(i.ticker2)}に、それぞれ、${amountToKana(i.amount)}を、いっかつとうししていたら、、、`;
  }
  if (i.method === 'lump') {
    return `${yearsToKana(i.years)}まえに、${t}に、${amountToKana(i.amount)}を、いっかつとうししていたら、、、`;
  }
  return `${yearsToKana(i.years)}まえから、${t}に、${FREQUENCY_KANA[i.frequency] ?? ''}${amountToKana(i.amount)}を、つみたてとうししていたら、、、`;
}

/** エンディングの読み（ひらがな） */
export function buildEndingReading(i: ReadingInput): string {
  if (i.ticker2) {
    const a = `${tickerToKana(i.ticker)}は、${amountToKana(i.finalEvaluation)}、${numberStringToKana(i.multiplier)}ばい`;
    const b = `${tickerToKana(i.ticker2)}は、${amountToKana(i.finalEvaluation2 ?? 0)}、${numberStringToKana(i.multiplier2 ?? '0')}ばい`;
    return `${a}、${b}になりました。あなたはいま、なにをかいますか？`;
  }
  const evalK = amountToKana(i.finalEvaluation);
  const mult = `${numberStringToKana(i.multiplier)}ばい`;
  if (i.method === 'lump') {
    return `${evalK}、${mult}になりました。あなたはいま、なにをかいますか？`;
  }
  return `とうしそうがく${amountToKana(i.totalInvested)}が、${evalK}、${mult}になりました。あなたはいま、なにをかいますか？`;
}

/** 年比較：オープニングの字幕（行ごと） */
export function yearOpeningLines(curYear: number, setName: string, indexName = 'S&P500'): string[] {
  const nm = setName.endsWith('年') ? `${setName}の` : `${setName}の年の`;
  return [`${curYear}年と`, nm, `${indexName}のチャートを`, '比較すると・・'];
}

/** 年比較：オープニングの読み（ひらがな） */
export function buildYearOpeningReading(curYear: number, setName: string, setReading?: string, indexKana = 'えすあんどぴーごひゃく'): string {
  const nm = (setReading && setReading.trim()) || setName;
  const tail = nm.endsWith('年') || nm.endsWith('とし') || nm.endsWith('ねん') ? `${nm}の` : `${nm}のとしの`;
  return `${yearsToKana(curYear).replace(/ねん$/, '')}ねんと、${tail}、${indexKana}の、ちゃーとを、ひかくすると、、、`;
}

/** 年比較：エンディングの読み（ひらがな） */
export function buildYearEndingReading(curYear: number, indexKana = 'えすあんどぴーごひゃく'): string {
  return `あなたは、${yearsToKana(curYear).replace(/ねん$/, '')}ねんまつの、${indexKana}は、どうなるとおもいますか？`;
}

/** 年比較＋企業：オープニングの字幕（行ごと） */
export function yearCoOpeningLines(co: string, indexName: string, setName: string): string[] {
  const nm = setName.endsWith('年') ? `${setName}の` : `${setName}の年の`;
  return [`${co}と`, `${indexName}の`, nm, '値動きを比較すると・・'];
}

/** 年比較＋企業：オープニングの読み（ひらがな） */
export function buildYearCoOpeningReading(co: string, indexKana: string, setName: string, setReading?: string): string {
  const nm = (setReading && setReading.trim()) || setName;
  const tail = nm.endsWith('年') || nm.endsWith('とし') || nm.endsWith('ねん') ? `${nm}の` : `${nm}のとしの`;
  return `${tickerToKana(co)}と、${indexKana}の、${tail}、おなじとしの、うごきを、ひかくすると、、、`;
}

/** 年比較＋企業：エンディングの読み（ひらがな） */
export function buildYearCoEndingReading(curYear: number, co: string): string {
  return `あなたは、${yearsToKana(curYear).replace(/ねん$/, '')}ねんまつの、${tickerToKana(co)}は、どうなるとおもいますか？`;
}
