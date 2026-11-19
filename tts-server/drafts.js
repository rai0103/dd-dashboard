// 自動ドラフト生成（毎朝の予約実行）のデータを、PCのフォルダ（dd-dashboard/drafts/）で受け渡す。
// 自動運転用のChromeと普段のChromeはブラウザ内の保存領域が別なので、台本・画像はファイルで渡す。
const fs = require('fs').promises;
const path = require('path');
const { execFile } = require('child_process');

const ROOT = path.join(__dirname, '..', 'drafts');
const PENDING = path.join(ROOT, 'pending');
const IMPORTED = path.join(ROOT, 'imported');
const TASK_NAME = 'DDDashboard AutoDraft';
const DEFAULT_SCHEDULE = { enabled: true, count: 3, time: '03:30', keywords: [] };

const safe = (s) => String(s || '').replace(/[^a-zA-Z0-9_.-]/g, '_');
async function readJson(f, fb) { try { return JSON.parse(await fs.readFile(f, 'utf-8')); } catch { return fb; } }
async function writeJson(f, v) { await fs.mkdir(path.dirname(f), { recursive: true }); await fs.writeFile(f, JSON.stringify(v, null, 2), 'utf-8'); }
function readRaw(req) { return new Promise((resolve, reject) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => resolve(Buffer.concat(c))); req.on('error', reject); }); }
const send = (res, status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };

