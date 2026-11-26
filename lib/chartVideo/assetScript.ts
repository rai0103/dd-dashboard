// [グラフ動画] 資産形成レポートの場面（どのグラフを、どんな順番で見せるか）と台本。
// 場面の数字はすべて lib/chartVideo/assetReport.ts が作る。台本は、まず決まった文（定型文）で作り、
// 「AIで台本を作る」を押すと、同じ数字だけを使って語り口を整えた台本（ナレーション＋読み上げ文）に置き換える。
import { callTool } from '../explainer/aiClient';
import { sanitizeReading } from '../explainer/scriptModel';
import { WEEKLY_PERSONA, yenJp, signed, pct1, md } from '../explainer/weeklyReportCore';
import type { AssetReport } from './assetReport';

export type CVKind = 'title' | 'rules' | 'stats' | 'value' | 'stack' | 'share' | 'holdings' | 'plan' | 'road' | 'outro';
export type CVFormat = 'long' | 'short';
export interface CVScene {
  key: string;
  kind: CVKind;
  /** 画面の見出し */
  heading: string;
  narration: string;
  /** 読み上げ文（ひらがな）。空ならナレーションをそのまま読む */
  reading: string;
  /** 映像として最低限必要な秒数 */
  minSec: number;
  /** この場面を使うか */
  enabled: boolean;
}
export interface CVYoutube { title: string; description: string; tags: string[]; shortTitle: string }
/** version：場面の構成・定型文の作り方を変えたら上げる（古い台本は今の数字・構成で作り直す） */
export const CV_PROJECT_VERSION = 2;
export interface CVProject { report: 'asset'; version?: number; asOf: string; long: CVScene[]; short: CVScene[]; youtube: CVYoutube }

const pctTxt = (v: number, d = 1) => `${v >= 0 ? 'プラス' : 'マイナス'}${Math.abs(v).toFixed(d)}%`;
const ratePct = (r: number) => `${(r * 100).toFixed(1)}%`;
const ymJp = (ym: string) => `${Number(ym.slice(0, 4))}年${Number(ym.slice(5, 7))}月`;

