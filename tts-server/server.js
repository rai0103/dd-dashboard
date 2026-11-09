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

// Stage F-1：自動実行（タスクスケジューラ登録・進捗・ファイル保存）関連エンドポイント専用のガード。
// schtasksの実行やファイル書き込みを行うため、/api/chat等の既存エンドポイントより一段厳しく、
// localhostからのアクセスのみを許可する（investment-shortsのisLocalと同じ考え方）。
function isLocal(req) {
  const host = (req.headers.host || '').toLowerCase();
  return host.startsWith('localhost') || host.startsWith('127.0.0.1') || host.startsWith('[::1]');
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

// AIによる参考情報の自動検索（Claude のWeb検索ツール + Gemini のGoogle検索グラウンディング）。
// 「テーマと参考情報」画面で、テーマから関連URL・要約テキストをまとめて取得するために使う。
// 2つを並行して呼び、片方が失敗してももう片方の結果はそのまま返す（それぞれのerrorで個別に分かる）。
async function researchWithClaude(prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { text: '', urls: [], error: 'tts-server/.env に ANTHROPIC_API_KEY が設定されていません。' };
  const model = (process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5');
  const payload = {
    model,
    max_tokens: 1536,
    messages: [{ role: 'user', content: prompt }],
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
  };
  let data;
  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    data = await upstream.json();
    if (!upstream.ok) {
      const m = (data && data.error && data.error.message) || `HTTP ${upstream.status}`;
      return { text: '', urls: [], error: `Claudeの検索に失敗しました: ${m}` };
    }
  } catch (e) {
    return { text: '', urls: [], error: `Claudeの検索に失敗しました: ${String(e && e.message ? e.message : e)}` };
  }
  const blocks = Array.isArray(data.content) ? data.content : [];
  let lastResultIdx = -1;
  blocks.forEach((b, i) => { if (b && b.type === 'web_search_tool_result') lastResultIdx = i; });
  const text = blocks.slice(lastResultIdx + 1).filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('');
  const urls = [];
  const seen = new Set();
  blocks.forEach((b) => {
    if (b && b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
      b.content.forEach((item) => {
        if (item && item.type === 'web_search_result' && item.url && !seen.has(item.url)) {
          seen.add(item.url);
          urls.push({ url: item.url, title: item.title || item.url });
        }
      });
    }
  });
  return { text, urls };
}

async function researchWithGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { text: '', urls: [], error: 'tts-server/.env に GEMINI_API_KEY が設定されていません。' };
  const model = (process.env.GEMINI_SEARCH_MODEL || 'gemini-3.8-flash');
  const payload = { contents: [{ parts: [{ text: prompt }] }], tools: [{ google_search: {} }] };
  let data;
  try {
    const upstream = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    data = await upstream.json();
    if (!upstream.ok) {
      const m = (data && data.error && data.error.message) || `HTTP ${upstream.status}`;
      return { text: '', urls: [], error: `Geminiの検索に失敗しました: ${m}` };
    }
  } catch (e) {
    return { text: '', urls: [], error: `Geminiの検索に失敗しました: ${String(e && e.message ? e.message : e)}` };
  }
  const cand = data && Array.isArray(data.candidates) ? data.candidates[0] : null;
  const parts = cand && cand.content && Array.isArray(cand.content.parts) ? cand.content.parts : [];
  const text = parts.filter((p) => typeof p.text === 'string').map((p) => p.text).join('');
  const chunks = cand && cand.groundingMetadata && Array.isArray(cand.groundingMetadata.groundingChunks) ? cand.groundingMetadata.groundingChunks : [];
  const urls = [];
  const seen = new Set();
  chunks.forEach((c) => {
    const uri = c && c.web && c.web.uri;
    if (uri && !seen.has(uri)) { seen.add(uri); urls.push({ url: uri, title: (c.web && c.web.title) || uri }); }
  });
  return { text, urls };
}

