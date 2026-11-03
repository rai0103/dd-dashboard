#!/usr/bin/env node
// 平日朝の自動配信（タスクスケジューラから呼ばれる）。
//  1) 曜日・米国の夏時間／冬時間を確認 → 2) tts-server・next devが動いていなければ起動
//     （next devのポートは決め打ちにせず、起動ログの実際のURLを読み取る。既存の
//     scripts/launch-and-open.jsと同じ方式。このPCでは他のプロジェクトが3000番・3001番を
//     使っていることがあるため） → 3) 自動運転専用のChromeプロファイルで
//     「株式情報」の動画生成を無人実行 → 4) 成功ならChromeを閉じて終了／失敗なら、
//     画面のスクリーンショット付きの結果ページを開いて終了
// 使い方：node scripts/auto-run.mjs --job <ジョブID> --time <時刻ID> [--force]
//
// investment-shortsの同種のscripts/auto-run.mjs（タスクスケジューラ＋Playwright自動運転の仕組み）を
// 参考にしたが、そのコードは一切コピーしていない。investment-shorts本体は無改変。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = path.join(os.homedir(), '.dd-dashboard');
const runsDir = path.join(base, 'auto-runs');
fs.mkdirSync(runsDir, { recursive: true });

const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const force = process.argv.includes('--force');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const run = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
const statusFile = path.join(runsDir, `${run}.json`);
const log = (m) => { try { fs.appendFileSync(path.join(base, 'auto-log.txt'), `[${new Date().toLocaleString('ja-JP')}] ${m}\n`); } catch { /* 無視 */ } };
const writeStatus = (o) => { const d = JSON.stringify({ run, ...o, updatedAt: Date.now() }); fs.writeFileSync(statusFile, d); fs.writeFileSync(path.join(runsDir, 'latest.json'), d); };
const readStatus = () => { try { return JSON.parse(fs.readFileSync(statusFile, 'utf-8')); } catch { return null; } };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// このスクリプト自身が起動したプロセス（tts-server・next dev）だけを、終了時に片付ける
// （既に起動していたものを横取りして終了させない）。
const spawnedProcs = [];
const killSpawned = () => { for (const p of spawnedProcs) { try { p.kill(); } catch { /* 無視 */ } } };

// 失敗時：結果ページ（HTML）を作って、いつものブラウザで開く
function openReport(st, pngB64) {
  const rows = (st.steps ?? []).map((s) => `<tr><td>${s.ok ? '✅' : '❌'}</td><td>${esc(s.name)}</td><td>${esc(s.note)}</td></tr>`).join('');
  const html = `<!doctype html><meta charset="utf-8"><title>自動実行の結果</title><body style="font-family:sans-serif;background:#0f172a;color:#e2e8f0;padding:16px;max-width:1100px;margin:auto">
<h1 style="color:#f87171">⚠ 自動実行が完了しませんでした</h1><p>${esc(run)}／${esc(st.message)}</p>
<h3>手順</h3><table border="1" cellpadding="6" style="border-collapse:collapse">${rows}</table>
${pngB64 ? `<h3>失敗したときの画面</h3><img style="max-width:100%;border:1px solid #475569" src="data:image/png;base64,${pngB64}">` : ''}
<p style="color:#94a3b8">この画面をスクリーンショットして Claude に渡してください。ログ：${esc(path.join(base, 'auto-log.txt'))}</p></body>`;
  const f = path.join(base, 'latest-report.html');
  fs.writeFileSync(f, html);
  try { spawn('cmd.exe', ['/c', 'start', '""', f], { detached: true, stdio: 'ignore', windowsHide: true }).unref(); } catch { /* 無視 */ }
}

async function fail(message, ctx, page, steps = []) {
  const prev = readStatus() ?? {};
  const st = { ...prev, state: 'ng', message, steps: [...(prev.steps ?? []), ...steps] };
  writeStatus(st);
  log(`失敗：${message}`);
  let png = '';
  try { if (page) png = (await page.screenshot({ type: 'png' })).toString('base64'); } catch { /* 無視 */ }
  try { await ctx?.close(); } catch { /* 無視 */ }
  killSpawned();
  openReport(st, png);
  process.exit(1);
}

const jobId = arg('job'), timeId = arg('time');
let cfg;
try { cfg = JSON.parse(fs.readFileSync(path.join(base, 'auto.json'), 'utf-8')); } catch { /* 下で判定 */ }
const job = cfg?.jobs?.find((j) => j.id === jobId);
if (!job) { writeStatus({ state: 'starting', message: '' }); await fail('自動実行の設定が見つかりません（dd-dashboardの「配信設定」で保存し直してください）'); }