/** 場面ごとに、AIへ渡す「使ってよい数字」と、定型文 */
function sceneFacts(r: AssetReport, kind: CVKind): { facts: string; text: string } {
  const top = r.holdings[0];
  const totalH = r.holdings.reduce((s, h) => s + h.value, 0);
  switch (kind) {
    case 'title':
      return {
        facts: `チャンネル名：${r.channel}／基準日：${md(r.asOf)}（${r.asOf.slice(0, 4)}年）`,
        text: `${r.channel}、資産形成レポートです。${md(r.asOf)}時点の口座の状況を、グラフで見ていきます。`,
      };
    case 'rules':
      return {
        facts: `ルール：${ymJp(r.rules.startYm)}スタート、初期費用${yenJp(r.rules.initial)}＋毎月${yenJp(r.rules.monthly)}＋6月・12月は各${yenJp(r.rules.bonus)}（年100万円）／目標：${r.rules.targetYears}年で${yenJp(r.rules.goal)}／目標に必要な年率：${ratePct(r.road.rate)}`,
        text: `このチャンネルのルールです。${ymJp(r.rules.startYm)}に${yenJp(r.rules.initial)}でスタートし、毎月${yenJp(r.rules.monthly)}、6月と12月は${yenJp(r.rules.bonus)}ずつ追加して、年100万円を積み立てます。目標は${r.rules.targetYears}年で1億円。そのために必要な年率は、およそ${ratePct(r.road.rate)}です。`,
      };
    case 'stats': {
      const wk = r.weekly ? `前回（${md(r.weekly.prevDate)}）からの値動きは${signed(r.weekly.change, yenJp)}${r.weekly.pct != null ? `（${pctTxt(r.weekly.pct)}）` : ''}。` : '';
      return {
        facts: `評価額：${yenJp(r.value)}／元本：${yenJp(r.principal)}／評価損益：${signed(r.pl, yenJp)}（${pctTxt(r.plPct)}）／1億円の達成率：${r.goalPct.toFixed(2)}%${r.monthPct != null ? `／月初から：${pctTxt(r.monthPct)}` : ''}${r.yearPct != null ? `／年初から：${pctTxt(r.yearPct)}` : ''}${r.weekly ? `／前回（${md(r.weekly.prevDate)}）からの値動き：${signed(r.weekly.change, yenJp)}${r.weekly.pct != null ? `（${pctTxt(r.weekly.pct)}）` : ''}（買い付け分を除く）` : ''}`,
        text: `現在の評価額は${yenJp(r.value)}。元本${yenJp(r.principal)}に対して、評価損益は${signed(r.pl, yenJp)}、${pctTxt(r.plPct)}です。${wk}1億円の目標に対しては、${r.goalPct.toFixed(2)}%の地点です。`,
      };
    }
    case 'value': {
      const pts = r.points.filter((p) => p.value != null);
      const first = pts[0], peak = pts.reduce((a, b) => ((b.value ?? 0) > (a.value ?? 0) ? b : a), pts[0]);
      const above = r.pl >= 0;
      return {
        facts: `評価額の推移：${first ? `${md(first.date)} ${yenJp(first.value!)}` : ''}→最高 ${peak ? `${md(peak.date)} ${yenJp(peak.value!)}` : ''}→現在 ${yenJp(r.value)}／元本：${yenJp(r.principal)}／評価額は元本を${above ? '上回っている' : '下回っている'}`,
        text: `評価額と元本の推移です。緑の線が評価額、点線が元本です。${peak && peak.date !== r.asOf ? `${md(peak.date)}の${yenJp(peak.value!)}が、これまでの最高でした。` : ''}現在は評価額が元本を${above ? '上回っています' : '少し下回っています'}。`,
      };
    }
    case 'stack':
      return {
        facts: `銘柄の内訳（評価額）：${r.holdings.map((h) => `${h.short} ${yenJp(h.value)}（${totalH > 0 ? ((h.value / totalH) * 100).toFixed(0) : 0}%）`).join('、')}／スクショの無い月は推計`,
        text: top ? `銘柄ごとの内訳の推移です。いちばん大きいのは${top.short}で、全体の${totalH > 0 ? ((top.value / totalH) * 100).toFixed(0) : 0}%を占めています。` : '銘柄ごとの内訳の推移です。',
      };
    case 'share': {
      const sh = r.holdings.map((h) => ({ h, pct: totalH > 0 ? (h.value / totalH) * 100 : 0 }));
      const t3 = sh.slice(0, 3);
      return {
        facts: `今のシェア（評価額の割合）：${sh.map((x) => `${x.h.short} ${x.pct.toFixed(1)}%（${yenJp(x.h.value)}）`).join('、')}／合計 ${yenJp(totalH)}／${sh.length}銘柄`,
        text: t3.length ? `今の銘柄のシェアです。いちばん大きいのは${t3[0].h.short}で${t3[0].pct.toFixed(1)}%${t3[1] ? `、続いて${t3[1].h.short}が${t3[1].pct.toFixed(1)}%` : ''}${t3[2] ? `、${t3[2].h.short}が${t3[2].pct.toFixed(1)}%` : ''}です。全部で${sh.length}銘柄に分けて持っています。` : '今の銘柄のシェアです。',
      };
    }
    case 'holdings': {
      const withPct = r.holdings.filter((h) => h.pct != null);
      const best = withPct.length ? withPct.reduce((a, b) => (b.pct! > a.pct! ? b : a)) : null;
      const worst = withPct.length ? withPct.reduce((a, b) => (b.pct! < a.pct! ? b : a)) : null;
      return {
        facts: `銘柄別：${r.holdings.map((h) => `${h.short} ${yenJp(h.value)}${h.pct != null ? `（前回から${pctTxt(h.pct)}）` : ''}`).join('、')}`,
        text: `銘柄別の評価額です。${best && worst && best !== worst ? `前回からいちばん上がったのは${best.short}の${pctTxt(best.pct!)}、いちばん下がったのは${worst.short}の${pctTxt(worst.pct!)}でした。` : top ? `いちばん大きいのは${top.short}の${yenJp(top.value)}です。` : ''}`,
      };
    }
    case 'plan': {
      const last = r.plan.rows[r.plan.rows.length - 1];
      const actual = last?.actual ?? r.value;
      const diff = last ? actual - last.plan : 0;
      return {
        facts: `計画：年率${ratePct(r.plan.rate)}で運用した場合の${last ? ymJp(last.ym) : ''}末の評価額 ${last ? yenJp(last.plan) : '-'}／実績：${yenJp(actual)}／差：${signed(diff, yenJp)}`,
        text: last ? `計画との比較です。年率${ratePct(r.plan.rate)}で運用できていれば、今ごろ${yenJp(last.plan)}になっている計算です。実際は${yenJp(actual)}なので、計画を${diff >= 0 ? '上回って' : '下回って'}います。差は${yenJp(Math.abs(diff))}です。` : '計画との比較です。',
      };
    }
    case 'road': {
      const done = (r.road.nowMonth / r.road.months) * 100;
      const spx = r.road.spx;
      return {
        facts: `今は${r.road.nowMonth}か月目（${r.road.months}か月＝${r.rules.targetYears}年のうち${done.toFixed(1)}%）／必要な年率：${ratePct(r.road.rate)}${spx ? `／S&P500の${spx.period}の年率：${ratePct(spx.rate)}${spx.years ? `（この年率なら約${spx.years.toFixed(1)}年で1億円）` : ''}` : ''}`,
        text: `1億円までの道のりです。今は${r.road.nowMonth}か月目、${r.rules.targetYears}年のうちの${done.toFixed(1)}%の地点です。${spx && spx.years ? `S&P500の${spx.period}の平均、年率${ratePct(spx.rate)}で運用できれば、約${spx.years.toFixed(1)}年で1億円に届く計算です。` : ''}`,
      };
    }
    case 'outro':
      return {
        facts: '締め：次回の報告・チャンネル登録の呼びかけ。売買の推奨はしない',
        text: '今回のレポートは以上です。この挑戦の続きが気になる方は、チャンネル登録をしてお待ちください。投資の判断は、ご自身でお願いします。',
      };
  }
}

