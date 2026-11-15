#!/usr/bin/env node
// 毎朝の自動ドラフト生成（タスクスケジューラ「DDDashboard AutoDraft」から呼ばれる）
//  1) tts-server（4100番）・next devが動いていなければ起動（next devのポートは起動ログから読む。auto-run.mjsと同じ方式）
//  2) 自動ドラフト専用のChromeプロファイルで /explainer/?autodraft=1&run=<id> を開く
//     → 画面が、予約テーマ／前日の話題のニュースで、リサーチ→台本→画像まで作り、drafts/pending に保存する
//  3) 完了（/api/drafts の status）を待って、ブラウザと自分で起動したサーバーを閉じる
// 使い方：node scripts/auto-draft.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOG = path.join(root, 'drafts', 'auto-log.txt');
fs.mkdirSync(path.dirname(LOG), { recursive: true });
const log = (m) => { const l = `[${new Date().toLocaleString('ja-JP')}] ${m}`; console.log(l); try { fs.appendFileSync(LOG, l + '\n'); } catch { /* 無視 */ } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (n) => String(n).padStart(2, '0');
const d = new Date();
const run = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
const TTS_PORT = Number(process.env.TTS_PORT) || 4100;
const TTS = `http://localhost:${TTS_PORT}`;
const spawned = [];
const killSpawned = () => { for (const p of spawned) { try { if (process.platform === 'win32' && p.pid) spawn('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' }); else p.kill(); } catch { /* 無視 */ } } };