// ---- 実行してよい日・時期か
const entry = job.times.find((t) => t.id === timeId);
const ny = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'short' }).format(new Date());
const summer = /EDT/.test(ny);
if (!force) {
  const skip = !job.enabled ? '無効'
    : !job.days.includes(now.getDay()) ? '曜日が対象外'
    : entry?.season === 'summer' && !summer ? '米国の冬時間なので対象外'
    : entry?.season === 'winter' && summer ? '米国の夏時間なので対象外'
    : '';
  if (skip) { log(`スキップ（${job.name} ${entry?.time}）：${skip}`); process.exit(0); }
}
log(`開始：${job.name} ${entry?.time ?? ''}（run=${run}、mode=${job.mode}）`);
writeStatus({ state: 'starting', message: 'サーバーを確認しています…', job: job.name, steps: [] });

// ---- tts-server（固定ポート。既に起動していれば横取りせず、そのまま使う）
const TTS_PORT = Number(process.env.TTS_PORT) || 4100;
const ttsUp = async () => { try { const r = await fetch(`http://localhost:${TTS_PORT}/health`, { signal: AbortSignal.timeout(3000) }); return r.ok; } catch { return false; } };
if (!(await ttsUp())) {
  log('tts-serverを起動します');
  const p = spawn(process.execPath, [path.join(root, 'tts-server', 'server.js')], { cwd: root, stdio: 'ignore' });
  spawnedProcs.push(p);
  let ok = false;
  for (let i = 0; i < 20 && !ok; i++) { await sleep(500); ok = await ttsUp(); }
  if (!ok) await fail('tts-serverを起動できませんでした（PowerShellの実行許可・ポート4100の空き状況をご確認ください）');
} else {
  log('tts-serverは既に起動しています（そのまま使います）');
}

// ---- next dev（ポートは決め打ちにせず、起動ログの実際のURLを読み取る。他のプロジェクトとの
//      ポート衝突を再発させないため、常にこのスクリプト専用の新しいnext devプロセスを起動する）
log('next devを起動します（ポートを自動検出します）');
const nextProc = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['next', 'dev'], { cwd: root, shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
spawnedProcs.push(nextProc);
const origin = await new Promise((resolve) => {
  let resolved = false;
  const onData = (chunk) => {
    const text = chunk.toString();
    const m = text.match(/Local:\s+(http:\/\/localhost:\d+)/);
    if (m && !resolved) { resolved = true; resolve(m[1]); }
  };
  nextProc.stdout.on('data', onData);
  nextProc.stderr.on('data', onData);
  setTimeout(() => { if (!resolved) { resolved = true; resolve(null); } }, 60000);
});
if (!origin) await fail('next dev（開発サーバー）を60秒以内に起動できませんでした');
log(`next devの起動を検出：${origin}`);

// ---- 自動運転用のChrome（普段使うブラウザとは別の専用プロファイル。声・アバター・BGM・背景などの
//      設定は、ExplainerStudio側の「自動実行用に引き継ぐ」機能で別途反映する）
let chromium;
try { ({ chromium } = await import('playwright-core')); } catch { await fail('playwright-core が入っていません（dd-dashboardのフォルダで npm install を実行してください）'); }
const launchArgs = ['--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion', '--window-size=1500,1000'];
let ctx;
for (const channel of ['chrome', 'msedge']) {
  try { ctx = await chromium.launchPersistentContext(path.join(os.homedir(), '.dd-dashboard-auto-profile'), { channel, headless: false, viewport: null, args: launchArgs }); break; }
  catch (e) { log(`${channel}を起動できません：${String(e.message).split('\n')[0]}`); }
}
if (!ctx) await fail('Google ChromeまたはEdgeを起動できませんでした');
// alert()等のダイアログが出ても自動実行が止まらないようにする（内容はログに残す）
ctx.on('dialog', async (d) => { log(`ダイアログ：${d.message()}`); try { await d.accept(); } catch { /* 無視 */ } });
let closedByUser = false;
ctx.on('close', () => { closedByUser = true; });
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto(`${origin}/explainer/?autorun=1&mode=${job.mode}&run=${run}`, { waitUntil: 'domcontentloaded', timeout: 120000 }).catch(() => { /* 下のポーリングでタイムアウト判定する */ });

// ---- 結果を待つ（画面から /api/auto-status（tts-server経由）に書き込まれた、このrunのステータス
//      ファイルを直接読む。auto-run.mjs自身もこのPC上で動いているため、HTTP越しに取りに行く必要はない）
const started = Date.now();
for (;;) {
  await sleep(5000);
  const st = readStatus();
  if (st?.state === 'ok') { log('成功'); await sleep(3000); await ctx.close().catch(() => { /* 無視 */ }); killSpawned(); process.exit(0); }
  if (st?.state === 'ng') await fail(st.message || '失敗しました', ctx, page, st.steps ?? []);
  if (closedByUser) await fail('自動実行用のブラウザが途中で閉じられました', null, null);
  const last = st?.updatedAt ?? started;
  if (Date.now() - last > 25 * 60 * 1000) await fail('25分以上、進みがありませんでした', ctx, page);
  if (Date.now() - started > 4 * 3600 * 1000) await fail('4時間を超えたため中止しました', ctx, page);
}