const HEADINGS: Record<CVKind, string> = {
  title: '資産形成レポート', rules: 'このチャンネルのルール', stats: '今の資産状況', value: '評価額と元本の推移',
  stack: '銘柄ごとの内訳の推移', share: '今の銘柄シェア', holdings: '銘柄別の評価額', plan: '計画との比較', road: '1億円までの道のり', outro: 'まとめ',
};
const MIN_SEC: Record<CVKind, number> = { title: 5, rules: 8, stats: 8, value: 9, stack: 9, share: 9, holdings: 8, plan: 8, road: 9, outro: 5 };
export const LONG_KINDS: CVKind[] = ['title', 'rules', 'stats', 'value', 'stack', 'share', 'holdings', 'plan', 'road', 'outro'];
export const SHORT_KINDS: CVKind[] = ['title', 'stats', 'value', 'share', 'road', 'outro'];

/** ショート用の短い定型文（60秒以内に収めるため） */
function shortText(r: AssetReport, k: CVKind): string | null {
  switch (k) {
    case 'title': return `${r.channel}、${md(r.asOf)}時点の資産状況です。`;
    case 'stats': return `評価額は${yenJp(r.value)}、損益は${signed(r.pl, yenJp)}。1億円まで${r.goalPct.toFixed(2)}%の地点です。`;
    case 'value': return `緑の線が評価額、点線が元本です。今は評価額が元本を${r.pl >= 0 ? '上回って' : '少し下回って'}います。`;
    case 'share': { const tot = r.holdings.reduce((a, h) => a + h.value, 0); const t = r.holdings[0]; return t && tot > 0 ? `いちばん多いのは${t.short}で、全体の${((t.value / tot) * 100).toFixed(1)}%です。` : null; }
    case 'road': return `今は${r.road.nowMonth}か月目。15年で1億円に必要な年率は、およそ${ratePct(r.road.rate)}です。`;
    case 'outro': return '続きは本編とチャンネル登録で。';
    default: return null;
  }
}

/** 定型文の台本で場面を作る（データが無い場面は使わない） */
export function buildAssetProject(r: AssetReport): CVProject {
  const usable = (k: CVKind) => (k === 'stack' ? r.stack.rows.length >= 2 : k === 'holdings' || k === 'share' ? r.holdings.length > 0 : k === 'value' ? r.points.filter((p) => p.value != null).length >= 2 : true);
  const mk = (fmt: CVFormat) => (k: CVKind): CVScene => {
    const f = sceneFacts(r, k);
    const text = fmt === 'short' ? shortText(r, k) ?? f.text : f.text;
    return { key: `${fmt}:${k}`, kind: k, heading: HEADINGS[k], narration: text, reading: '', minSec: fmt === 'short' ? Math.max(4, MIN_SEC[k] - 2) : MIN_SEC[k], enabled: usable(k) };
  };
  return {
    report: 'asset', version: CV_PROJECT_VERSION, asOf: r.asOf,
    long: LONG_KINDS.map(mk('long')),
    short: SHORT_KINDS.map(mk('short')),
    youtube: {
      title: `【資産形成レポート】年100万円で1億円を目指す｜${md(r.asOf)}時点 評価額${yenJp(r.value)}`,
      description: `${r.channel}の資産形成レポートです（${r.asOf}時点）。\n評価額：${yenJp(r.value)}／元本：${yenJp(r.principal)}／評価損益：${signed(r.pl, yenJp)}（${pctTxt(r.plPct)}）\n※投資の判断はご自身でお願いします。`,
      tags: ['資産形成', '新NISA', 'インデックス投資', '積立投資', '1億円'],
      shortTitle: `評価額${yenJp(r.value)}｜年100万円で1億円への道 #shorts`,
    },
  };
}