const HISTORY = path.join(ROOT, 'history.json');
const newHistId = () => `h-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
/**
 * 作ったテーマの記録。1件＝{ id, theme（シリーズのテーマ）, title（動画タイトル）, createdAt, mode, part（第何弾）, source, sequelOf, sequel（続編を作る印）}。
 * 以前の形式（テーマの文字列だけの配列）は、ドラフトの情報（タイトル・作成日）を補って新しい形式に直して保存し直す。
 */
async function readHistory() {
  const raw = await readJson(HISTORY, []);
  let changed = false;
  const metas = [];
  const out = [];
  for (const h of Array.isArray(raw) ? raw : []) {
    if (typeof h === 'string' || !h.id) {
      changed = true;
      const e = typeof h === 'string' ? { theme: h } : { ...h };
      if (!metas.length) {
        for (const dir of [PENDING, IMPORTED]) {
          let names = [];
          try { names = await fs.readdir(dir); } catch { /* 無い */ }
          for (const n of names) { const m = await readJson(path.join(dir, n, 'meta.json'), null); if (m) metas.push(m); }
        }
      }
      const m = metas.find((x) => x.theme === e.theme);
      out.push({ id: newHistId(), part: 1, source: 'auto', ...e, ...(m && !e.title ? { title: m.title } : {}), ...(m && !e.createdAt ? { createdAt: m.createdAt } : {}), ...(m && !e.mode ? { mode: m.mode === 'keyword' ? 'keyword' : 'news' } : {}), ...(m && !e.draftId ? { draftId: m.id } : {}) });
    } else out.push(h);
  }
  if (changed) await writeJson(HISTORY, out);
  return out;
}

const getSchedule = async () => ({ ...DEFAULT_SCHEDULE, ...(await readJson(path.join(ROOT, 'schedule.json'), {})) });

/** Windowsのタスクスケジューラに、毎日の自動実行を登録（オフなら解除）する。スリープ中でも起こして実行する */
function registerTask(s) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') { resolve({ ok: false, error: 'Windows専用' }); return; }
    const root = path.join(__dirname, '..');
    const script = s.enabled
      // 黒い画面（コンソール）を出さないよう、scripts/run-hidden.vbs 経由で node を実行する
      ? `$a = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument '"${root}\\scripts\\run-hidden.vbs" "${process.execPath}" "${root}\\scripts\\auto-draft.mjs"' -WorkingDirectory '${root}';` +
        `$t = New-ScheduledTaskTrigger -Daily -At '${s.time}';` +
        `$st = New-ScheduledTaskSettingsSet -WakeToRun -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 2);` +
        `$p = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive;` +
        `Register-ScheduledTask -TaskName '${TASK_NAME}' -Action $a -Trigger $t -Settings $st -Principal $p -Force | Out-Null`
      : `Unregister-ScheduledTask -TaskName '${TASK_NAME}' -Confirm:$false -ErrorAction SilentlyContinue`;
    execFile('powershell', ['-NoProfile', '-Command', script], { windowsHide: true }, (err, out, errOut) => resolve(err ? { ok: false, error: String(errOut || err.message).slice(0, 300) } : { ok: true }));
  });
}

async function listDrafts() {
  let names = [];
  try { names = await fs.readdir(PENDING); } catch { return []; }
  const out = [];
  for (const n of names) { const m = await readJson(path.join(PENDING, n, 'meta.json'), null); if (m) out.push(m); }
  return out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

/**
 * 取り込み済みのドラフト（drafts/imported）と、別の台本を開く前に自動で残した控え（backup-…）。新しい順に最大 limit 件。
 * dir＝フォルダ名（もう一度開くときに使う）、importedAt＝取り込んだ／控えを残した時刻
 */
async function listImported(limit = 15) {
  let names = [];
  try { names = await fs.readdir(IMPORTED); } catch { return []; }
  const out = [];
  for (const n of names) {
    const m = await readJson(path.join(IMPORTED, n, 'meta.json'), null);
    if (!m) continue;
    const t = Number((n.match(/-(\d{12,})$/) || [])[1]) || m.createdAt || 0;
    out.push({ ...m, dir: n, importedAt: t });
  }
  return out.sort((a, b) => (b.importedAt || 0) - (a.importedAt || 0)).slice(0, limit);
}
const draftDir = (u) => (u.searchParams.get('imported') ? path.join(IMPORTED, safe(u.searchParams.get('imported'))) : path.join(PENDING, safe(u.searchParams.get('draft'))));

const cleanLine = (l) => l.replace(/\*\*/g, '').replace(/^\s*(?:[-・*•]|[0-9０-９]{1,2}\s*[.．)）、])\s*/, '').replace(/^[「『]|[」』]$/g, '').trim();
const okTheme = (l) => l && l.length <= 40 && !/[:：]$/.test(l) && !/^(以下|次の|こちら|上記|※)/.test(l);

/**
 * 前日の話題のニュースから、解説動画のテーマ候補をGemini（Google検索）で集める。
 * genres（{label, hint}）を渡すと、ジャンルごとに候補を集め、[{ genre, theme }] も返す
 */
async function trending(researchWithGemini, n, exclude, genres) {
  const y = new Date(Date.now() - 86400000);
  const d = `${y.getFullYear()}年${y.getMonth() + 1}月${y.getDate()}日`;
  const ex = exclude.length ? `\n次の話題は過去に動画にしたので、同じ話題（言い方を変えたものも含む）は除いてください：${exclude.slice(-120).join('、')}` : '';
  if (Array.isArray(genres) && genres.length) {
    const uniq = [];
    for (const g of genres) if (g && g.label && !uniq.some((u) => u.label === g.label)) uniq.push(g);
    const per = Math.max(3, Math.ceil(n / uniq.length) + 2);
    const prompt = `${d}前後に話題になったニュースの中から、「ニュース・キーワード解説」のYouTube動画のテーマに向くものを、次のジャンルごとに${per}件ずつ挙げてください。最新のWeb情報で確認したものだけにしてください。\n${uniq.map((g) => `・${g.label}：${g.hint || ''}`).join('\n')}\n出力は1行に1件、「ジャンル名｜テーマ」の形（テーマは30字以内の日本語。例：日本経済｜日銀が政策金利を0.75%に引き上げ）。ジャンル名は上の名前をそのまま使ってください。番号・記号・説明・前置きは書かないでください。${ex}`;
    const r = await researchWithGemini(prompt);
    if (r.error && !r.text) throw new Error(r.error);
    const items = [];
    for (const raw of String(r.text || '').split(/\r?\n/)) {
      const l = cleanLine(raw);
      const m = l.match(/^(.+?)\s*[|｜]\s*(.+)$/);
      if (!m) continue;
      const g = uniq.find((u) => m[1].includes(u.label));
      const theme = cleanLine(m[2]);
      if (g && okTheme(theme)) items.push({ genre: g.label, theme });
    }
    return { themes: items.map((x) => x.theme), items };
  }
  const prompt = `${d}に日本で話題になったニュース（経済・金融・マーケット・ビジネス・テクノロジー・社会）の中から、「ニュース・キーワード解説」のYouTube動画のテーマに向くものを${n + 5}件挙げてください。最新のWeb情報で確認したものだけにしてください。\n出力は1行に1件、テーマだけ（30字以内の日本語。例：日銀が政策金利を0.75%に引き上げ）。番号・記号・説明・前置きは書かないでください。${ex}`;
  const r = await researchWithGemini(prompt);
  if (r.error && !r.text) throw new Error(r.error);
  return { themes: String(r.text || '').split(/\r?\n/).map(cleanLine).filter(okTheme), items: [] };
}

/** 処理したら true を返す */
async function handleDrafts(req, res, pathname, deps) {
  if (pathname !== '/api/drafts' && pathname !== '/api/drafts/blob') return false;
  if (!deps.isLocal(req)) { send(res, 403, { error: 'forbidden' }); return true; }
  const u = new URL(req.url, 'http://localhost');
  try {
    if (pathname === '/api/drafts/blob') {
      const f = path.join(draftDir(u), 'blobs', safe(u.searchParams.get('key')));
      if (req.method === 'POST') {
        await fs.mkdir(path.dirname(f), { recursive: true });
        await fs.writeFile(f, await readRaw(req));
        await fs.writeFile(f + '.type', req.headers['content-type'] || 'application/octet-stream');
        send(res, 200, { ok: true });
      } else {
        try {
          const data = await fs.readFile(f);
          const type = await fs.readFile(f + '.type', 'utf-8').catch(() => 'application/octet-stream');
          res.writeHead(200, { 'Content-Type': type }); res.end(data);
        } catch { send(res, 404, { error: 'not found' }); }
      }
      return true;
    }
    if (req.method === 'GET') {
      const id = u.searchParams.get('draft') || u.searchParams.get('imported');
      if (id) {
        const p = await readJson(path.join(draftDir(u), 'project.json'), null);
        send(res, p ? 200 : 404, p ? { project: p } : { error: 'ドラフトが見つかりません' });
        return true;
      }
      const [schedule, history, status, drafts, importedDrafts] = await Promise.all([getSchedule(), readHistory(), readJson(path.join(ROOT, 'status.json'), { state: 'idle' }), listDrafts(), listImported()]);
      send(res, 200, { schedule, history, status, drafts, importedDrafts });
      return true;
    }
    const b = JSON.parse((await readRaw(req)).toString('utf-8') || '{}');
    switch (b.action) {
      case 'schedule': {
        const s = b.schedule || {};
        const next = {
          enabled: !!s.enabled,
          count: Math.max(1, Math.min(10, Math.round(Number(s.count) || 3))),
          time: /^\d{1,2}:\d{2}$/.test(String(s.time || '')) ? String(s.time).padStart(5, '0') : DEFAULT_SCHEDULE.time,
          keywords: (Array.isArray(s.keywords) ? s.keywords : []).map((k) => ({ theme: String(k && k.theme || '').trim(), mode: k && k.mode === 'keyword' ? 'keyword' : 'news', ...(k && k.urgent ? { urgent: true } : {}), ...(k && k.note && String(k.note).trim() ? { note: String(k.note).trim().slice(0, 500) } : {}) })).filter((k) => k.theme),
          minutes: Number(s.minutes) || undefined,
          // 自動で選ぶテーマのジャンル（空＝全ジャンルからシャッフル）
          genres: (Array.isArray(s.genres) ? s.genres : []).map(String).filter((g) => /^[a-z-]{2,30}$/.test(g)).slice(0, 10),
        };
        await writeJson(path.join(ROOT, 'schedule.json'), next);
        const reg = b.register === false ? { ok: true } : await registerTask(next);
        send(res, 200, { ok: true, task: reg });
        return true;
      }
      case 'history': {
        // entries：[{theme, title, createdAt, mode, part, source, sequelOf, draftId}]（以前の themes：文字列の配列 も受け付ける）
        const cur = await readHistory();
        const add = [...(Array.isArray(b.entries) ? b.entries : []), ...(Array.isArray(b.themes) ? b.themes.map((t) => ({ theme: t })) : [])];
        for (const a of add) {
          const theme = String(a && a.theme || '').trim();
          if (!theme) continue;
          const e = {
            id: newHistId(), theme, title: String(a.title || '').trim(), createdAt: Number(a.createdAt) || Date.now(),
            mode: a.mode === 'keyword' ? 'keyword' : 'news', part: Math.max(1, Number(a.part) || 1), source: String(a.source || 'auto'),
            ...(a.sequelOf ? { sequelOf: String(a.sequelOf) } : {}), ...(a.draftId ? { draftId: String(a.draftId) } : {}),
          };
          // 同じテーマ・同じ回を12時間以内に作り直した記録は、新しいほうで置き換える（手動で何度も作り直したとき、記録が並ばないように）
          const i = cur.findIndex((x) => x.theme === theme && (x.part || 1) === e.part && Math.abs((x.createdAt || 0) - e.createdAt) < 12 * 3600000);
          if (i >= 0) cur[i] = { ...cur[i], ...e, id: cur[i].id, ...(cur[i].sequel ? { sequel: true } : {}) };
          else cur.push(e);
        }
        await writeJson(HISTORY, cur.slice(-1000));
        send(res, 200, { ok: true });
        return true;
      }
      case 'historyDelete': {
        const cur = await readHistory();
        await writeJson(HISTORY, cur.filter((x) => x.id !== b.id));
        send(res, 200, { ok: true });
        return true;
      }
      case 'historySequel': {
        // 続編を作る印を付け外しする
        const cur = await readHistory();
        const h = cur.find((x) => x.id === b.id);
        if (!h) { send(res, 404, { error: '記録が見つかりません' }); return true; }
        if (b.sequel) h.sequel = true; else delete h.sequel;
        await writeJson(HISTORY, cur);
        send(res, 200, { ok: true });
        return true;
      }
      case 'status': await writeJson(path.join(ROOT, 'status.json'), b.status || {}); send(res, 200, { ok: true }); return true;
      case 'saveDraft':
        await writeJson(path.join(PENDING, safe(b.id), 'project.json'), b.project);
        await writeJson(path.join(PENDING, safe(b.id), 'meta.json'), b.meta);
        send(res, 200, { ok: true });
        return true;
      case 'imported':
        await fs.mkdir(IMPORTED, { recursive: true });
        await fs.rename(path.join(PENDING, safe(b.id)), path.join(IMPORTED, `${safe(b.id)}-${Date.now()}`));
        send(res, 200, { ok: true });
        return true;
      // 別の台本（ドラフト）を開く前に、今開いている台本の控えを残す（あとで「もう一度開く」から戻せる）
      case 'backup': {
        await fs.mkdir(IMPORTED, { recursive: true });
        const dir = path.join(IMPORTED, `backup-${Date.now()}`);
        await writeJson(path.join(dir, 'project.json'), b.project);
        await writeJson(path.join(dir, 'meta.json'), { ...(b.meta || {}), id: `backup-${Date.now()}`, source: 'backup', images: [] });
        send(res, 200, { ok: true });
        return true;
      }
      case 'trending': {
        const out = await trending(deps.researchWithGemini, Math.max(1, Number(b.count) || 3), Array.isArray(b.exclude) ? b.exclude.map(String) : [], Array.isArray(b.genres) ? b.genres : null);
        send(res, 200, out);
        return true;
      }
      default: send(res, 400, { error: 'unknown action' }); return true;
    }
  } catch (e) {
    send(res, 500, { error: e && e.message ? e.message : String(e) });
    return true;
  }
}

module.exports = { handleDrafts };
