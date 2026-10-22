// dd-dashboard 長尺動画作成用：ローカルTTS（音声合成）ヘルパーサーバー。
// investment-shorts の app/api/tts/route.ts（Windows音声合成をPowerShell経由で呼ぶNext.js Route Handler）
// のロジックを、Next.jsに依存しない単体のNode httpサーバーとして移植したもの。
// dd-dashboardは next.config.ts で output: "export"（完全静的サイト）のため、Route Handler（POST等）を
// 本体に組み込むとビルド・デプロイが壊れる。このサーバーはNext.jsの外で動くため、その制約を受けない。
// investment-shorts自体は無改変（このファイルはdd-dashboardリポジトリ内の新規コードのみ）。
//
// 起動: node tts-server/server.js  （既定ポート 4100。環境変数 TTS_PORT で変更可能）
// このサーバーが提供するAPIは、investment-shorts側の /api/tts と同一仕様：
//   GET  /api/tts        -> { voices: string[] }（インストール済み日本語音声の一覧）
//   POST /api/tts        -> { text, rate, voice } を受け取り、WAV（audio/wav）を返す
//
// Windows専用（PowerShellのSystem.Speech / Windows.Media.SpeechSynthesisを使用）。

const http = require('http');
const { execFile } = require('child_process');
const fs = require('fs').promises;
const fsSync = require('fs');
const os = require('os');
const path = require('path');

const PORT = Number(process.env.TTS_PORT) || 4100;

// tts-server/.env（gitignore対象）があれば読み込み、process.envへ反映する（dotenv非依存・ゼロ依存維持のための自前の簡易パーサー）。
// 既存の環境変数は上書きしない。Stage D-2：チャット機能（/api/chat）用のANTHROPIC_API_KEY等をここで読む。
function loadEnvFile() {
  const envPath = path.join(__dirname, '.env');
  try {
    if (!fsSync.existsSync(envPath)) return;
    const raw = fsSync.readFileSync(envPath, 'utf8');
    raw.split(/\r?\n/).forEach((line) => {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) return;
      const key = m[1];
      let val = m[2];
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    });
  } catch (e) {
    console.error('[tts-server] .env の読み込みに失敗しました:', e && e.message ? e.message : e);
  }
}
loadEnvFile();

const PS_LIST = `[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -eq 'ja-JP' } | ForEach-Object { 'sapi:' + $_.VoiceInfo.Name }
try {
  [void][Windows.Media.SpeechSynthesis.SpeechSynthesizer,Windows.Media.SpeechSynthesis,ContentType=WindowsRuntime]
  [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | Where-Object { $_.Language -like 'ja*' } | ForEach-Object { 'oc:' + $_.DisplayName }
} catch { }
`;

const PS_SPEAK = `param($in,$out,$rate,$voice)
$text = [IO.File]::ReadAllText($in, [Text.Encoding]::UTF8)
function SpeakSapi($name, $rate) {
  Add-Type -AssemblyName System.Speech
  $s = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $all = @($s.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -eq 'ja-JP' })
  if ($all.Count -eq 0) { [Console]::Error.WriteLine('NO_JA_VOICE'); exit 3 }
  $v = $all | Where-Object { $_.VoiceInfo.Name -eq $name } | Select-Object -First 1
  if (-not $v) { $v = $all[0] }
  $s.SelectVoice($v.VoiceInfo.Name)
  $s.Rate = [int][Math]::Max(-10, [Math]::Min(10, [Math]::Round(($rate - 1) * 10)))
  $s.SetOutputToWaveFile($out)
  $s.Speak($text)
  $s.Dispose()
}
function SpeakOneCore($name, $rate) {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  [void][Windows.Media.SpeechSynthesis.SpeechSynthesizer,Windows.Media.SpeechSynthesis,ContentType=WindowsRuntime]
  [void][Windows.Storage.Streams.IRandomAccessStream,Windows.Storage.Streams,ContentType=WindowsRuntime]
  $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -like 'IAsyncOperation*' } | Select-Object -First 1
  $syn = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
  $v = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | Where-Object { $_.DisplayName -eq $name } | Select-Object -First 1
  if (-not $v) { throw 'voice not found' }
  $syn.Voice = $v
  $syn.Options.SpeakingRate = [double]$rate
  $op = $syn.SynthesizeTextToStreamAsync($text)
  $task = $asTask.MakeGenericMethod([Windows.Media.SpeechSynthesis.SpeechSynthesisStream]).Invoke($null, @($op))
  $task.Wait(-1) | Out-Null
  $stream = $task.Result
  $net = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($stream)
  $fs = [IO.File]::Create($out)
  $net.CopyTo($fs)
  $fs.Close()
}
$r = [double]$rate
if ($voice -like 'oc:*') {
  try { SpeakOneCore $voice.Substring(3) $r } catch { [Console]::Error.WriteLine('ONECORE_FAILED: ' + $_.Exception.Message); SpeakSapi '' $r }
} elseif ($voice -like 'sapi:*') {
  SpeakSapi $voice.Substring(5) $r
} else {
  SpeakSapi $voice $r
}
`;