/** 数字が変わったとき：場面の並び・有効無効は保ったまま、数字の入った定型文だけ作り直す */
export function refreshFacts(prev: CVProject, r: AssetReport): CVProject {
  const fresh = buildAssetProject(r);
  const merge = (a: CVScene[], b: CVScene[]) => b.map((s) => { const o = a.find((x) => x.key === s.key); return o ? { ...s, enabled: o.enabled && s.enabled, heading: o.heading } : s; });
  return { ...fresh, long: merge(prev.long, fresh.long), short: merge(prev.short, fresh.short), youtube: prev.youtube.title ? { ...fresh.youtube } : fresh.youtube };
}

/** AIで台本（ナレーション・読み上げ文）とYouTubeの情報を作る。数字は場面ごとの「使ってよい数字」だけ */
export async function generateAssetScript(r: AssetReport, proj: CVProject, signal?: AbortSignal): Promise<CVProject> {
  const list = (fmt: CVFormat) => proj[fmt].filter((s) => s.enabled).map((s) => `- key=${s.key}（${s.heading}）：${sceneFacts(r, s.kind).facts}`).join('\n');
  const task = [
    `チャンネル「${r.channel}」の資産形成レポート動画（${r.asOf}時点）の台本を作ってください。グラフが動く動画で、場面ごとにナレーションを付けます。`,
    `語り口：${WEEKLY_PERSONA}`,
    '【長尺（横長・本編）の場面】1場面2〜4文（およそ60〜150字）。グラフの見どころ（どこを見ればよいか）を言葉で案内する。',
    list('long'),
    '【ショート（縦長・60秒以内）の場面】1場面1〜2文（およそ25〜60字）。最後は本編・チャンネル登録へ誘導する。',
    list('short'),
    'ルール：',
    '- 数字は、各場面に書いた数字だけを使う（計算し直したり、新しい数字を作ったりしない）。金額は「112万1460円」のように書く。',
    '- 売買の推奨・将来の断定はしない。煽らない。',
    '- reading は narration をひらがな・読点・句点だけで書いた読み上げ文（数字・記号・漢字・カタカナ・英字を使わない。数字は読み方どおりにひらがなで書く。%は「ぱーせんと」）。',
    '- youtube：title（全角40字以内・数字を1つ入れる）、description（3〜5行）、tags（5〜10個）、shortTitle（全角30字以内、末尾に #shorts）。',
  ].join('\n');
  const item = { type: 'object', properties: { key: { type: 'string' }, narration: { type: 'string' }, reading: { type: 'string' } }, required: ['key', 'narration', 'reading'] };
  const res = await callTool<any>({
    system: [{ type: 'text', text: 'あなたは投資系YouTubeチャンネルの台本作家です。与えられた数字だけを使い、正確に書きます。' }],
    content: [{ type: 'text', text: task }],
    toolName: 'asset_report_script',
    toolDescription: '資産形成レポート動画の場面ごとのナレーションと読み上げ文、YouTubeの情報を返す。',
    inputSchema: {
      type: 'object',
      properties: {
        scenes: { type: 'array', items: item },
        youtube: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } }, shortTitle: { type: 'string' } }, required: ['title', 'description', 'tags', 'shortTitle'] },
      },
      required: ['scenes', 'youtube'],
    },
    maxTokens: 6000,
    signal,
  });
  const got = new Map<string, any>((Array.isArray(res?.scenes) ? res.scenes : []).map((s: any) => [String(s?.key || ''), s]));
  const apply = (s: CVScene): CVScene => {
    const g = got.get(s.key);
    const narration = String(g?.narration || '').trim();
    if (!narration) return s;
    const rd = sanitizeReading(String(g?.reading || ''), narration);
    return { ...s, narration, reading: rd.ok ? rd.reading : '' };
  };
  const y = res?.youtube || {};
  return {
    ...proj,
    long: proj.long.map(apply),
    short: proj.short.map(apply),
    youtube: {
      title: String(y.title || proj.youtube.title).slice(0, 100),
      description: String(y.description || proj.youtube.description),
      tags: Array.isArray(y.tags) && y.tags.length ? y.tags.map(String).slice(0, 15) : proj.youtube.tags,
      shortTitle: String(y.shortTitle || proj.youtube.shortTitle).slice(0, 100),
    },
  };
}
