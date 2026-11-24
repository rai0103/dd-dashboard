// スライドの文から、人物名・建物名・地名・組織名らしい語（固有名詞）を簡易に見つける。
// 「Web画像検索」ボタンを目立たせる・検索語の候補を出すためのもので、厳密さは求めない
// （検索画面を開いたときはAIでも抜き出す。lib/explainer/aiScript.ts の extractImageSearchNames）。
// テスト：lib/explainer/properNouns.test.ts

/** 語の後ろに付くと固有名詞らしい言葉（人物の肩書き・建物・地名） */
const SUFFIXES = [
  '氏', '首相', '大統領', '副大統領', '総裁', '議長', '社長', '会長', '知事', '市長', '大臣', '長官', '議員', '選手', '監督', '教授', '博士', '国王', '女王', '皇太子', '王子', 'CEO',
  '駅', '城', '寺', '神社', '大社', '神宮', 'タワー', 'ビル', '橋', '空港', '宮殿', '大聖堂', '美術館', '博物館', '公園', 'スタジアム', 'ドーム', '本社', '工場', '庁舎', '議事堂',
  '県', '州', '島', '山', '湖', '湾', '港', '半島', '海峡', '銀行', '証券', '電機', '自動車', '製作所',
];
/** よく出る一般的なカタカナ語（固有名詞ではない） */
const KATAKANA_STOP = new Set([
  'インフレ', 'デフレ', 'リスク', 'ポイント', 'データ', 'グラフ', 'ニュース', 'マーケット', 'トレンド', 'チャート', 'ドル', 'ユーロ', 'パーセント', 'ランキング', 'シェア', 'ビジネス',
  'サービス', 'システム', 'エネルギー', 'テクノロジー', 'イメージ', 'ケース', 'プラス', 'マイナス', 'レベル', 'ペース', 'スピード', 'ショック', 'バブル', 'ファンド', 'メリット', 'デメリット',
  'ドローダウン', 'リターン', 'ポートフォリオ', 'インデックス', 'セクター', 'トップ', 'チャンネル', 'ルール', 'スライド', 'テーマ', 'コスト', 'リスト', 'グループ', 'メーカー', 'ブランド',
  'サプライチェーン', 'サプライ', 'チェーン', 'ニーズ', 'ユーザー', 'モデル', 'プラン', 'プロジェクト', 'ターゲット', 'タイミング', 'バランス', 'ボーナス', 'ローン', 'クレジット', 'カード',
  'ゼロ', 'ピーク', 'ボトム', 'サイクル', 'シナリオ', 'リーダー', 'メディア', 'ネット', 'オンライン', 'デジタル', 'アプリ', 'ソフト', 'ハード', 'エリア', 'センター', 'スタート', 'ゴール',
]);
/** 固有名詞ではない英字の略語 */
const LATIN_STOP = new Set(['GDP', 'ETF', 'CPI', 'PPI', 'FRB', 'FOMC', 'ATH', 'MDD', 'RSI', 'PER', 'PBR', 'EPS', 'ROE', 'IPO', 'AI', 'USD', 'JPY', 'EUR', 'DD', 'YTD', 'CEO', 'CFO', 'NISA', 'iDeCo', 'IT', 'EV', 'OK', 'NG', 'Q1', 'Q2', 'Q3', 'Q4']);

const uniq = (a: string[]) => Array.from(new Set(a.filter(Boolean)));

/** 文の中の固有名詞らしい語を、見つかった順に返す（最大maxCount個） */
export function findProperNouns(texts: string[], maxCount = 6): string[] {
  const s = texts.filter(Boolean).join('　');
  const out: string[] = [];
  // ①肩書き・建物・地名の言葉が後ろに付く語（例：トランプ大統領、ドイツ銀行、東京タワー、富士山）
  const suf = SUFFIXES.slice().sort((a, b) => b.length - a.length).map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const reSuf = new RegExp(`([一-龯々ァ-ヶーA-Za-z・]{1,12}?)(${suf})(?![一-龯ァ-ヶ])`, 'g');
  for (const m of s.matchAll(reSuf)) {
    const head = m[1].replace(/^[のはがをにでと・]+/, '');
    if (!head || /^[ぁ-ゖ]+$/.test(head)) continue;
    if (KATAKANA_STOP.has(head)) continue;
    out.push(head + m[2]);
  }
  // ②3文字以上のカタカナ語（一般的な語は除く。例：ドイツ、ワシントン、エヌビディア）
  for (const m of s.matchAll(/[ァ-ヶ][ァ-ヶー・]{2,}/g)) {
    const w = m[0].replace(/・+$/, '');
    if (KATAKANA_STOP.has(w) || [...KATAKANA_STOP].some((x) => w === x + 'ー')) continue;
    if (out.some((o) => o.includes(w))) continue;
    out.push(w);
  }
  // ③英字の固有名詞（大文字で始まる語。一般的な略語は除く。例：Deutsche Bank、NVIDIA、Apple）
  for (const m of s.matchAll(/\b[A-Z][A-Za-z&.'-]+(?:\s+[A-Z][A-Za-z&.'-]+)*/g)) {
    const w = m[0].trim();
    if (LATIN_STOP.has(w) || w.length < 3) continue;
    out.push(w);
  }
  return uniq(out).slice(0, maxCount);
}