function runPS(args) {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ...args],
      { windowsHide: true, timeout: 90000, maxBuffer: 1024 * 1024 * 20 },
      (err, stdout, stderr) => {
        const code = err ? (err.code != null ? err.code : 1) : 0;
        resolve({ code: typeof code === 'number' ? code : 1, stderr: String(stderr || (err && err.message) || ''), stdout: String(stdout || '') });
      });
  });
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function handleGetVoices(req, res) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dd-video-tts-'));
  try {
    const ps1 = path.join(dir, 'list.ps1');
    await fs.writeFile(ps1, '﻿' + PS_LIST, 'utf8');
    const { stdout } = await runPS([ps1]);
    const voices = Array.from(new Set(stdout.split(/\r?\n/).map((v) => v.trim()).filter(Boolean)));
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ voices }));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('LIST_FAILED: ' + (e && e.message ? e.message : String(e)));
  } finally {
    fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(data)); } catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

// Stage D-2：ローカルAIチャットプロキシ。dd-dashboardは静的エクスポートのためNext.js Route Handlerを持てず、
// TTSサーバーと同じ理由でここに実装する。リクエストをそのままAnthropic Messages APIへ中継するだけで、
// APIキーはユーザー自身のtts-server/.env（gitignore対象）から読む（Claudeが入力・保持することはない）。
async function handlePostChat(req, res) {
  const body = await readJsonBody(req);
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      error: 'NO_API_KEY',
      message: 'tts-server/.env に ANTHROPIC_API_KEY が設定されていません（tts-server/.env.example を参考に設定してください）。',
    }));
    return;
  }
  const model = (process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5');
  const payload = {
    model,
    max_tokens: (body && Number(body.max_tokens)) || 1024,
    system: body && body.system,
    messages: (body && Array.isArray(body.messages)) ? body.messages : [],
  };
  if (body && body.tools) payload.tools = body.tools;
  if (body && body.tool_choice) payload.tool_choice = body.tool_choice;
  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const text = await upstream.text();
    res.writeHead(upstream.status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(text);
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'UPSTREAM_FAILED', message: String(e && e.message ? e.message : e) }));
  }
}

async function handlePostSpeak(req, res) {
  const body = await readJsonBody(req);
  const text = body && typeof body.text === 'string' ? body.text : '';
  const voice = body && typeof body.voice === 'string' ? body.voice : '';
  if (!text) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('text required');
    return;
  }
  const r = Math.max(0.5, Math.min(2, Number(body && body.rate) || 1));
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dd-video-tts-'));
  const ps1 = path.join(dir, 'tts.ps1');
  const inp = path.join(dir, 'in.txt');
  const out = path.join(dir, 'out.wav');
  try {
    await fs.writeFile(ps1, '﻿' + PS_SPEAK, 'utf8');
    await fs.writeFile(inp, text, 'utf8');
    const { code, stderr } = await runPS([ps1, inp, out, String(r), voice]);
    if (code !== 0) {
      const msg = stderr.includes('NO_JA_VOICE') ? 'NO_JA_VOICE' : `TTS_FAILED: ${stderr.slice(0, 200)}`;
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(msg);
      return;
    }
    const wav = await fs.readFile(out);
    res.writeHead(200, { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store' });
    res.end(wav);
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('TTS_FAILED: ' + (e && e.message ? e.message : String(e)));
  } finally {
    fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

const server = http.createServer((req, res) => {
  setCors(res);
  const url = req.url || '';
  const pathname = url.split('?')[0];
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (pathname === '/api/tts' && req.method === 'GET') { handleGetVoices(req, res); return; }
  if (pathname === '/api/tts' && req.method === 'POST') { handlePostSpeak(req, res); return; }
  if (pathname === '/api/chat' && req.method === 'POST') { handlePostChat(req, res); return; }
  if (pathname === '/' || pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, service: 'dd-dashboard tts-server', port: PORT }));
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('not found');
});

server.listen(PORT, () => {
  console.log(`[tts-server] listening on http://localhost:${PORT} (長尺動画のナレーション音声合成用・Windows専用)`);
});
