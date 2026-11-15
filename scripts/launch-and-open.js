#!/usr/bin/env node
// ワンクリック起動用バッチファイル（start-dd-dashboard.bat）専用のラッパー。
// npm run dev:video（scripts/dev-video.js）と同様に next dev と tts-server を同時起動するが、
// こちらは next devの出力を監視して「実際に使われたポート」を検出し、そのURLで自動的にブラウザを開く。
// このマシンでは他のプロジェクト（investment-shorts等）が3000番・3001番を既に使っていることがあり、
// ポートを決め打ちできない（固定すると、別プロジェクトのサーバーにぶつかって開かない・あるいは
// そちらの画面が開いてしまう）ため、動的検出が必須。
// 通常のターミナルからの `npm run dev:video`（scripts/dev-video.js）はこのファイルと無関係で、
// 今まで通りの挙動のまま変更していない。
const { spawn, spawnSync, exec, execSync } = require('child_process');
const path = require('path');

const procs = [];
function run(name, cmd, args, { shell = false, pipeStdout = false } = {}) {
  const p = spawn(cmd, args, { stdio: pipeStdout ? ['inherit', 'pipe', 'inherit'] : 'inherit', shell });
  procs.push(p);
  p.on('exit', (code) => {
    console.log(`[launch] ${name} exited (code ${code}). 他のプロセスも終了します…`);
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

// 前回の tts-server が残っていて 4100番が使われていると、新しい tts-server が起動できず全体が終了してしまう。
// 残っているのがこのプロジェクトの tts-server なら止めてから起動し直す（別のアプリなら止めずに知らせる）。
function freeTtsPort() {
  if (process.platform !== 'win32') return;
  const port = Number(process.env.TTS_PORT) || 4100;
  try {
    const ps = `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { $p = Get-CimInstance Win32_Process -Filter "ProcessId=$($_.OwningProcess)"; "$($p.ProcessId)\t$($p.CommandLine)" }`;
    // 引用符・パイプを cmd に解釈させないよう、-EncodedCommand（UTF-16LEのBase64）で渡す
    const r = spawnSync('powershell', ['-NoProfile', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true });
    const out = String(r.stdout || '').trim();
    for (const line of out.split(/\r?\n/).filter(Boolean)) {
      const [pid, cmd = ''] = line.split('\t');
      if (/dd-dashboard[\\/]tts-server[\\/]server\.js/i.test(cmd)) {
        console.log(`[launch] 前回の tts-server（PID ${pid}）が残っているので止めます…`);
        try { execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' }); } catch {}
      } else {
        console.log(`[launch] ${port}番を別のプログラムが使っています（PID ${pid}：${cmd.slice(0, 120)}）。このままでは tts-server を起動できません。`);
      }
    }
  } catch { /* 確認できないときはそのまま起動を試す */ }
}
freeTtsPort();

console.log('[launch] next dev と tts-server を起動します（Ctrl+Cで両方終了）…');
// tts-serverはNode実行ファイル（process.execPath）を直接起動するのでshellは使わない（scripts/dev-video.jsと同じ理由）。
run('tts-server', process.execPath, [path.join(__dirname, '..', 'tts-server', 'server.js')]);

// next-devの標準出力はpipeで受け取り、起動ログを監視しつつ、そのままコンソールにも転送する。
const nextProc = run('next-dev', process.platform === 'win32' ? 'npx.cmd' : 'npx', ['next', 'dev'], {
  shell: process.platform === 'win32',
  pipeStdout: true,
});

let opened = false;
nextProc.stdout.on('data', (chunk) => {
  const text = chunk.toString();
  process.stdout.write(text); // 通常通りコンソールにも表示する
  if (opened) return;
  // Next.jsの起動ログ「- Local:        http://localhost:3001」からポート込みのURLを拾う。
  const m = text.match(/Local:\s+(http:\/\/localhost:\d+)/);
  if (!m) return;
  opened = true;
  const url = `${m[1]}/`;
  console.log(`[launch] ブラウザを開きます: ${url}`);
  if (process.platform === 'win32') {
    exec(`start "" "${url}"`, { shell: 'cmd.exe' });
  } else if (process.platform === 'darwin') {
    exec(`open "${url}"`);
  } else {
    exec(`xdg-open "${url}"`);
  }
});