async function handlePostResearch(req, res) {
  const body = await readJsonBody(req);
  const topic = body && typeof body.topic === 'string' ? body.topic.trim() : '';
  const focus = body && typeof body.focus === 'string' ? body.focus.trim() : '';
  if (!topic) {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'BAD_REQUEST', message: 'topic が空です。' }));
    return;
  }
  // focus（検索プロンプト）がある場合、「focusの語句だけを単独で検索してテーマと無関係な結果が
  // 混ざる」ことがあったため、Web検索のキーワードには必ずテーマの固有名詞を含め、focusは
  // 「テーマに加えて特に注目する観点」として扱うよう明示的に指示する。
  const prompt = focus
    ? `次のニュース・キーワードについて、動画解説の参考資料として使える内容を、最新のWeb情報に基づいて日本語で詳しく要約してください（400〜600字程度）。数値・日付・固有名詞はできるだけ正確に、出典ごとに書き分けず一つの文章としてまとめてください。\n\nテーマ: ${topic}\n\n上記テーマに加えて、特に次の観点を中心に調べてください: ${focus}\n\n重要：Web検索のキーワードには、上記テーマの固有名詞（人名・組織名・地名・制度名など）を必ず含めてください。「${focus}」という語句だけを単独で検索しないでください（テーマと無関係な一般的な記事が混ざってしまいます）。検索は必ず「テーマ＋観点」の組み合わせで行ってください。`
    : `次のニュース・キーワードについて、動画解説の参考資料として使える内容を、最新のWeb情報に基づいて日本語で詳しく要約してください（400〜600字程度）。数値・日付・固有名詞はできるだけ正確に、出典ごとに書き分けず一つの文章としてまとめてください。\n\nテーマ: ${topic}`;
  const [claude, gemini] = await Promise.all([
    researchWithClaude(prompt).catch((e) => ({ text: '', urls: [], error: String(e && e.message ? e.message : e) })),
    researchWithGemini(prompt).catch((e) => ({ text: '', urls: [], error: String(e && e.message ? e.message : e) })),
  ]);
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ claude, gemini }));
}

