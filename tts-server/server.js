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

// ニュース・キーワード解説動画（/explainer）用：参考URLの本文を取得する。
// ブラウザからは他サイトを直接読めない（CORS）ため、このローカルサーバーが代わりに取得し、
// HTMLは本文らしき部分だけをテキストにして返す。PDFならbase64のまま返す（AIにPDFとして渡す）。
//   GET /api/fetch-url?url=https://... -> { kind:'text', title, text } | { kind:'pdf', title, base64 }
const FETCH_MAX_BYTES = 15 * 1024 * 1024;
const ENTITY = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', laquo: '«', raquo: '»', yen: '¥', copy: '©' };
function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(code); } catch { return m; }
    }
    return ENTITY[e.toLowerCase()] ?? m;
  });
}
function htmlToText(html) {
  let h = html.replace(/<!--[\s\S]*?-->/g, ' ');
  h = h.replace(/<(script|style|noscript|svg|iframe|template|form|button|select)\b[\s\S]*?<\/\1>/gi, ' ');
  const titleM = h.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const ogM = h.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']*)["']/i);
  const descM = h.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i);
  const title = decodeEntities(((ogM && ogM[1]) || (titleM && titleM[1]) || '').replace(/\s+/g, ' ').trim());
  // 本文らしき部分：<article>（複数あれば最長）→<main>→<body>
  const pickLongest = (re) => { let best = ''; let m; while ((m = re.exec(h))) { if (m[1].length > best.length) best = m[1]; } return best; };
  let body = pickLongest(/<article\b[^>]*>([\s\S]*?)<\/article>/gi) || pickLongest(/<main\b[^>]*>([\s\S]*?)<\/main>/gi);
  if (!body || body.length < 500) {
    const b = h.match(/<body\b[^>]*>([\s\S]*)<\/body>/i);
    body = (b ? b[1] : h).replace(/<(nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi, ' ');
  }
  let text = body
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article|\/blockquote)\b[^>]*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n・')
    .replace(/<[^>]+>/g, ' ');
  text = decodeEntities(text).replace(/[ \t　]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const desc = descM ? decodeEntities(descM[1]).trim() : '';
  if (desc && !text.includes(desc.slice(0, 30))) text = `${desc}\n\n${text}`;
  return { title, text: text.slice(0, 60000) };
}
function charsetOf(contentType, headBytes) {
  const m = /charset=([^;\s]+)/i.exec(contentType || '');
  if (m) return m[1].replace(/["']/g, '');
  const head = Buffer.from(headBytes).toString('latin1');
  const m2 = /<meta[^>]+charset=["']?([a-z0-9_\-]+)/i.exec(head);
  return m2 ? m2[1] : 'utf-8';
}

// ---- YouTube動画（タイトル・チャンネル・概要欄・字幕） ----
// 字幕は公開されている字幕トラック（手動の日本語→自動生成の日本語→その他の順）を取りにいく。
// YouTube側の仕様で字幕が取れない動画もあるため、その場合はタイトル・概要欄だけを返し、note で知らせる。
function youtubeIdOf(u) {
  const h = u.hostname.replace(/^www\.|^m\./, '');
  if (h === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
  if (h === 'youtube.com' || h === 'music.youtube.com') {
    if (u.searchParams.get('v')) return u.searchParams.get('v');
    const m = /^\/(shorts|live|embed)\/([^/?#]+)/.exec(u.pathname);
    if (m) return m[2];
  }
  return null;
}
const YT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
function pickTrack(tracks) {
  if (!Array.isArray(tracks) || !tracks.length) return null;
  const ja = tracks.filter((t) => /^ja/.test(t.languageCode || ''));
  return ja.find((t) => t.kind !== 'asr') || ja[0] || tracks.find((t) => t.kind !== 'asr') || tracks[0];
}
async function fetchTranscript(baseUrl, signal) {
  if (!baseUrl) return '';
  try {
    const r = await fetch(baseUrl + (baseUrl.includes('fmt=') ? '' : '&fmt=json3'), { signal, headers: { 'User-Agent': YT_UA } });
    const t = await r.text();
    if (t.trim().startsWith('{')) {
      const j = JSON.parse(t);
      const s = (j.events || []).map((ev) => (ev.segs || []).map((x) => x.utf8 || '').join('')).join('');
      if (s.trim()) return s.replace(/\n+/g, ' ').replace(/\s{2,}/g, ' ').trim();
    }
    const xml = t.match(/<text[^>]*>([\s\S]*?)<\/text>/g);
    if (xml) return decodeEntities(xml.map((x) => x.replace(/<[^>]+>/g, '')).join(' ')).replace(/\s{2,}/g, ' ').trim();
  } catch { /* 取れなければ空 */ }
  return '';
}
async function fetchYoutube(id, signal) {
  let pr = null;
  // 1) 動画ページに埋め込まれた情報
  try {
    const r = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(id)}&hl=ja`, { signal, headers: { 'User-Agent': YT_UA, 'Accept-Language': 'ja,en;q=0.8', Cookie: 'CONSENT=YES+1; SOCS=CAI' } });
    const html = await r.text();
    const m = html.match(/ytInitialPlayerResponse\s*=\s*(\{[\s\S]+?\})\s*;\s*(?:var\s|<\/script>|const\s|let\s)/);
    if (m) pr = JSON.parse(m[1]);
  } catch { /* 次の方法へ */ }
  let track = pickTrack(pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks);
  let transcript = track ? await fetchTranscript(track.baseUrl, signal) : '';
  // 2) 字幕が取れなければ、アプリ向けの取得方法でもう一度
  if (!transcript) {
    try {
      const r = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
        method: 'POST', signal,
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'com.google.android.youtube/19.44.38 (Linux; U; Android 14) gzip' },
        body: JSON.stringify({ videoId: id, context: { client: { clientName: 'ANDROID', clientVersion: '19.44.38', androidSdkVersion: 34, hl: 'ja', gl: 'JP' } } }),
      });
      const j = await r.json();
      if (!pr) pr = j;
      const t2 = pickTrack(j?.captions?.playerCaptionsTracklistRenderer?.captionTracks);
      if (t2) { track = t2; transcript = await fetchTranscript(t2.baseUrl, signal); }
    } catch { /* 字幕なしで続ける */ }
  }
  const vd = pr?.videoDetails || {};
  let title = vd.title || '', author = vd.author || '';
  if (!title) {
    try { const o = await (await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent('https://www.youtube.com/watch?v=' + id)}`, { signal })).json(); title = o.title || ''; author = o.author_name || ''; } catch { /* ignore */ }
  }
  if (!title) return null;
  const pub = pr?.microformat?.playerMicroformatRenderer?.publishDate || '';
  const len = Number(vd.lengthSeconds) || 0;
  const parts = [
    `【YouTube動画】${title}`,
    `チャンネル：${author}${pub ? `／公開日：${pub.slice(0, 10)}` : ''}${len ? `／長さ：${Math.floor(len / 60)}分${len % 60}秒` : ''}`,
    vd.shortDescription ? `【概要欄】\n${vd.shortDescription}` : '',
    transcript ? `【字幕（${track && track.kind === 'asr' ? '自動生成' : '字幕'}）】\n${transcript}` : '',
  ].filter(Boolean);
  return {
    kind: 'text', title: `${title}（YouTube・${author}）`, text: parts.join('\n\n').slice(0, 60000), youtube: true, transcript: !!transcript,
    note: transcript ? `字幕${track && track.kind === 'asr' ? '（自動生成）' : ''}あり` : '字幕を取得できず、タイトルと概要欄のみ',
  };
}

async function handleFetchUrl(req, res) {
  const u = new URL(req.url, 'http://localhost');
  const target = u.searchParams.get('url') || '';
  const send = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
  let parsed;
  try { parsed = new URL(target); } catch { send(400, { error: 'BAD_URL', message: 'URLの形式が正しくありません' }); return; }
  if (!/^https?:$/.test(parsed.protocol)) { send(400, { error: 'BAD_URL', message: 'http/httpsのURLだけ取得できます' }); return; }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 25000);
  try {
    const ytId = youtubeIdOf(parsed);
    if (ytId) {
      const y = await fetchYoutube(ytId, ctl.signal);
      if (!y) { send(502, { error: 'FETCH_FAILED', message: 'YouTube動画の情報を取得できませんでした（非公開・削除済みの可能性）' }); return; }
      send(200, y);
      return;
    }
    const r = await fetch(parsed.href, {
      redirect: 'follow',
      signal: ctl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36', 'Accept-Language': 'ja,en;q=0.8' },
    });
    if (!r.ok) { send(502, { error: 'FETCH_FAILED', message: `取得できませんでした（HTTP ${r.status}）` }); return; }
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > FETCH_MAX_BYTES) { send(413, { error: 'TOO_LARGE', message: 'ファイルが大きすぎます（15MBまで）' }); return; }
    const ct = r.headers.get('content-type') || '';
    const fileName = decodeURIComponent(parsed.pathname.split('/').pop() || parsed.hostname);
    if (/application\/pdf/i.test(ct) || buf.slice(0, 5).toString('latin1') === '%PDF-') {
      send(200, { kind: 'pdf', title: fileName, base64: buf.toString('base64') });
      return;
    }
    let html;
    try { html = new TextDecoder(charsetOf(ct, buf.slice(0, 4096))).decode(buf); } catch { html = buf.toString('utf8'); }
    if (/text\/plain/i.test(ct)) { send(200, { kind: 'text', title: fileName, text: html.slice(0, 60000) }); return; }
    const { title, text } = htmlToText(html);
    if (text.length < 80) { send(422, { error: 'NO_TEXT', message: '本文を読み取れませんでした（ログインが必要なページ・画像中心のページなど）。本文をコピーして「テキスト」で追加してください。' }); return; }
    send(200, { kind: 'text', title: title || parsed.hostname, text });
  } catch (e) {
    send(502, { error: 'FETCH_FAILED', message: e && e.name === 'AbortError' ? '時間内に取得できませんでした' : String(e && e.message ? e.message : e) });
  } finally {
    clearTimeout(timer);
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
  if (pathname === '/api/fetch-url' && req.method === 'GET') { handleFetchUrl(req, res); return; }
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