let ctx = null;
try {
  log(`自動ドラフト生成を開始します（run=${run}）`);
  const ttsUp = async () => { try { return (await fetch(`${TTS}/health`, { signal: AbortSignal.timeout(3000) })).ok; } catch { return false; } };
  if (!(await ttsUp())) {
    log('tts-serverを起動します');
    spawned.push(spawn(process.execPath, [path.join(root, 'tts-server', 'server.js')], { cwd: root, stdio: 'ignore' }));
    let ok = false;
    for (let i = 0; i < 30 && !ok; i++) { await sleep(500); ok = await ttsUp(); }
    if (!ok) throw new Error('tts-serverを起動できませんでした');
  }
  let st0 = await (await fetch(`${TTS}/api/drafts`)).json();
  if (!st0.schedule?.enabled && !process.argv.includes('--urgent')) { log('自動生成はオフのため終了します'); throw null; }
  const urgentMode = process.argv.includes('--urgent');
  if (urgentMode && !(st0.schedule?.keywords || []).some((k) => k.urgent)) { log('「すぐ」の予約が無いため終了します'); throw null; }
  // 別の実行が動いている間は、同じChromeプロファイルを同時に開けない。2時間以上「実行中」のままなら、前回が途中で止まったとみなす。
  //  ・「すぐ」の実行：すぐ終了する（予約は残るので、10分ごとの予約チェックで次に起動される）
  //  ・毎朝の実行：終わるまで待つ
  const busy = (s) => s && s.state === 'running' && s.startedAt && Date.now() - s.startedAt < 2 * 3600000;
  if (busy(st0.status) && urgentMode) { log(`別の実行（run=${st0.status.run || '?'}）が動いているため、今回は終了します（次の予約チェックで再実行）`); throw null; }
  for (let i = 0; i < 120 && busy(st0.status); i++) {
    if (i === 0) log(`別の実行（run=${st0.status.run || '?'}）が終わるのを待ちます`);
    await sleep(60000);
    try { st0 = await (await fetch(`${TTS}/api/drafts`)).json(); } catch { /* 無視 */ }
  }

  // すでにこのプロジェクトの next dev が動いていれば（start-dd-dashboard.bat など）、それを使う。
  // 同じフォルダで next dev を2つ動かすと .next を取り合い、画面の読み込み直し・コンパイル待ちで止まることがあるため。
  let origin = null;
  for (let port = 3000; port <= 3010 && !origin; port++) {
    try {
      const r = await fetch(`http://localhost:${port}/explainer/`, { signal: AbortSignal.timeout(120000) });
      const html = r.ok ? await r.text() : '';
      // 動画作成の画面（タイトル「動画作成」）で、このプロジェクトのマニフェストを読んでいるもの
      if (html.includes('<title>動画作成</title>') && html.includes('dd-dashboard/manifest.json')) origin = `http://localhost:${port}`;
    } catch { /* そのポートには無い */ }
  }
  if (origin) log(`動いている next dev を使います：${origin}`);
  else {
  log('next devを起動します（ポートを自動検出します）');
  const nextProc = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['next', 'dev'], { cwd: root, shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  spawned.push(nextProc);
  origin = await new Promise((resolve) => {
    let done = false;
    const onData = (c) => { const m = c.toString().match(/Local:\s+(http:\/\/localhost:\d+)/); if (m && !done) { done = true; resolve(m[1]); } };
    nextProc.stdout.on('data', onData); nextProc.stderr.on('data', onData);
    setTimeout(() => { if (!done) { done = true; resolve(null); } }, 90000);
  });
  if (!origin) throw new Error('next devを90秒以内に起動できませんでした');
  log(`next dev：${origin}`);
  }

  const { chromium } = await import('playwright-core');
  const args = ['--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion', '--window-size=1500,1000'];
  for (const channel of ['chrome', 'msedge']) {
    try { ctx = await chromium.launchPersistentContext(path.join(os.homedir(), '.dd-dashboard-draft-profile'), { channel, headless: false, viewport: null, args }); break; }
    catch (e) { log(`${channel}を起動できません：${String(e.message).split('\n')[0]}`); }
  }
  if (!ctx) throw new Error('ChromeまたはEdgeを起動できませんでした');
  ctx.on('dialog', async (dl) => { log(`ダイアログ：${dl.message()}`); try { await dl.accept(); } catch { /* 無視 */ } });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  // 画面側のエラーもログに残す（止まった原因を後から追えるように）
  page.on('pageerror', (e) => log(`画面のエラー：${String(e?.message || e).split('\n')[0].slice(0, 300)}`));
  // 同じメッセージは3回までにする（繰り返し出るエラーでログが膨らまないように）
  const consoleSeen = new Map();
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text().split('\n')[0].slice(0, 300);
    const n = (consoleSeen.get(t) || 0) + 1; consoleSeen.set(t, n);
    if (n <= 3) log(`画面のコンソール：${t}${n === 3 ? '（以降は省略）' : ''}`);
  });
  page.on('crash', () => log('画面（タブ）がクラッシュしました'));
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) log(`画面を読み込みました：${f.url().replace(/^https?:\/\/[^/]+/, '')}`); });
  await page.goto(`${origin}/explainer/?autodraft=1&run=${run}${urgentMode ? '&urgent=1' : ''}`, { waitUntil: 'domcontentloaded', timeout: 180000 }).catch(() => {});

  const started = Date.now();
  let lastChange = Date.now(), lastSig = '', lastStep = '', seen = false;
  const snap = async (why) => {
    const f = path.join(root, 'drafts', `stall-${run}.png`);
    try { await page.screenshot({ path: f, timeout: 20000 }); log(`${why}：画面を ${path.relative(root, f)} に保存しました`); } catch (e) { log(`画面を保存できませんでした：${String(e?.message || e).split('\n')[0]}`); }
  };
  for (;;) {
    await sleep(10000);
    let st = null;
    try { st = (await (await fetch(`${TTS}/api/drafts`)).json()).status; } catch { /* 無視 */ }
    if (st && st.run === run) {
      if (!seen) { seen = true; log('画面が自動ドラフトを始めました'); }
      if (st.step && st.step !== lastStep) { lastStep = st.step; log(`進行：${st.step}`); }
      const sig = JSON.stringify(st.results || []) + st.state + (st.step || '');
      if (sig !== lastSig) { lastSig = sig; lastChange = Date.now(); }
      if (st.state === 'done') { log(`完了：${(st.results || []).map((r) => `${r.ok ? '○' : '×'} ${r.theme}${r.error ? `（${r.error}）` : ''}`).join(' ／ ') || st.message || '対象なし'}`); break; }
      if (st.state === 'error') { log(`エラー：${st.message || ''}`); break; }
    }
    if (!seen && Date.now() - started > 10 * 60000) { await snap('10分たっても画面が自動ドラフトを始めません'); log('中止します'); break; }
    if (Date.now() - lastChange > 40 * 60000) { await snap('40分以上進みがありません'); log('中止します'); break; }
    if (Date.now() - started > 110 * 60000) { await snap('110分を超えました'); log('中止します'); break; }
  }
} catch (e) {
  if (e) log(`失敗：${e?.message || e}`);
} finally {
  // 途中で止めたときに「実行中」のまま残ると、次の予約チェックが2時間待たされるので、終わった扱いにしておく
  try {
    const st = (await (await fetch(`${TTS}/api/drafts`, { signal: AbortSignal.timeout(5000) })).json()).status;
    if (st && st.run === run && st.state === 'running') {
      await fetch(`${TTS}/api/drafts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'status', status: { ...st, state: 'error', finishedAt: Date.now(), message: `途中で止まりました（${st.step || '段階不明'}）` } }), signal: AbortSignal.timeout(5000) });
    }
  } catch { /* 無視 */ }
  try { await ctx?.close(); } catch { /* 無視 */ }
  killSpawned();
  log('終了');
  setTimeout(() => process.exit(0), 2000);
}
