#!/usr/bin/env node
// `npm run dev:video` 用：dd-dashboardの `next dev` と、長尺動画のナレーション音声合成に使う
// ローカルTTSヘルパーサーバー（tts-server/server.js）を1コマンドで同時起動するラッパー。
// 既存の `npm run dev`（next devのみ）・本番ビルド（next build, output: "export"）には一切影響しない。
const { spawn } = require('child_process');
const path = require('path');

const procs = [];
function run(name, cmd, args, { shell = false } = {}) {
  const p = spawn(cmd, args, { stdio: 'inherit', shell });
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
// tts-serverはNode実行ファイル（process.execPath）を直接起動するのでshellは使わない。
// shell:trueのままだと、Windowsでインストール先パスに空白が入る場合（例: "C:\Program Files\nodejs\node.exe"）に
// cmd.exeが空白で区切って解釈してしまい、'C:\Program' は認識されない、という形で起動に失敗する既存の不具合があった。
run('tts-server', process.execPath, [path.join(__dirname, '..', 'tts-server', 'server.js')]);
// next-dev（npx.cmd）はWindowsでは拡張子の都合上shellが必要
run('next-dev', process.platform === 'win32' ? 'npx.cmd' : 'npx', ['next', 'dev'], { shell: process.platform === 'win32' });
