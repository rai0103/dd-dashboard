#!/usr/bin/env node
// `npm run dev:video` 用：dd-dashboardの `next dev` と、長尺動画のナレーション音声合成に使う
// ローカルTTSヘルパーサーバー（tts-server/server.js）を1コマンドで同時起動するラッパー。
// 既存の `npm run dev`（next devのみ）・本番ビルド（next build, output: "export"）には一切影響しない。
const { spawn } = require('child_process');
const path = require('path');

const procs = [];
function run(name, cmd, args) {
  const p = spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  procs.push(p);
  p.on('exit', (code) => {
    console.log(`[dev:video] ${name} exited (code ${code}). 他のプロセスも終了します…`);
    shutdown();
  });
  return p;
}

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const p of procs) { try { p.kill(); } catch {} }
  setTimeout(() => process.exit(0), 200);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log('[dev:video] next dev と tts-server を起動します（Ctrl+Cで両方終了）…');
run('tts-server', process.execPath, [path.join(__dirname, '..', 'tts-server', 'server.js')]);
run('next-dev', process.platform === 'win32' ? 'npx.cmd' : 'npx', ['next', 'dev']);
