// 週次レポート（「年100万円投資で1億円を目指すチャンネル」）：大和コネクト証券のスクショ（毎週取り込み）から、
// 今週の資産状況（評価額・前週比・銘柄別の値動き・今月の買い付け・目標の達成率）を組み立て、
// ①AIに渡す「今週の数字」（台本の雑感・トピックスと矛盾しないように）と、②実データの固定場面（AIに作文させない）を作る。
export const WEEKLY_CHANNEL = '年100万円投資で1億円を目指すチャンネル';
export const WEEKLY_GOAL = 100_000_000;
/** 週次レポートの口調（AIへの指示） */
export const WEEKLY_PERSONA = '30代の個人投資家が、自分の口座を毎週報告する語り口。くだけすぎない話し言葉で、相場や話題にはやや辛口に本音でコメントする（煽らない・断定しすぎない・売買の推奨はしない）。';

export type Snapshot = { date: string; items: Record<string, number> };
export interface Purchase { name: string; amount: number }
export interface WeeklyRow { name: string; short: string; value: number; prev: number | null; buy: number; change: number | null; pct: number | null }
export interface WeeklyData { asOf: string; prevDate: string | null; rows: WeeklyRow[]; total: number; prevTotal: number | null; buyTotal: number; change: number | null; pct: number | null; goal: number }

/** 動画で読みやすい短い銘柄名 */
export function shortFundName(name: string): string {
  const n = String(name || '').normalize('NFKC');
  const lev = /レバレッジ|レバ|ブル/.test(n);
  if (/FANG/i.test(n)) return lev ? 'FANG+レバレッジ' : 'FANG+';
  if (/NASDAQ|ナスダック/i.test(n)) return lev ? 'NASDAQ100レバレッジ' : 'NASDAQ100';
  if (/S&P\s*500|米国株式/i.test(n)) return 'S&P500';
  if (/TOPIX|国内株式/i.test(n)) return 'TOPIX';
  if (/日経|225/.test(n)) return lev ? '日経レバ' : '日経225';
  if (/金|ゴールド|GOLD/i.test(n)) return '金';
  return Array.from(n.replace(/^(eMAXIS Slim|iFreeNEXT|iFree|NEXT FUNDS|NF)\s*/i, '')).slice(0, 12).join('');
}

/** 買い付けの銘柄名（手入力）を保有銘柄に当てはめる：同じ名前、なければ短い名前・部分一致 */
function matchHolding(input: string, names: string[]): string | null {
  const t = String(input || '').normalize('NFKC').trim().toLowerCase();
  if (!t) return null;
  const exact = names.find((n) => n.normalize('NFKC').toLowerCase() === t);
  if (exact) return exact;
  const short = names.find((n) => shortFundName(n).toLowerCase() === t);
  if (short) return short;
  return names.find((n) => n.normalize('NFKC').toLowerCase().includes(t) || t.includes(shortFundName(n).toLowerCase())) ?? null;
}

/** 「銘柄名 金額」を1行ずつ書いた買い付けを読む（例：「S&P500 30000」「金 2万円」） */
export function parsePurchases(text: string): Purchase[] {
  const out: Purchase[] = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.normalize('NFKC').trim().match(/^(.+?)[\s:：,、]+([\d,]+(?:\.\d+)?)\s*(万)?\s*円?$/);
    if (!m) continue;
    const amount = Number(m[2].replace(/,/g, '')) * (m[3] ? 10000 : 1);
    if (amount > 0) out.push({ name: m[1].trim(), amount });
  }
  return out;
}

/**
 * 今週の資産状況。最新のスクショ（今週）と、その5日以上前で最後のスクショ（前週）を比べる。
 * 銘柄の値動き（円）＝評価額の差−その週の買い付け額（買った分を値上がりと取り違えないように）。
 */
