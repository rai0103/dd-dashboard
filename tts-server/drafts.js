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

const getSchedule = async () => ({ ...DEFAULT_SCHEDULE, ...(await readJson(path.join(ROOT, 'schedule.json'), {})) });

/** Windowsのタスクスケジューラに、毎日の自動実行を登録（オフなら解除）する。スリープ中でも起こして実行する */
function registerTask(s) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') { resolve({ ok: false, error: 'Windows専用' }); return; }
    const root = path.join(__dirname, '..');
    const script = s.enabled
      ? `$a = New-ScheduledTaskAction -Execute '${process.execPath}' -Argument 'scripts\\auto-draft.mjs' -WorkingDirectory '${root}';` +
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

/** 前日の話題のニュースから、解説動画のテーマ候補をGemini（Google検索）で集める */
async function trending(researchWithGemini, n, exclude) {
  const y = new Date(Date.now() - 86400000);
  const d = `${y.getFullYear()}年${y.getMonth() + 1}月${y.getDate()}日`;
  const prompt = `${d}に日本で話題になったニュース（経済・金融・マーケット・ビジネス・テクノロジー・社会）の中から、「ニュース・キーワード解説」のYouTube動画のテーマに向くものを${n + 5}件挙げてください。最新のWeb情報で確認したものだけにしてください。\n出力は1行に1件、テーマだけ（30字以内の日本語。例：日銀が政策金利を0.75%に引き上げ）。番号・記号・説明・前置きは書かないでください。${exclude.length ? `\n次と同じ話題は除いてください：${exclude.slice(-60).join('、')}` : ''}`;
  const r = await researchWithGemini(prompt);
  if (r.error && !r.text) throw new Error(r.error);
  // 箇条書きの記号・番号（「1.」「2)」「・」「-」「*」）だけを外す（「2026年度予算案…」のように数字で始まるテーマは残す）。
  // 前置き・まとめの行（「以下は…」「：」で終わる行など）や、Markdownの強調・かぎかっこも取り除く
  return String(r.text || '').split(/\r?\n/)
    .map((l) => l.replace(/\*\*/g, '').replace(/^\s*(?:[-・*•]|[0-9０-９]{1,2}\s*[.．)）、])\s*/, '').replace(/^[「『]|[」』]$/g, '').trim())
    .filter((l) => l && l.length <= 40 && !/[:：]$/.test(l) && !/^(以下|次の|こちら|上記|※)/.test(l));
}

/** 処理したら true を返す */
async function handleDrafts(req, res, pathname, deps) {
  if (pathname !== '/api/drafts' && pathname !== '/api/drafts/blob') return false;
  if (!deps.isLocal(req)) { send(res, 403, { error: 'forbidden' }); return true; }
  const u = new URL(req.url, 'http://localhost');
  try {
    if (pathname === '/api/drafts/blob') {
      const f = path.join(PENDING, safe(u.searchParams.get('draft')), 'blobs', safe(u.searchParams.get('key')));
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
      const id = u.searchParams.get('draft');
      if (id) {
        const p = await readJson(path.join(PENDING, safe(id), 'project.json'), null);
        send(res, p ? 200 : 404, p ? { project: p } : { error: 'ドラフトが見つかりません' });
        return true;
      }
      const [schedule, history, status, drafts] = await Promise.all([getSchedule(), readJson(path.join(ROOT, 'history.json'), []), readJson(path.join(ROOT, 'status.json'), { state: 'idle' }), listDrafts()]);
      send(res, 200, { schedule, history, status, drafts });
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
          keywords: (Array.isArray(s.keywords) ? s.keywords : []).map((k) => ({ theme: String(k && k.theme || '').trim(), mode: k && k.mode === 'keyword' ? 'keyword' : 'news', ...(k && k.urgent ? { urgent: true } : {}) })).filter((k) => k.theme),
          minutes: Number(s.minutes) || undefined,
        };
        await writeJson(path.join(ROOT, 'schedule.json'), next);
        const reg = b.register === false ? { ok: true } : await registerTask(next);
        send(res, 200, { ok: true, task: reg });
        return true;
      }
      case 'history': {
        const cur = await readJson(path.join(ROOT, 'history.json'), []);
        const set = new Set(cur);
        for (const t of (Array.isArray(b.themes) ? b.themes : [])) if (t) set.add(String(t).trim());
        await writeJson(path.join(ROOT, 'history.json'), [...set].slice(-1000));
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
      case 'trending': {
        const themes = await trending(deps.researchWithGemini, Math.max(1, Number(b.count) || 3), Array.isArray(b.exclude) ? b.exclude.map(String) : []);
        send(res, 200, { themes });
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