// AI画像生成プロキシ（Gemini API の Imagen 経由。/api/chat と同じ理由でNext.js Route Handlerの外に実装する）。
// リクエストをそのままGemini APIへ中継するだけで、APIキーはユーザー自身のtts-server/.env
// （gitignore対象）のGEMINI_API_KEYから読む（Claudeが入力・保持することはない）。
async function handlePostImage(req, res) {
  const body = await readJsonBody(req);
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      error: 'NO_API_KEY',
      message: 'tts-server/.env に GEMINI_API_KEY が設定されていません（tts-server/.env.example を参考に設定してください）。',
    }));
    return;
  }
  const prompt = body && typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'BAD_REQUEST', message: 'prompt が空です。' }));
    return;
  }
  const aspectRatio = body && (body.aspectRatio === '9:16' || body.aspectRatio === '16:9') ? body.aspectRatio : '16:9';
  // 2026年8月にImagen 4系（predictエンドポイント）が廃止されたため、Gemini画像生成（generateContent、
  // responseModalities: ['TEXT','IMAGE']）に切り替え。既定モデルはGoogle公式ドキュメントの現行例に合わせる。
  const model = (process.env.GEMINI_IMAGE_MODEL || 'gemini-nano-banana-2.1');
  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio } },
  };
  try {
    const upstream = await fetch(`https://generativelanguage.googleapis.com/v1/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
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


// ==================== Stage F-1：平日朝の自動配信（タスクスケジューラ）用エンドポイント ====================
// 設定・進捗・保存先はすべてこのPC上のファイルに置く（ホームディレクトリの .dd-dashboard フォルダ）。
// investment-shortsの app/api/auto-schedule・app/api/save-output（同じ考え方のNext.js Route Handler）を
// 参考に、dd-dashboardは静的エクスポートのためNext.js Route Handlerを持てない分、ここ（tts-server）に
// 新規実装する（investment-shorts本体のコードは一切コピーしていない）。

const AUTO_TASK_PREFIX = 'DdDashboardAuto_';
const SCHTASK_DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function autoBaseDir() { return path.join(os.homedir(), '.dd-dashboard'); }
function autoCfgFile() { return path.join(autoBaseDir(), 'auto.json'); }
function autoRunsDir() { return path.join(autoBaseDir(), 'auto-runs'); }

// schtasks（Windows標準のタスクスケジューラCLI）を呼ぶ。出力は日本語Windowsの既定コードページ（Shift-JIS）
// で返ってくるため、investment-shortsのschtasks呼び出しと同じデコード方法を使う。
function schtasksExec(args) {
  return new Promise((resolve) => {
    execFile('schtasks', args, { windowsHide: true, encoding: 'buffer', maxBuffer: 4 * 1024 * 1024 }, (e, so, se) => {
      const buf = Buffer.concat([so || Buffer.alloc(0), se || Buffer.alloc(0)]);
      let out;
      try { out = new TextDecoder('shift_jis').decode(buf); } catch (e2) { out = buf.toString('utf8'); }
      resolve({ code: e ? (e.code === 'ENOENT' ? -1 : 1) : 0, out: out.trim() });
    });
  });
}

// schtasks /FO CSV の出力（引用符内のカンマに対応した簡易パーサー）
function parseCsvLine(l) {
  const o = []; let cur = ''; let q = false;
  for (const ch of l) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) { o.push(cur); cur = ''; }
    else cur += ch;
  }
  o.push(cur);
  return o;
}

async function listAutoTasks() {
  const r = await schtasksExec(['/Query', '/FO', 'CSV', '/V', '/NH']);
  if (r.code === -1) return { error: 'schtasks が見つかりません（Windows専用の機能です）', tasks: [] };
  const tasks = r.out.split(/\r?\n/).map(parseCsvLine)
    .filter((c) => (c[1] || '').replace(/^\\/, '').startsWith(AUTO_TASK_PREFIX))
    .map((c) => ({ name: c[1].replace(/^\\/, ''), next: c[2], status: c[3], last: c[5], result: c[6] }));
  return { tasks };
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

// GET /api/auto-schedule            -> 保存済みの設定（auto.json）。無ければ null
// GET /api/auto-schedule?tasks=1    -> Windowsに登録済みのタスク一覧
async function handleGetAutoSchedule(req, res) {
  if (!isLocal(req)) { sendJson(res, 403, { error: 'forbidden' }); return; }
  const u = new URL(req.url, 'http://localhost');
  if (u.searchParams.get('tasks')) { sendJson(res, 200, await listAutoTasks()); return; }
  try {
    const txt = await fs.readFile(autoCfgFile(), 'utf-8');
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(txt);
  } catch (e) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end('null');
  }
}

// POST /api/auto-schedule { config?, register?, unregister? }
// config を渡すと auto.json に保存。register:true で既存の登録を消してから設定どおりに作り直す。
// unregister:true で登録の解除のみ（設定は残す）。
async function handlePostAutoSchedule(req, res) {
  if (!isLocal(req)) { sendJson(res, 403, { error: 'forbidden' }); return; }
  const body = await readJsonBody(req);
  try {
    if (body && body.config) {
      await fs.mkdir(autoBaseDir(), { recursive: true });
      await fs.writeFile(autoCfgFile(), JSON.stringify(body.config, null, 2));
    }
    if (!body || (!body.register && !body.unregister)) { sendJson(res, 200, { ok: true }); return; }
    if (process.platform !== 'win32') { sendJson(res, 400, { ok: false, error: 'Windows専用の機能です' }); return; }

    // 以前の登録を消してから、設定どおりに作り直す（investment-shortsの auto-schedule route と同じ手順）
    const cur = await listAutoTasks();
    for (const t of cur.tasks || []) await schtasksExec(['/Delete', '/F', '/TN', t.name]);
    if (body.unregister) { sendJson(res, 200, { ok: true, created: 0 }); return; }

    let cfg = body.config;
    if (!cfg) { try { cfg = JSON.parse(await fs.readFile(autoCfgFile(), 'utf-8')); } catch (e) { cfg = null; } }
    if (!cfg || !Array.isArray(cfg.jobs)) { sendJson(res, 400, { ok: false, error: '設定が見つかりません' }); return; }

    const script = path.join(__dirname, '..', 'scripts', 'auto-run.mjs');
    const errors = [];
    let created = 0;
    for (const j of cfg.jobs) {
      if (!j.enabled || !Array.isArray(j.days) || j.days.length === 0) continue;
      for (const t of (j.times || [])) {
        if (!/^\d{1,2}:\d{2}$/.test(String(t.time))) { errors.push(`${j.name}：時刻「${t.time}」が正しくありません`); continue; }
        const tr = `"${process.execPath}" "${script}" --job ${j.id} --time ${t.id}`;
        const r = await schtasksExec(['/Create', '/F', '/TN', `${AUTO_TASK_PREFIX}${j.id}_${t.id}`, '/TR', tr, '/SC', 'WEEKLY', '/D', j.days.map((d) => SCHTASK_DAYS[d]).join(','), '/ST', String(t.time).padStart(5, '0')]);
        if (r.code === 0) created++; else errors.push(`${j.name} ${t.time}：${r.out}`);
      }
    }
    sendJson(res, 200, { ok: errors.length === 0, created, errors });
  } catch (e) {
    sendJson(res, 500, { ok: false, error: e && e.message ? e.message : String(e) });
  }
}

// GET  /api/auto-status?run=<run|latest>  -> 実行状況のJSON（無ければ null）
// POST /api/auto-status { run, state, message, steps, results, ... } -> 実行状況を保存
async function handleGetAutoStatus(req, res) {
  if (!isLocal(req)) { sendJson(res, 403, { error: 'forbidden' }); return; }
  const u = new URL(req.url, 'http://localhost');
  const run = u.searchParams.get('run') || 'latest';
  if (!/^(latest|[A-Za-z0-9_-]+)$/.test(run)) { sendJson(res, 400, { error: 'bad run id' }); return; }
  const file = path.join(autoRunsDir(), run === 'latest' ? 'latest.json' : `${run}.json`);
  try {
    const txt = await fs.readFile(file, 'utf-8');
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(txt);
  } catch (e) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end('null');
  }
}

async function handlePostAutoStatus(req, res) {
  if (!isLocal(req)) { sendJson(res, 403, { error: 'forbidden' }); return; }
  const body = await readJsonBody(req);
  const run = body && body.run;
  if (!run || !/^[A-Za-z0-9_-]+$/.test(String(run))) { sendJson(res, 400, { ok: false, error: 'bad run id' }); return; }
  try {
    await fs.mkdir(autoRunsDir(), { recursive: true });
    const data = JSON.stringify({ ...body, updatedAt: Date.now() });
    await fs.writeFile(path.join(autoRunsDir(), `${run}.json`), data);
    await fs.writeFile(path.join(autoRunsDir(), 'latest.json'), data);
    sendJson(res, 200, { ok: true });
  } catch (e) {
    sendJson(res, 500, { ok: false, error: e && e.message ? e.message : String(e) });
  }
}

// フォルダ名・ファイル名として使えない文字を置き換える（パスの区切りや .. は使わせない）
function safeSeg(s) {
  const t = String(s == null ? '' : s).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').replace(/[. ]+$/, '');
  return (t || '_').slice(0, 120);
}
function resolveBase(dir) {
  const d = String(dir || '').trim();
  if (!d || !path.isAbsolute(d)) return null;
  return path.resolve(d);
}

// GET  /api/profile-snapshot  -> 保存済みの設定スナップショット（声・アバター・BGM・背景など、
//      Stage F-3のlib/videoProfileSnapshot.tsがexportVideoProfile()で作ったJSON文字列）。無ければ null
// POST /api/profile-snapshot  -> 本文（JSON文字列）をそのままファイルに保存する
async function handleGetProfileSnapshot(req, res) {
  if (!isLocal(req)) { sendJson(res, 403, { error: 'forbidden' }); return; }
  try {
    const txt = await fs.readFile(path.join(autoBaseDir(), 'profile-snapshot.json'), 'utf-8');
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(txt);
  } catch (e) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end('null');
  }
}
async function handlePostProfileSnapshot(req, res) {
  if (!isLocal(req)) { sendJson(res, 403, { error: 'forbidden' }); return; }
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString('utf-8');
    JSON.parse(text); // 形式だけ確認（壊れたJSONを保存しない）
    await fs.mkdir(autoBaseDir(), { recursive: true });
    await fs.writeFile(path.join(autoBaseDir(), 'profile-snapshot.json'), text);
    sendJson(res, 200, { ok: true, bytes: Buffer.byteLength(text) });
  } catch (e) {
    sendJson(res, 400, { ok: false, error: e && e.message ? e.message : String(e) });
  }
}

// GET /api/save-output?dir=<保存先フォルダ> -> そのフォルダに書き込めるか確認（無ければ作る）
async function handleGetSaveOutput(req, res) {
  if (!isLocal(req)) { sendJson(res, 403, { error: 'forbidden' }); return; }
  const u = new URL(req.url, 'http://localhost');
  const base = resolveBase(u.searchParams.get('dir') || '');
  if (!base) { sendJson(res, 400, { ok: false, error: 'フォルダは「C:\\Users\\…」のように、ドライブから始まる全体のパスで入力してください' }); return; }
  try {
    await fs.mkdir(base, { recursive: true });
    const probe = path.join(base, `.write-test-${Date.now()}`);
    await fs.writeFile(probe, 'ok');
    await fs.unlink(probe);
    sendJson(res, 200, { ok: true, dir: base });
  } catch (e) {
    sendJson(res, 400, { ok: false, error: `このフォルダには保存できません：${e && e.message ? e.message : e}` });
  }
}

// POST /api/save-output：1ファイルを保存。ヘッダー x-dir（保存先）, x-sub（サブフォルダ、/区切り）,
// x-name（ファイル名）はURLエンコード済み。本文がファイルの中身そのもの（バイト列）。
// 自動実行（無人）のときのMP4・サムネ・概要欄テキストの保存先として使う（File System Access APIの
// フォルダ選択ダイアログはユーザー操作が必須で無人実行では使えないため、サーバー側で直接書き込む）。
async function handlePostSaveOutput(req, res) {
  if (!isLocal(req)) { sendJson(res, 403, { error: 'forbidden' }); return; }
  const dec = (k) => { try { return decodeURIComponent(req.headers[k] || ''); } catch (e) { return ''; } };
  const base = resolveBase(dec('x-dir'));
  const name = safeSeg(dec('x-name'));
  if (!base || !dec('x-name')) { sendJson(res, 400, { ok: false, error: 'bad request' }); return; }
  const subs = dec('x-sub').split('/').filter(Boolean).map(safeSeg);
  const dir = path.join(base, ...subs);
  if (!dir.startsWith(base)) { sendJson(res, 400, { ok: false, error: 'bad path' }); return; }
  try {
    await fs.mkdir(dir, { recursive: true });
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const buf = Buffer.concat(chunks);
    const file = path.join(dir, name);
    await fs.writeFile(file, buf);
    sendJson(res, 200, { ok: true, file, bytes: buf.length });
  } catch (e) {
    sendJson(res, 500, { ok: false, error: e && e.message ? e.message : String(e) });
  }
}

// 著作権フリー画像の検索（日本文化動画アプリの画像検索を移植。詳細は tts-server/freeImages.js）
const freeImages = require('./freeImages');
async function handlePostFreeImages(req, res) {
  const body = await readJsonBody(req);
  try {
    const r = await freeImages.handlePostFreeImages(body || {});
    sendJson(res, r.status, r.json);
  } catch (e) {
    sendJson(res, 500, { error: 'UPSTREAM_ERROR', message: e && e.message ? e.message : String(e) });
  }
}
async function handlePostFreeImageRank(req, res) {
  const body = await readJsonBody(req);
  try {
    const r = await freeImages.handlePostFreeImageRank(body || {});
    sendJson(res, r.status, r.json);
  } catch (e) {
    sendJson(res, 500, { error: 'UPSTREAM_ERROR', message: e && e.message ? e.message : String(e) });
  }
}
async function handleGetFreeImageProxy(req, res) {
  try {
    await freeImages.handleGetFreeImageProxy(req.url || '', res);
  } catch (e) {
    if (!res.headersSent) { res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' }); }
    res.end(e && e.message ? e.message : 'proxy error');
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
  if (pathname === '/api/image' && req.method === 'POST') { handlePostImage(req, res); return; }
  if (pathname === '/api/research' && req.method === 'POST') { handlePostResearch(req, res); return; }
  if (pathname === '/api/free-images' && req.method === 'POST') { handlePostFreeImages(req, res); return; }
  if (pathname === '/api/free-images/rank' && req.method === 'POST') { handlePostFreeImageRank(req, res); return; }
  if (pathname === '/api/free-image-proxy' && req.method === 'GET') { handleGetFreeImageProxy(req, res); return; }
  if (pathname === '/api/fetch-url' && req.method === 'GET') { handleFetchUrl(req, res); return; }
  if (pathname === '/api/auto-schedule' && req.method === 'GET') { handleGetAutoSchedule(req, res); return; }
  if (pathname === '/api/auto-schedule' && req.method === 'POST') { handlePostAutoSchedule(req, res); return; }
  if (pathname === '/api/auto-status' && req.method === 'GET') { handleGetAutoStatus(req, res); return; }
  if (pathname === '/api/auto-status' && req.method === 'POST') { handlePostAutoStatus(req, res); return; }
  if (pathname === '/api/save-output' && req.method === 'GET') { handleGetSaveOutput(req, res); return; }
  if (pathname === '/api/save-output' && req.method === 'POST') { handlePostSaveOutput(req, res); return; }
  if (pathname === '/api/profile-snapshot' && req.method === 'GET') { handleGetProfileSnapshot(req, res); return; }
  if (pathname === '/api/profile-snapshot' && req.method === 'POST') { handlePostProfileSnapshot(req, res); return; }
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