export function buildWeeklyData(snapshots: Snapshot[], purchases: Purchase[] = [], goal = WEEKLY_GOAL): WeeklyData | null {
  const list = [...(snapshots || [])].sort((a, b) => a.date.localeCompare(b.date));
  const cur = list[list.length - 1];
  if (!cur) return null;
  const limit = new Date(`${cur.date}T00:00:00Z`); limit.setUTCDate(limit.getUTCDate() - 5);
  const prev = [...list].reverse().find((s) => s.date <= limit.toISOString().slice(0, 10)) ?? null;
  const names = [...new Set([...Object.keys(cur.items), ...(prev ? Object.keys(prev.items) : [])])];
  const buyOf: Record<string, number> = {};
  for (const p of purchases) { const n = matchHolding(p.name, names); if (n) buyOf[n] = (buyOf[n] ?? 0) + p.amount; }
  const rows: WeeklyRow[] = names.map((name) => {
    const value = cur.items[name] ?? 0;
    const pv = prev ? (prev.items[name] ?? 0) : null;
    const buy = buyOf[name] ?? 0;
    const change = pv != null ? value - pv - buy : null;
    const base = pv != null ? pv + buy : 0;
    return { name, short: shortFundName(name), value, prev: pv, buy, change, pct: change != null && base > 0 ? (change / base) * 100 : null };
  }).filter((r) => r.value > 0 || (r.prev ?? 0) > 0).sort((a, b) => b.value - a.value);
  const total = rows.reduce((s, r) => s + r.value, 0);
  const prevTotal = prev ? rows.reduce((s, r) => s + (r.prev ?? 0), 0) : null;
  const buyTotal = rows.reduce((s, r) => s + r.buy, 0);
  const change = prevTotal != null ? total - prevTotal - buyTotal : null;
  const pct = change != null && prevTotal! + buyTotal > 0 ? (change / (prevTotal! + buyTotal)) * 100 : null;
  return { asOf: cur.date, prevDate: prev?.date ?? null, rows, total, prevTotal, buyTotal, change, pct, goal };
}

/** 円の金額を「112万1460円」の形に（動画のナレーション用） */
export function yenJp(v: number): string {
  const sign = v < 0 ? 'マイナス' : '';
  const a = Math.round(Math.abs(v));
  const man = Math.floor(a / 10000), rest = a % 10000;
  return `${sign}${man ? `${man}万` : ''}${rest || !man ? rest : ''}円`;
}
export const signed = (v: number, f: (x: number) => string) => `${v > 0 ? 'プラス' : v < 0 ? 'マイナス' : ''}${f(Math.abs(v))}`;
export const pct1 = (v: number) => `${Math.abs(v).toFixed(1)}%`;
export const md = (iso: string) => `${Number(iso.slice(5, 7))}月${Number(iso.slice(8, 10))}日`;

/** AIに渡す「今週の数字」（台本の雑感が実際の数字と食い違わないように） */
export function weeklyFactsText(d: WeeklyData, purchases: Purchase[]): string {
  const lines = [`【今週の資産状況（${md(d.asOf)}時点、大和コネクト証券のスクショ）】`, `評価額の合計：${yenJp(d.total)}`];
  if (d.change != null && d.prevDate) lines.push(`前週（${md(d.prevDate)}）比：${signed(d.change, (x) => yenJp(x))}（${signed(d.pct ?? 0, pct1)}）※買い付けた分を除いた値動き`);
  for (const r of d.rows) lines.push(`・${r.short}（${r.name}）：${yenJp(r.value)}${r.pct != null ? `、今週${signed(r.pct, pct1)}` : ''}${r.buy ? `、今週${yenJp(r.buy)}買い付け` : ''}`);
  if (purchases.length) lines.push(`今月の買い付け：${purchases.map((p) => `${p.name} ${yenJp(p.amount)}`).join('、')}（合計${yenJp(purchases.reduce((s, p) => s + p.amount, 0))}）`);
  lines.push(`目標1億円に対する達成率：${((d.total / d.goal) * 100).toFixed(2)}%`);
  return lines.join('\n');
}

