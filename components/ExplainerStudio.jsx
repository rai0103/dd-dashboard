"use client";
// ニュース・キーワード解説動画の作成画面（長尺16:9＋宣伝用ショート9:16）。
// DD戦略ダッシュボードの「長尺動画作成」（VideoCreateModalContent）のUI・仕組みをベースにしている：
//  - 左：Canvasプレビュー（再生・先頭へ・サムネ保存・書き出し）／右：構成→場面とナレーション→アバター→声→背景→BGM
//  - アバター・声（ローカルTTS／AivisSpeech・登録した声）・背景・BGMは、同じブラウザ内の保存データ（IndexedDB・localStorage）を
//    そのまま共有する（同じサイト内のページなので、長尺動画作成で登録したものがここでも選べる）。
// 違い：台本は「テーマ＋参考情報（テキスト・URL・PDF）」からAIが作る。図解はすべて自作の図形・アイコンで描く（著作権・肖像権への配慮）。
import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause, Square, Camera, Download, Upload, X, GripVertical, MessageSquare, ChevronRight, Lock, Unlock, Link2, FileText, Type, Sparkles, Copy, AlertTriangle, Check, Image as ImageIcon, RefreshCw, Plus, ArrowLeft } from "lucide-react";
import { voiceGender } from "@/lib/videoAnalysts";
import { AudioMixer, getTtsBaseUrl } from "@/lib/videoAudioMixer";
import { listAivisVoices, isAivisVoice, getAivisUrl } from "@/lib/videoAivisClient";
import { loadVoicePresets, saveVoicePresets } from "@/lib/videoVoicePresets";
import { VideoExporter } from "@/lib/videoExporter";
import { listBgms, saveBgm, deleteBgm } from "@/lib/videoBgmLibrary";
import { listBackgrounds, saveBackground, deleteBackground } from "@/lib/videoBackgroundLibrary";
import { listAvatars, saveAvatar, deleteAvatar, newAvatar, MAX_CLIPS } from "@/lib/videoAvatarLibrary";
import { VideoAvatar } from "@/lib/videoAvatarRender";
import { ExplainerRenderer, RENDER_SIZE } from "@/lib/explainer/renderer";
import { generateProject, generateShort, rewriteScene, CHARS_PER_MIN } from "@/lib/explainer/aiScript";
import { AiClientError } from "@/lib/explainer/aiClient";
import { referenceBlocks, referenceTexts, fetchUrlReference, fileToBase64, newRefId, refLabel, MAX_PDF_BYTES } from "@/lib/explainer/references";
import { lintScenes, buildDescription, sourcesScene, findVerbatimOverlaps, predictTotalSec, suggestRate, COMFORT_RATE, normalizeVisual, minSecFor, sanitizeReading, isKanaReading } from "@/lib/explainer/scriptModel";
import { saveImage, listImages, deleteImage } from "@/lib/explainer/imageStore";
import { safeFileName, canPickFolder, getSavedFolder, pickFolder, ensureWritable, saveBundle, descriptionText } from "@/lib/explainer/exportBundle";
import { VISUAL_KINDS, ICON_NAMES } from "@/lib/explainer/types";

const C = {
  bg: "#0A0F1C", panel: "#111A2C", panel2: "#0D1424",
  border: "#22304C", borderSoft: "#1A2540",
  text: "#E7ECF3", textMuted: "#8592AC", textDim: "#56637F",
  teal: "#45C4B0", amber: "#D9A24B", rust: "#C0654B", blue: "#5B90C7",
};
const KIND_LABEL = {
  title: "タイトル", keyword: "用語カード", points: "要点カード", number: "大きな数字", bar: "棒グラフ", line: "折れ線グラフ", donut: "円グラフ",
  timeline: "年表", flow: "流れ図", compare: "比較", cycle: "循環図", illustration: "イメージ図", image: "画像", point: "ポイント", qa: "Q&A",
  summary: "まとめ", cta: "締め", chapter: "章の扉", sources: "参考資料",
};
// 取り込み元のページのConsoleで実行する1行：localStorageの中から「登録した声」の形の配列を探してクリップボードにコピーする
const PRESET_EXPORT_SNIPPET = `copy(JSON.stringify(Object.keys(localStorage).flatMap(k=>{try{const v=JSON.parse(localStorage.getItem(k));return Array.isArray(v)&&v.length&&v.every(p=>p&&typeof p.name==='string'&&typeof p.voice==='string')?v:[]}catch(e){return[]}})))`;
const LENGTH_OPTIONS = [3, 4, 5, 6, 7, 8];
const PROJECT_KEY = "explainer-project-v1";
const INPUT_KEY = "explainer-input-v1";
// 長尺動画作成（DDDashboard.jsx）と同じキー：スライダーのロック値を共有する
const VIDEO_SLIDER_LOCK_KEY = "video-slider-locks-v1";
const loadSliderLocks = () => { try { const v = JSON.parse(localStorage.getItem(VIDEO_SLIDER_LOCK_KEY) || "{}"); return v && typeof v === "object" ? v : {}; } catch (e) { return {}; } };
const saveSliderLocks = (m) => { try { localStorage.setItem(VIDEO_SLIDER_LOCK_KEY, JSON.stringify(m)); } catch (e) { /* ignore */ } };
const sliderInitValue = (key, fallback) => { const l = loadSliderLocks(); return l[key]?.locked && typeof l[key]?.value === "number" ? l[key].value : fallback; };
// 読み上げに使う文：ナレーションを直して読み上げ文が古いあいだは、通常の文をそのまま読ませる
const ttsText = (sc) => (sc.readingStale || !sc.reading ? sc.narration : sc.reading);
const fmtTime = (sec) => { const s = Math.max(0, Math.round(sec || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`; };
const btn = (variant = "ghost") => variant === "primary"
  ? { background: C.teal, color: C.bg, fontWeight: 700, border: "none", cursor: "pointer" }
  : variant === "amber" ? { background: C.amber, color: C.bg, fontWeight: 700, border: "none", cursor: "pointer" }
  : { background: "transparent", color: C.teal, border: `1px solid ${C.teal}66`, cursor: "pointer" };
const inputStyle = { background: C.panel2, border: `1px solid ${C.borderSoft}`, color: C.text };

function SliderLockButton({ locked, onClick }) {
  return (
    <button type="button" onClick={onClick} title={locked ? "ロック中（次回もこの値で始まります）" : "クリックでロック（次回もこの値で始まります）"} className="inline-flex items-center justify-center rounded" style={{ width: 20, height: 20, background: locked ? `${C.teal}22` : "transparent", border: `1px solid ${locked ? C.teal : C.borderSoft}`, color: locked ? C.teal : C.textMuted, cursor: "pointer", flexShrink: 0 }}>
      {locked ? <Lock size={11} /> : <Unlock size={11} />}
    </button>
  );
}
function Section({ title, right, children }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5 gap-2">
        <div className="text-[11px] font-semibold" style={{ color: C.textMuted }}>{title}</div>
        {right}
      </div>
      {children}
    </div>
  );
}
function copyText(t) { try { navigator.clipboard.writeText(t); } catch (e) { /* ignore */ } }

// 図解の項目を「見出し｜数値｜説明｜アイコン」の行で編集する
const itemsToText = (items) => items.map((it) => [it.label, it.value, it.text.replace(/\n/g, "／"), it.icon].join("｜")).join("\n");
const textToItems = (s) => s.split("\n").map((ln) => ln.trim()).filter(Boolean).map((ln) => { const [label = "", value = "", text = "", icon = "bulb"] = ln.split(/[｜|]/); return { label: label.trim(), value: value.trim(), text: text.trim().replace(/／/g, "\n"), icon: icon.trim() }; });

export default function ExplainerStudio() {
  // ---------------- 入力（テーマ・参考情報） ----------------
  const saved0 = useMemo(() => { try { return JSON.parse(localStorage.getItem(INPUT_KEY) || "null"); } catch (e) { return null; } }, []);
  const [topic, setTopic] = useState(saved0?.topic ?? "");
  const [mode, setMode] = useState(saved0?.mode ?? "news");
  const [audience, setAudience] = useState(saved0?.audience ?? "beginner");
  const [targetMinutes, setTargetMinutes] = useState(Math.min(8, Math.max(3, saved0?.targetMinutes ?? 5)));
  const [extraInstruction, setExtraInstruction] = useState(saved0?.extraInstruction ?? "");
  const [refs, setRefs] = useState(() => (saved0?.refs ?? []).filter((r) => r.kind !== "pdf"));
  useEffect(() => {
    // PDFは容量が大きいため保存しない（テキストとURLの本文は保存して次回も使える）
    const keep = refs.filter((r) => r.kind !== "pdf").map((r) => (r.kind === "url" ? { ...r, pdfBase64: undefined, status: r.pdfBase64 ? "pending" : r.status } : r));
    try { localStorage.setItem(INPUT_KEY, JSON.stringify({ topic, mode, audience, targetMinutes, extraInstruction, refs: keep })); } catch (e) { /* 容量超過などは無視 */ }
  }, [topic, mode, audience, targetMinutes, extraInstruction, refs]);
  const [refTextOpen, setRefTextOpen] = useState(false);
  const [refTextTitle, setRefTextTitle] = useState("");
  const [refTextBody, setRefTextBody] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [inputOpen, setInputOpen] = useState(true);

  const addTextRef = () => {
    if (!refTextBody.trim()) return;
    setRefs((p) => [...p, { id: newRefId(), kind: "text", title: refTextTitle.trim() || `テキスト${p.filter((r) => r.kind === "text").length + 1}`, text: refTextBody }]);
    setRefTextBody(""); setRefTextTitle(""); setRefTextOpen(false);
  };
  const loadUrl = async (id, url) => {
    setRefs((p) => p.map((r) => (r.id === id ? { ...r, status: "pending", error: undefined } : r)));
    try {
      const got = await fetchUrlReference(url);
      setRefs((p) => p.map((r) => (r.id === id ? { ...r, status: "ok", title: got.title, text: got.text, pdfBase64: got.pdfBase64, note: got.note } : r)));
    } catch (e) {
      setRefs((p) => p.map((r) => (r.id === id ? { ...r, status: "error", error: e?.message || String(e) } : r)));
    }
  };
  const addUrls = () => {
    const urls = urlInput.split(/\s+/).map((s) => s.trim()).filter((s) => /^https?:\/\//i.test(s));
    if (!urls.length) return;
    const items = urls.map((url) => ({ id: newRefId(), kind: "url", url, title: url, text: "", status: "pending" }));
    setRefs((p) => [...p, ...items]);
    setUrlInput("");
    items.forEach((it) => loadUrl(it.id, it.url));
  };
  // 前回保存したURL（PDFは保存しないため再取得が必要）を、開いたときに読み直す
  useEffect(() => { refs.filter((r) => r.kind === "url" && r.status === "pending").forEach((r) => loadUrl(r.id, r.url)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const addPdfs = async (files) => {
    for (const f of Array.from(files || [])) {
      if (!(f.type === "application/pdf" || /\.pdf$/i.test(f.name))) { alert(`PDFではありません：${f.name}`); continue; }
      if (f.size > MAX_PDF_BYTES) { alert(`PDFが大きすぎます（30MBまで）：${f.name}`); continue; }
      const base64 = await fileToBase64(f);
      setRefs((p) => [...p, { id: newRefId(), kind: "pdf", title: f.name.replace(/\.pdf$/i, ""), base64, sizeBytes: f.size }]);
    }
  };

  // ---------------- プロジェクト（台本） ----------------
  const [project, setProject] = useState(() => {
    try {
      const v = JSON.parse(localStorage.getItem(PROJECT_KEY) || "null");
      if (!v || v.version !== 1) return null;
      // 「参考資料を動画に入れる」がオフなら、以前の台本に入っている参考資料の場面を外す
      if (localStorage.getItem("explainer-sources-in-video-v1") !== "1") v.longScenes = v.longScenes.filter((s) => s.visual.kind !== "sources");
      return v;
    } catch (e) { return null; }
  });
  useEffect(() => { if (project) { try { localStorage.setItem(PROJECT_KEY, JSON.stringify(project)); } catch (e) { /* ignore */ } } }, [project]);
  useEffect(() => { if (project) setInputOpen(false); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const [format, setFormat] = useState("long");
  const scenes = project ? (format === "long" ? project.longScenes : project.shortScenes) : [];
  const setScenes = (fn) => setProject((p) => {
    if (!p) return p;
    const key = format === "long" ? "longScenes" : "shortScenes";
    const next = typeof fn === "function" ? fn(p[key]) : fn;
    return { ...p, [key]: next };
  });
  const patchScene = (id, patch) => setScenes((list) => list.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const patchVisual = (id, patch) => setScenes((list) => list.map((s) => (s.id === id ? { ...s, visual: { ...s.visual, ...patch } } : s)));

  const [genBusy, setGenBusy] = useState(false);
  const [genProgress, setGenProgress] = useState(null);
  const [genError, setGenError] = useState("");
  const abortRef = useRef(null);
  const genInput = (minutes = targetMinutes) => ({ topic: topic.trim(), mode, audience, targetMinutes: minutes, extraInstruction, refBlocks: referenceBlocks(refs), today: todayStr(), speechRate: rate });
  const errMsg = (e) => (e instanceof AiClientError ? e.message : e?.message || String(e));
  const handleGenerate = async (minutesOverride) => {
    const minutes = typeof minutesOverride === "number" ? minutesOverride : targetMinutes;
    if (!topic.trim()) { setGenError("テーマ（ニュースやキーワード）を入力してください。"); return; }
    if (refs.some((r) => r.kind === "url" && r.status === "pending")) { setGenError("URLの読み込みが終わるまでお待ちください。"); return; }
    if (project && !confirm(`いまの台本を、${minutes}分以内・声の速さ${rate.toFixed(2)}xに合わせて新しく作り直します。よろしいですか？（現在の台本は「台本を保存」で残せます）`)) return;
    if (minutes !== targetMinutes) setTargetMinutes(minutes);
    setGenBusy(true); setGenError("");
    const ac = new AbortController(); abortRef.current = ac;
    try {
      const inp = genInput(minutes);
      let p = await generateProject(inp, setGenProgress, ac.signal, true, sourcesInVideo);
      // 参考資料の文章とほぼ同じ箇所は、自動で言い換える（長尺・ショート）
      const L = await paraphraseScenes(p.longScenes, inp, p.videoTitle, "long", ac.signal, (k, n) => setGenProgress({ step: `参考資料と同じ言い回しを言い換え中…（長尺 ${k}/${n}）`, done: 1, total: 1 }));
      const S = await paraphraseScenes(p.shortScenes, inp, p.videoTitle, "short", ac.signal, (k, n) => setGenProgress({ step: `参考資料と同じ言い回しを言い換え中…（ショート ${k}/${n}）`, done: 1, total: 1 }));
      p = { ...p, longScenes: L.scenes, shortScenes: S.scenes };
      setProject(p); setFormat("long"); setInputOpen(false); setSeekPos(0);
    } catch (e) { setGenError(errMsg(e)); }
    finally { setGenBusy(false); setGenProgress(null); abortRef.current = null; }
  };
  // 参考資料の文章とほぼ同じ箇所があるナレーションを、AIに言い換えさせる（図解・場面の役割はそのまま）
  const PARA_INSTR = (ov) => `ナレーションの中に、参考資料の文章とほぼ同じ言い回しがあります（${ov.map((x) => `「${x.slice(0, 40)}」`).join("、")}）。事実・数値・固有名詞は変えずに、語順や言い回しを変えて自分の言葉で言い換えてください。長さはほぼ同じに。図解（visual）は変えないこと。読み上げ文（reading）も合わせて作り直すこと。`;
  const paraphraseScenes = async (list, inp, title, fmt, signal, onStep) => {
    const texts = referenceTexts(refs);
    const out = list.slice();
    const targets = out.map((sc, i) => ({ i, ov: findVerbatimOverlaps(sc.narration, texts) })).filter((x) => x.ov.length);
    for (let k = 0; k < targets.length; k++) {
      const { i, ov } = targets[k];
      onStep?.(k + 1, targets.length);
      try {
        const neighbors = [out[i - 1], out[i + 1]].filter(Boolean).map((x) => x.narration);
        const sc = await rewriteScene(inp, title, PARA_INSTR(ov), out[i], neighbors, fmt, signal);
        // 図解は元のまま残す（言い換えで図解が変わらないように）
        out[i] = { ...sc, visual: out[i].visual, minSec: out[i].minSec, title: out[i].title };
      } catch (e) { if (e?.code === "ABORTED") throw e; /* 1場面失敗しても続ける */ }
    }
    return { scenes: out, count: targets.length };
  };
  const [paraBusyId, setParaBusyId] = useState(null);
  const paraphraseOne = async (sc) => {
    if (!project) return;
    const ov = findVerbatimOverlaps(sc.narration, referenceTexts(refs));
    if (!ov.length) return;
    setParaBusyId(sc.id); setAiError("");
    try {
      const idx = scenes.findIndex((x) => x.id === sc.id);
      const neighbors = [scenes[idx - 1], scenes[idx + 1]].filter(Boolean).map((x) => x.narration);
      const nsc = await rewriteScene(genInput(), project.videoTitle, PARA_INSTR(ov), sc, neighbors, format);
      setScenes((list) => list.map((x) => (x.id === sc.id ? { ...nsc, visual: x.visual, minSec: x.minSec, title: x.title } : x)));
    } catch (e) { setAiError(errMsg(e)); }
    finally { setParaBusyId(null); }
  };

  const [paraAllBusy, setParaAllBusy] = useState("");
  const paraphraseAll = async () => {
    if (!project) return;
    setParaAllBusy("言い換え中…"); setAiError("");
    try {
      const r = await paraphraseScenes(scenes, genInput(), project.videoTitle, format, undefined, (k, n) => setParaAllBusy(`言い換え中…（${k}/${n}）`));
      setScenes(r.scenes);
    } catch (e) { setAiError(errMsg(e)); }
    finally { setParaAllBusy(""); }
  };

  const handleRegenerateShort = async () => {
    if (!project) return;
    setGenBusy(true); setGenError(""); setGenProgress({ step: "宣伝用ショートを作り直し中…", done: 0, total: 1 });
    const ac = new AbortController(); abortRef.current = ac;
    try {
      const o = { videoTitle: project.videoTitle, kicker: project.kicker, chapters: project.chapters, youtube: project.youtube, sources: project.sources };
      const inp = genInput();
      const sh0 = await generateShort(inp, o, project.longScenes, ac.signal);
      const sh = (await paraphraseScenes(sh0, inp, project.videoTitle, "short", ac.signal, (k, n) => setGenProgress({ step: `参考資料と同じ言い回しを言い換え中…（${k}/${n}）`, done: 0, total: 1 }))).scenes;
      setProject((p) => ({ ...p, shortScenes: sh })); setFormat("short");
    } catch (e) { setGenError(errMsg(e)); }
    finally { setGenBusy(false); setGenProgress(null); abortRef.current = null; }
  };
  const saveProjectFile = () => {
    if (!project) return;
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `explainer_${(project.topic || "project").slice(0, 20)}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  const loadProjectFile = async (file) => {
    try { const v = JSON.parse(await file.text()); if (v?.version !== 1 || !Array.isArray(v.longScenes)) throw new Error("形式が違います"); setProject(v); setTopic(v.topic || ""); setInputOpen(false); setSeekPos(0); }
    catch (e) { alert(`読み込めませんでした：${e.message}`); }
  };

  // ---------------- 構成（並べ替え・削除・AIで追加） ----------------
  const dragIdxRef = useRef(null);
  const moveScene = (from, to) => setScenes((prev) => { if (from === to || from < 0 || to < 0) return prev; const nx = prev.slice(); const [it] = nx.splice(from, 1); nx.splice(to, 0, it); return nx; });
  const removeScene = (id) => setScenes((prev) => prev.filter((s) => s.id !== id));
  const [aiOpenId, setAiOpenId] = useState(null); // 場面ごとの「AIに指示」。"__new" なら新しい場面の追加
  const [aiText, setAiText] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const runSceneAi = async (sceneId) => {
    const instr = aiText.trim();
    if (!instr || !project) return;
    setAiBusy(true); setAiError("");
    try {
      const idx = sceneId === "__new" ? scenes.length : scenes.findIndex((s) => s.id === sceneId);
      const cur = sceneId === "__new" ? null : scenes[idx];
      const neighbors = [scenes[idx - 1], scenes[sceneId === "__new" ? idx : idx + 1]].filter(Boolean).map((s) => s.narration);
      const sc = await rewriteScene(genInput(), project.videoTitle, instr, cur, neighbors, format);
      if (cur) setScenes((list) => list.map((s) => (s.id === cur.id ? sc : s)));
      else {
        const at = Math.max(0, currentSceneIdx + 1);
        const chapter = scenes[currentSceneIdx]?.chapter ?? 0;
        setScenes((list) => { const nx = list.slice(); nx.splice(at, 0, { ...sc, chapter }); return nx; });
      }
      setAiOpenId(null); setAiText("");
    } catch (e) { setAiError(errMsg(e)); }
    finally { setAiBusy(false); }
  };
  const [editVisualId, setEditVisualId] = useState(null);
  const [readingOpenId, setReadingOpenId] = useState(null);

  // ---------------- 画像（権利を確認したものだけ・場面ごと） ----------------
  const [images, setImages] = useState([]);
  const refreshImages = () => listImages().then(setImages).catch(() => {});
  useEffect(() => { refreshImages(); }, []);
  const [imageEls, setImageEls] = useState({});
  useEffect(() => {
    const urls = [];
    const els = {};
    let left = images.length;
    if (!left) { setImageEls({}); return; }
    images.forEach((im) => {
      const u = URL.createObjectURL(im.blob); urls.push(u);
      const el = new Image(); el.onload = () => { left -= 1; if (left <= 0) setImageEls({ ...els }); }; el.onerror = el.onload; el.src = u; els[im.id] = el;
    });
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [images]);
  const [rightsPendingId, setRightsPendingId] = useState(null);
  const attachImage = async (sceneId, file) => {
    if (!file || !file.type.startsWith("image/")) { alert("画像ファイルを選んでください"); return; }
    const im = await saveImage(file);
    await refreshImages();
    setScenes((list) => list.map((s) => (s.id === sceneId ? { ...s, imageId: im.id, visual: { ...s.visual, kind: "image" } } : s)));
    setRightsPendingId(null);
  };
  const detachImage = async (sc) => {
    const id = sc.imageId;
    patchScene(sc.id, { imageId: null });
    const usedElsewhere = project && [...project.longScenes, ...project.shortScenes].some((s) => s.imageId === id && s.id !== sc.id);
    if (id && !usedElsewhere) { await deleteImage(id).catch(() => {}); refreshImages(); }
  };

  // ---------------- アバター（長尺動画作成と共通の保存データ） ----------------
  const [avatars, setAvatars] = useState([]);
  const [avatarId, setAvatarId] = useState(() => { try { return localStorage.getItem("explainer-avatar-v1") || null; } catch (e) { return null; } });
  useEffect(() => { try { if (avatarId) localStorage.setItem("explainer-avatar-v1", avatarId); } catch (e) { /* ignore */ } }, [avatarId]);
  const [avatarObj, setAvatarObj] = useState(null);
  const [avatarEditorOpen, setAvatarEditorOpen] = useState(false);
  const avatarUrlsRef = useRef([]);
  const seekPosRef = useRef(0);
  const refreshAvatars = async () => {
    try { const items = await listAvatars(); setAvatars(items); setAvatarId((prev) => (prev && items.some((m) => m.id === prev) ? prev : items[0]?.id ?? null)); }
    catch (e) { console.warn("アバターを読み込めません", e); }
  };
  useEffect(() => { refreshAvatars(); }, []);
  const curAvatar = avatars.find((a) => a.id === avatarId) ?? null;
  const clipSig = curAvatar ? curAvatar.clips.map((c) => (c ? `${c.name}:${c.blob.size}` : "-")).join("|") : "";
  useEffect(() => {
    avatarUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
    avatarUrlsRef.current = [];
    setAvatarObj(null);
    if (!curAvatar) return;
    const blobs = curAvatar.clips.filter(Boolean);
    if (!blobs.length) return;
    let cancelled = false;
    const vids = blobs.map((c) => { const v = document.createElement("video"); const url = URL.createObjectURL(c.blob); avatarUrlsRef.current.push(url); v.muted = true; v.loop = false; v.playsInline = true; v.preload = "auto"; v.src = url; return v; });
    Promise.all(vids.map((v) => new Promise((res) => { if (v.readyState >= 2) { res(); return; } v.addEventListener("loadeddata", () => res(), { once: true }); v.addEventListener("error", () => res(), { once: true }); }))).then(() => {
      if (cancelled) return;
      const av = new VideoAvatar(vids, { keyOn: curAvatar.keyOn, tol: curAvatar.tol, zoom: curAvatar.zoom });
      av.onRedraw = () => { const r = rendererRef.current; if (r && !isPlayingRef.current) r.draw(seekPosRef.current ?? 0); };
      setAvatarObj(av);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avatarId, clipSig]);
  useEffect(() => {
    if (avatarObj && curAvatar) { avatarObj.setOptions({ keyOn: curAvatar.keyOn, tol: curAvatar.tol, zoom: curAvatar.zoom }); const r = rendererRef.current; if (r && !isPlayingRef.current) r.draw(seekPosRef.current ?? 0); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curAvatar?.keyOn, curAvatar?.tol, curAvatar?.zoom, avatarObj]);
  const patchAvatar = (id, patch) => setAvatars((prev) => prev.map((a) => { if (a.id !== id) return a; const nx = { ...a, ...patch }; saveAvatar(nx).catch((err) => console.warn(err)); return nx; }));
  const addAvatar = async () => { const a = newAvatar(`アバター${avatars.length + 1}`); try { await saveAvatar(a); } catch (err) { alert("登録できませんでした"); return; } await refreshAvatars(); setAvatarId(a.id); };
  const removeAvatarHandler = async (id) => { if (!confirm("このアバター（動画も含む）を登録から削除しますか？（長尺動画作成からも消えます）")) return; try { await deleteAvatar(id); } catch (err) { console.warn(err); } refreshAvatars(); };
  const setAvatarClip = (id, slot, file) => {
    const a = avatars.find((x) => x.id === id); if (!a) return;
    if (file && !(file.type.startsWith("video/") || /\.(mp4|m4v|mov|webm)$/i.test(file.name))) { alert(`動画ではありません: ${file.name}`); return; }
    const clips = a.clips.slice(); while (clips.length < MAX_CLIPS) clips.push(null);
    clips[slot] = file ? { name: file.name, blob: file } : null;
    patchAvatar(id, { clips });
  };

  // ---------------- 声（ローカルTTS・AivisSpeech・登録した声：長尺動画作成と共通） ----------------
  const mixerRef = useRef(null);
  const mixer = () => (mixerRef.current ??= new AudioMixer());
  const [voices, setVoices] = useState([]);
  const [voicesLoaded, setVoicesLoaded] = useState(false);
  const [voiceIndex, setVoiceIndexState] = useState(() => { try { return localStorage.getItem("video-voice-v1") || ""; } catch (e) { return ""; } });
  const setVoiceIndex = (v) => { setVoiceIndexState(v); try { localStorage.setItem("video-voice-v1", v); } catch (e) { /* ignore */ } };
  const [voiceNote, setVoiceNote] = useState("");
  const [sliderLocks, setSliderLocks] = useState(loadSliderLocks);
  const toggleSliderLock = (key, value) => setSliderLocks((prev) => { const nx = { ...prev, [key]: { locked: !prev[key]?.locked, value } }; saveSliderLocks(nx); return nx; });
  const updateLocked = (key, value) => setSliderLocks((prev) => { if (!prev[key]?.locked) return prev; const nx = { ...prev, [key]: { locked: true, value } }; saveSliderLocks(nx); return nx; });
  const [rate, setRate] = useState(() => sliderInitValue("rate", 1.0));
  const [pitch, setPitch] = useState(() => sliderInitValue("pitch", 1.0));
  // 声の一覧（ローカルTTSサーバー＋AivisSpeech）。AivisSpeechは起動に時間がかかるため、
  // ページを開いた後に起動した場合も拾えるよう、AivisSpeechの声が見つかるまで画面に戻ったとき・一定間隔で読み直す
  const [voicesRefreshing, setVoicesRefreshing] = useState(false);
  const refreshVoices = async () => {
    setVoicesRefreshing(true);
    const serverVoices = await mixer().listServerVoices().catch(() => []);
    const aivisVoices = await listAivisVoices(4000).catch(() => []);
    setVoices([...serverVoices, ...aivisVoices]); setVoicesLoaded(true); setVoicesRefreshing(false);
    return aivisVoices.length > 0;
  };
  useEffect(() => {
    let stop = false, timer = 0, tries = 0;
    const loop = async () => {
      const found = await refreshVoices();
      tries += 1;
      if (!stop && !found && tries < 12) timer = window.setTimeout(loop, 10000);
    };
    loop();
    const onFocus = () => { if (!voicesRef.current.some(isAivisVoice)) refreshVoices(); };
    window.addEventListener("focus", onFocus);
    return () => { stop = true; clearTimeout(timer); window.removeEventListener("focus", onFocus); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const voicesRef = useRef([]);
  useEffect(() => { voicesRef.current = voices; }, [voices]);
  const avatarGender = avatarObj && curAvatar ? curAvatar.gender : "male";
  const voiceChoices = useMemo(() => voices.filter((v) => { const g = voiceGender(v); return g === null || g === avatarGender; }), [voices, avatarGender]);
  const nonAivisVoiceChoices = useMemo(() => voiceChoices.filter((v) => !isAivisVoice(v)), [voiceChoices]);
  useEffect(() => { if (voiceChoices.length > 0 && !voiceChoices.includes(voiceIndex)) setVoiceIndex(voiceChoices[0]); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [voiceChoices, voiceIndex]);
  const [voicePresets, setVoicePresets] = useState(loadVoicePresets);
  const [activePresetId, setActivePresetId] = useState(null);
  const [presetName, setPresetName] = useState("");
  const savePresetsList = (list) => { setVoicePresets(list); saveVoicePresets(list); };
  const SAMPLE = "きょうは、にゅーすの、ぽいんとを、わかりやすく、かいせつします。";
  const speak = async (reading, voiceId = voiceIndex, r = rate, p = pitch) => {
    if (!voiceId) return;
    try {
      mixer().stopNarration();
      const fb = nonAivisVoiceChoices[0] ?? "";
      const { buffer, usedFallback } = await mixer().fetchNarrationBufferSmart(reading, r, voiceId, p, fb);
      if (usedFallback) { setVoiceIndex(fb); setVoiceNote("AivisSpeechに接続できなかったため、既存の声に切り替えました。"); }
      if (buffer) mixer().playBufferAfter(buffer, 0);
    } catch (e) { alert(`音声合成に失敗しました（ローカルTTSサーバー ${getTtsBaseUrl()} が起動しているか確認してください）\n${e?.message ?? e}`); }
  };
  // AivisSpeechの声は「aivis:{スタイルID}:名前」。名前の表記（全角・半角など）が違っても、スタイルIDが同じなら同じ声として扱う
  const resolveVoice = (v) => {
    if (voices.includes(v)) return v;
    const m = /^aivis:(\d+):/.exec(v || "");
    if (m) { const hit = voices.find((x) => x.startsWith(`aivis:${m[1]}:`)); if (hit) return hit; }
    return v;
  };
  const applyPreset = (p0) => { const p = { ...p0, voice: resolveVoice(p0.voice) }; setVoiceIndex(p.voice); setRate(p.rate); setPitch(p.pitch); updateLocked("rate", p.rate); updateLocked("pitch", p.pitch); setActivePresetId(p.id); speak(SAMPLE, p.voice, p.rate, p.pitch); };
  // 他のサイト（investment-shorts等）で登録した声を取り込む。ブラウザの保存領域はサイトごとに別のため、JSONで受け渡す
  const [presetIoOpen, setPresetIoOpen] = useState(false);
  const [presetIoText, setPresetIoText] = useState("");
  const [presetIoNote, setPresetIoNote] = useState("");
  const importPresets = () => {
    let arr;
    try { arr = JSON.parse(presetIoText.trim()); } catch (e) { setPresetIoNote("読み取れませんでした（JSONを貼り付けてください）"); return; }
    if (arr && !Array.isArray(arr)) arr = Array.isArray(arr.presets) ? arr.presets : Object.values(arr);
    const valid = (Array.isArray(arr) ? arr : []).filter((p) => p && typeof p.name === "string" && typeof p.voice === "string").map((p) => ({
      id: typeof p.id === "string" ? p.id : `${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      name: p.name, voice: resolveVoice(p.voice), rate: Number(p.rate) || 1, pitch: Number(p.pitch) || 1,
    }));
    if (!valid.length) { setPresetIoNote("取り込める声が見つかりませんでした"); return; }
    const byName = new Map(voicePresets.map((p) => [p.name, p]));
    valid.forEach((p) => byName.set(p.name, { ...p, id: byName.get(p.name)?.id ?? p.id }));
    savePresetsList(Array.from(byName.values()));
    setPresetIoNote(`${valid.length}件の声を取り込みました：${valid.map((p) => p.name).join("、")}`);
    setPresetIoText("");
  };
  const removePreset = (id) => { savePresetsList(voicePresets.filter((p) => p.id !== id)); if (activePresetId === id) setActivePresetId(null); };
  const handleSavePreset = () => {
    const name = presetName.trim(); if (!name) { alert("登録する声の名前を入力してください"); return; }
    const ex = voicePresets.find((p) => p.name === name);
    const preset = { id: ex?.id ?? `${Date.now()}`, name, voice: voiceIndex, pitch, rate };
    savePresetsList(ex ? voicePresets.map((p) => (p.id === ex.id ? preset : p)) : [...voicePresets, preset]);
    setActivePresetId(preset.id); setPresetName("");
  };

  // ---------------- BGM・背景（長尺動画作成の「長尺用」と共通） ----------------
  const [bgms, setBgms] = useState([]);
  const [activeBgmId, setActiveBgmId] = useState(() => { try { return localStorage.getItem("explainer-bgm-v1") || ""; } catch (e) { return ""; } });
  useEffect(() => { try { localStorage.setItem("explainer-bgm-v1", activeBgmId); } catch (e) { /* ignore */ } }, [activeBgmId]);
  const [bgmVolume, setBgmVolume] = useState(() => sliderInitValue("bgmVolume", 25));
  const refreshBgms = () => listBgms(true).then(setBgms).catch(() => {});
  useEffect(() => { refreshBgms(); }, []);
  const activeBgm = bgms.find((b) => b.id === activeBgmId) || null;
  const [bgmUrl, setBgmUrl] = useState(null);
  useEffect(() => { if (!activeBgm) { setBgmUrl(null); return; } const u = URL.createObjectURL(activeBgm.blob); setBgmUrl(u); return () => URL.revokeObjectURL(u); }, [activeBgm]);
  const handleBgmUpload = async (e) => { const f = e.target.files?.[0]; if (!f) return; try { const s = await saveBgm(f, true); await refreshBgms(); setActiveBgmId(s.id); } catch (err) { alert("BGMの保存に失敗しました"); } };
  const handleBgmDelete = async (id) => { await deleteBgm(id, true); if (activeBgmId === id) setActiveBgmId(""); refreshBgms(); };

  const [backgrounds, setBackgrounds] = useState([]);
  const [activeBackgroundId, setActiveBackgroundId] = useState("");
  const [backgroundOpacity, setBackgroundOpacity] = useState(() => sliderInitValue("backgroundOpacity", 85));
  const refreshBackgrounds = () => listBackgrounds(true).then((items) => { setBackgrounds(items); setActiveBackgroundId((prev) => (prev && items.some((b) => b.id === prev) ? prev : items[0]?.id ?? "")); }).catch(() => {});
  useEffect(() => { refreshBackgrounds(); }, []);
  const activeBackground = backgrounds.find((b) => b.id === activeBackgroundId) || null;
  const [backgroundImgEl, setBackgroundImgEl] = useState(null);
  useEffect(() => { if (!activeBackground) { setBackgroundImgEl(null); return; } const u = URL.createObjectURL(activeBackground.blob); const img = new Image(); img.onload = () => setBackgroundImgEl(img); img.src = u; return () => URL.revokeObjectURL(u); }, [activeBackground]);
  const handleBackgroundUpload = async (e) => { const f = e.target.files?.[0]; if (!f) return; try { const s = await saveBackground(f, true); await refreshBackgrounds(); setActiveBackgroundId(s.id); } catch (err) { alert("背景画像の保存に失敗しました"); } };
  const handleBackgroundDelete = async (id) => { await deleteBackground(id, true); if (activeBackgroundId === id) setActiveBackgroundId(""); refreshBackgrounds(); };

  const [showSubtitles, setShowSubtitles] = useState(true);
  // 参考資料：既定では動画に入れず、概要欄にだけ記載する（入れる場合は長尺の最後に「参考資料」の場面を足す）
  const [sourcesInVideo, setSourcesInVideoState] = useState(() => { try { return localStorage.getItem("explainer-sources-in-video-v1") === "1"; } catch (e) { return false; } });
  const setSourcesInVideo = (on) => {
    setSourcesInVideoState(on);
    try { localStorage.setItem("explainer-sources-in-video-v1", on ? "1" : "0"); } catch (e) { /* ignore */ }
    setProject((p) => {
      if (!p) return p;
      const rest = p.longScenes.filter((s) => s.visual.kind !== "sources");
      if (!on || !p.sources.length) return { ...p, longScenes: rest };
      return { ...p, longScenes: [...rest, sourcesScene(p.sources, Math.max(0, p.chapters.length - 1))] };
    });
  };

  // ---------------- プレビュー・再生・書き出し ----------------
  const canvasRef = useRef(null);
  const rendererRef = useRef(null);
  const isPlayingRef = useRef(false);
  const rafRef = useRef(0);
  const lastUiRef = useRef(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [seekPos, setSeekPos] = useState(0);
  useEffect(() => { seekPosRef.current = seekPos; }, [seekPos]);
  const [totalSec, setTotalSec] = useState(0);
  const [sceneDurs, setSceneDurs] = useState([]);
  // 実測したナレーションの長さ（秒）と、そのときの速さ。速さを変えたときの長さの見込みに使う
  const [narrMeasure, setNarrMeasure] = useState(null);
  const [measuring, setMeasuring] = useState(false);
  const estimatedTotal = useMemo(() => scenes.reduce((a, s) => a + Math.max(s.minSec || 0, (s.narration.length / CHARS_PER_MIN) * 60 / rate + 1.1), 0), [scenes, rate]);
  const displayTotal = totalSec > 0 ? totalSec : estimatedTotal;
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [ttsError, setTtsError] = useState(false);
  const [currentSceneIdx, setCurrentSceneIdx] = useState(0);
  const sceneRefs = useRef([]);
  const listRef = useRef(null);
  // 台本・形式が変わったら、実測した長さは使えないので概算に戻す
  useEffect(() => { setTotalSec(0); setSceneDurs([]); setNarrMeasure(null); }, [scenes, format]);
  // 速さを変えたら、実測した全体の長さは使えないので見込みに戻す（ナレーションの実測値は残して比で計算する）
  useEffect(() => { setTotalSec(0); setSceneDurs([]); }, [rate]);
  useEffect(() => {
    const box = listRef.current, el = sceneRefs.current[currentSceneIdx];
    if (!box || !el) return;
    box.scrollTo({ top: Math.max(0, box.scrollTop + el.getBoundingClientRect().top - box.getBoundingClientRect().top), behavior: "smooth" });
  }, [currentSceneIdx]);
  const updateSceneProgress = (progress) => { const r = rendererRef.current; if (r) setCurrentSceneIdx(r.getSceneIndexAt(progress)); };

  const estDurs = useMemo(() => scenes.map((s) => Math.max(s.minSec || 0, (s.narration.length / CHARS_PER_MIN) * 60 / rate + 1.1)), [scenes, rate]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !project || !scenes.length) { rendererRef.current = null; return; }
    const size = RENDER_SIZE[format];
    canvas.width = size.w; canvas.height = size.h;
    try {
      const r = new ExplainerRenderer(canvas, {
        format, scenes, videoTitle: format === "short" && project.youtube.shortTitle ? project.youtube.shortTitle.replace(/#\S+/g, "").trim() : project.videoTitle,
        kicker: project.kicker, chapterTitles: project.chapters.map((c) => c.title),
        avatar: avatarObj, backgroundImage: backgroundImgEl, backgroundOpacity: backgroundOpacity / 100,
        images: imageEls, showSubtitles, showSourceNotes: sourcesInVideo,
      });
      r.setDurations(sceneDurs.length === scenes.length ? sceneDurs : estDurs);
      r.setNarrationDurations((sceneDurs.length === scenes.length ? sceneDurs : estDurs).map((d) => Math.max(0, d - 1.1)));
      rendererRef.current = r;
      r.draw(seekPosRef.current);
      updateSceneProgress(seekPosRef.current);
    } catch (e) { console.error("ExplainerRenderer init error:", e); rendererRef.current = null; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, scenes, format, avatarObj, backgroundImgEl, backgroundOpacity, imageEls, showSubtitles, sourcesInVideo, estDurs]);

  const stopLoop = () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); rafRef.current = 0; isPlayingRef.current = false; };
  const prepareAudio = async () => {
    setTtsError(false);
    let failed = false;
    const bufs = [];
    const fb = nonAivisVoiceChoices[0] ?? "";
    let voice = voiceIndex;
    for (let i = 0; i < scenes.length; i++) {
      try {
        const { buffer, usedFallback } = await mixer().fetchNarrationBufferSmart(ttsText(scenes[i]), rate, voice, pitch, fb);
        bufs.push(buffer);
        if (usedFallback && voice !== fb) { voice = fb; setVoiceIndex(fb); setVoiceNote("AivisSpeechに接続できなかったため、既存の声に切り替えました。"); }
      } catch (e) { console.error("TTS error:", e); failed = true; bufs.push(null); }
    }
    const durs = scenes.map((s, i) => Math.max(s.minSec || 3, bufs[i] ? 0.3 + bufs[i].duration + 0.8 : 0));
    const starts = []; durs.reduce((acc, d) => { starts.push(acc); return acc + d; }, 0);
    const total = durs.reduce((a, b) => a + b, 0);
    setTotalSec(total); setSceneDurs(durs);
    if (!failed) setNarrMeasure({ rate, secs: bufs.map((b) => (b ? b.duration : 0)) });
    if (failed) setTtsError(true);
    return { bufs, durs, starts, total, failed };
  };
  const handlePlay = async () => {
    if (!rendererRef.current || !scenes.length) return;
    stopLoop(); mixer().stopBGM(); mixer().stopNarration();
    const raw = Math.min(1, Math.max(0, seekPosRef.current ?? 0));
    const pos0 = raw >= 0.999 ? 0 : raw;
    setIsPlaying(true); isPlayingRef.current = true;
    const pr = await prepareAudio();
    const r = rendererRef.current;
    if (!isPlayingRef.current || !r) return;
    r.setDurations(pr.durs); r.setNarration(pr.bufs);
    const elapsed0 = pos0 * pr.total;
    if (bgmUrl) { try { mixer().playBGM(bgmUrl, bgmVolume, true, elapsed0); } catch (e) { console.error(e); } }
    pr.bufs.forEach((b, i) => {
      if (!b) return;
      const s = pr.starts[i] + 0.3, e = s + b.duration;
      if (e <= elapsed0) return;
      if (s >= elapsed0) mixer().playBufferAfter(b, s - elapsed0); else mixer().playBufferAfter(b, 0, 1, elapsed0 - s);
    });
    const t0 = performance.now() - elapsed0 * 1000;
    const tick = (now) => {
      if (!isPlayingRef.current || !rendererRef.current) return;
      const prog = Math.min(1, (now - t0) / (pr.total * 1000));
      rendererRef.current.draw(prog);
      if (now - lastUiRef.current > 100 || prog >= 1) { lastUiRef.current = now; setSeekPos(prog); updateSceneProgress(prog); }
      if (prog < 1) rafRef.current = requestAnimationFrame(tick);
      else { isPlayingRef.current = false; setIsPlaying(false); mixer().fadeBGM(1); rendererRef.current?.pauseAvatar(); }
    };
    rafRef.current = requestAnimationFrame(tick);
  };
  const handlePause = () => { stopLoop(); setIsPlaying(false); mixer().stopBGM(); mixer().stopNarration(); rendererRef.current?.pauseAvatar(); };
  const handleSeek = (v) => { if (isPlayingRef.current) handlePause(); setSeekPos(v); rendererRef.current?.draw(v); updateSceneProgress(v); };
  const previewSceneAt = (idx) => {
    const r = rendererRef.current; if (!r || idx < 0) return;
    if (isPlayingRef.current) handlePause();
    const durs = sceneDurs.length === scenes.length ? sceneDurs : estDurs;
    const total = durs.reduce((a, b) => a + b, 0) || 1;
    const before = durs.slice(0, idx).reduce((a, b) => a + b, 0), d = durs[idx] || 1;
    const target = Math.min(1, (before + Math.max(0, d - Math.min(2, d * 0.15))) / total);
    setSeekPos(target); r.draw(target); updateSceneProgress(target);
  };
  const download = (blob, name) => { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000); };
  const stamp = () => new Date().toISOString().slice(0, 10).replace(/-/g, "");
  // ---- 書き出しの名前 ----
  // 動画：YouTubeに投稿するタイトル（アップロード時にそのまま動画名になる）／サムネ・概要欄テキスト・フォルダ：サムネの文字
  const exportNames = () => {
    const y = project.youtube;
    const thumb = safeFileName(y.thumbnailText || project.videoTitle);
    const isShort = format === "short";
    return {
      folder: isShort ? `${thumb}_ショート` : thumb,
      video: safeFileName(isShort ? (y.shortTitle || y.title) : y.title, thumb),
      thumb: isShort ? `${thumb}_ショート` : thumb,
      title: isShort ? (y.shortTitle || y.title) : y.title,
    };
  };
  // サムネは「タイトル画面が描き終わったところ」（タイトルの場面の終わり0.5秒前）を撮る
  const thumbTimeSec = (durs) => {
    const idx = Math.max(0, scenes.findIndex((s) => s.visual.kind === "title"));
    const before = durs.slice(0, idx).reduce((a, b) => a + b, 0);
    return before + Math.max(0.2, (durs[idx] || 1) - 0.5);
  };
  const canvasPng = (canvas) => new Promise((res) => canvas.toBlob((b) => res(b), "image/png"));

  const [exportFolder, setExportFolder] = useState(null);
  useEffect(() => { getSavedFolder().then(setExportFolder); }, []);
  const chooseExportFolder = async () => { const h = await pickFolder(); if (h) setExportFolder(h); return h; };
  const [exportNote, setExportNote] = useState("");

  // ---------------- 新しい動画を作る（リセット） ----------------
  // テーマ・追加の指示・参考情報・台本・場面に追加した画像を消して、最初の状態に戻す。
  // 声・アバター・背景・BGM・長さ・視聴者・保存先フォルダなどの「いつもの設定」は残す。
  const handleReset = async () => {
    if (genBusy || isExporting) return;
    if (!confirm("新しい動画を作るために、テーマ・参考情報・台本をすべて消します。よろしいですか？\n（声・アバター・背景・BGM・長さなどの設定は残ります。今の台本を残したい場合は、先に「台本を保存」を押してください）")) return;
    handlePause();
    const usedImageIds = project ? [...project.longScenes, ...project.shortScenes].map((sc) => sc.imageId).filter(Boolean) : [];
    for (const id of usedImageIds) { try { await deleteImage(id); } catch (e) { /* ignore */ } }
    refreshImages();
    setProject(null);
    try { localStorage.removeItem(PROJECT_KEY); } catch (e) { /* ignore */ }
    setTopic(""); setExtraInstruction(""); setRefs([]);
    setUrlInput(""); setRefTextBody(""); setRefTextTitle(""); setRefTextOpen(false);
    setGenError(""); setAiError(""); setAiOpenId(null); setEditVisualId(null); setReadingOpenId(null); setRightsPendingId(null);
    setExportNote(""); setFormat("long"); setSeekPos(0); setCurrentSceneIdx(0); setTotalSec(0); setSceneDurs([]); setNarrMeasure(null);
    setInputOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleThumbnail = async () => {
    const r = rendererRef.current, canvas = canvasRef.current; if (!r || !canvas || !project) return;
    if (isPlayingRef.current) handlePause();
    const durs = sceneDurs.length === scenes.length ? sceneDurs : estDurs;
    const total = durs.reduce((a, b) => a + b, 0) || 1;
    const prog = Math.min(1, thumbTimeSec(durs) / total);
    await r.prepare(prog); // 人物の動画もその時刻の画面にそろえてから撮る
    r.draw(prog); setSeekPos(prog); updateSceneProgress(prog);
    const b = await canvasPng(canvas);
    if (b) download(b, `${exportNames().thumb}.png`);
  };

  const handleExport = async () => {
    const r = rendererRef.current, canvas = canvasRef.current;
    if (!r || !canvas || !scenes.length || !project) return;
    // 保存先フォルダ（ボタンを押した直後でないと選べない・許可を求められないため、録画の前に確認する）
    let folder = exportFolder;
    if (canPickFolder()) {
      if (!folder) folder = await chooseExportFolder();
      if (folder && !(await ensureWritable(folder))) folder = await chooseExportFolder();
    }
    const names = exportNames();
    stopLoop(); mixer().stopNarration(); setIsPlaying(false); setIsExporting(true); setExportProgress(0); setExportNote("");
    const exporter = new VideoExporter();
    let handle = null;
    try {
      const audioStream = mixer().startRecordingTap();
      const pr = await prepareAudio();
      r.setDurations(pr.durs); r.setNarration(pr.bufs);
      const animMs = Math.round(pr.total * 1000), totalMs = animMs + 300;
      const thumbAtMs = thumbTimeSec(pr.durs) * 1000;
      let thumbBlob = null, thumbPending = null;
      await r.prepare(0); // 人物の動画を先頭にそろえてから録画を始める（出だしで人物が消えないように）
      if (bgmUrl) await mixer().playBGM(bgmUrl, bgmVolume, true);
      handle = exporter.startRecording(canvas, audioStream, 30);
      await new Promise((resolve) => {
        const t0 = performance.now();
        pr.bufs.forEach((b, i) => { if (b) mixer().playBufferAfter(b, pr.starts[i] + 0.3); });
        let fading = false, lastUi = 0;
        const tick = () => {
          const now = performance.now(), el = now - t0, prog = Math.min(1, el / animMs);
          rendererRef.current?.draw(prog);
          if (!thumbPending && el >= thumbAtMs) thumbPending = canvasPng(canvas).then((b) => { thumbBlob = b; });
          // 画面の表示更新は1秒に4回まで（毎コマ更新すると画面全体の再描画で録画が引っかかり、人物が途切れる原因になる）
          if (now - lastUi > 250) { lastUi = now; setSeekPos(prog); setExportProgress(Math.round(Math.min(1, el / totalMs) * 95)); }
          if (!fading && el >= totalMs - 1400) { fading = true; mixer().fadeBGM(1.4); }
          if (el < totalMs) requestAnimationFrame(tick); else resolve();
        };
        requestAnimationFrame(tick);
      });
      await new Promise((res) => setTimeout(res, 400));
      const blob = await handle.stop();
      mixer().stopBGM(); mixer().stopRecordingTap();
      if (thumbPending) await thumbPending;
      setExportProgress(97);
      const files = [{ name: `${names.video}.${handle.extension}`, blob }];
      if (thumbBlob) files.push({ name: `${names.thumb}.png`, blob: thumbBlob });
      const tags = project.youtube.tags || [];
      files.push({ name: `${names.thumb}_概要欄.txt`, blob: new Blob(["\ufeff" + descriptionText(names.title, description, tags)], { type: "text/plain;charset=utf-8" }) });
      const where = await saveBundle(folder && (await ensureWritable(folder)) ? folder : null, names.folder, files);
      setExportProgress(100);
      setExportNote(where ? `保存しました：${where}（${files.map((f) => f.name).join("、")}）` : `ダウンロードフォルダに保存しました：${files.map((f) => f.name).join("、")}`);
      if (pr.failed) alert("一部のナレーションを動画に入れられませんでした。ローカルTTSサーバー（npm run dev:video）またはAivisSpeechが起動しているかご確認ください。");
      if (handle.extension === "webm") alert("このブラウザはMP4で直接保存できないため、WebM形式で保存しました。YouTubeにはそのままアップロードできます。");
    } catch (err) {
      alert(`書き出しエラー: ${err?.message ?? err}`);
      try { await handle?.stop(); } catch (e2) { /* ignore */ }
      mixer().stopBGM(); mixer().stopRecordingTap();
    } finally {
      rendererRef.current?.draw(seekPosRef.current);
      setTimeout(() => { setIsExporting(false); setExportProgress(0); }, 800);
    }
  };

  // ---------------- 公開前チェック・YouTube情報 ----------------
  const refTexts = useMemo(() => referenceTexts(refs), [refs]);
  const issues = useMemo(() => lintScenes(scenes, refTexts, sceneDurs), [scenes, refTexts, sceneDurs]);
  const issuesByScene = useMemo(() => { const m = {}; issues.forEach((x) => { (m[x.sceneIndex] ??= []).push(x); }); return m; }, [issues]);
  const urlList = useMemo(() => refs.filter((r) => r.kind === "url" && r.status === "ok").map((r) => r.url), [refs]);
  const description = useMemo(() => (project ? buildDescription(project, urlList, format === "short") : ""), [project, urlList, format]);
  const patchYoutube = (patch) => setProject((p) => ({ ...p, youtube: { ...p.youtube, ...patch } }));

  // ---------------- 長さと声の速さのガイド ----------------
  const targetSec = format === "long" ? (project?.targetMinutes || 5) * 60 : 60;
  const predicted = useMemo(() => (totalSec > 0 ? totalSec : predictTotalSec(scenes, rate, narrMeasure)), [totalSec, scenes, rate, narrMeasure]);
  const needRate = useMemo(() => suggestRate(scenes, targetSec * 0.98, narrMeasure), [scenes, targetSec, narrMeasure]);
  // 目標まで余裕があるときに、ゆっくり読める速さ（目標の90%まで使う・聞き取りやすい範囲の下限まで）
  const relaxRate = useMemo(() => { const r = suggestRate(scenes, targetSec * 0.9, narrMeasure); return r == null ? null : Math.max(COMFORT_RATE.min, r); }, [scenes, targetSec, narrMeasure]);
  const applyRate = (r) => { const v = Math.round(r * 100) / 100; setRate(v); updateLocked("rate", v); setActivePresetId(null); };
  const measureNow = async () => { if (isPlayingRef.current) handlePause(); setMeasuring(true); try { await prepareAudio(); } finally { setMeasuring(false); } };
  const SpeedGuide = () => {
    if (!project || !scenes.length) return null;
    const over = predicted > targetSec;
    const roomy = !over && predicted < targetSec * 0.8 && relaxRate != null && relaxRate < rate - 0.04;
    const tone = over ? C.rust : roomy ? C.amber : C.teal;
    return (
      <div className="rounded p-2 text-[11px] flex flex-col gap-1.5" style={{ background: `${tone}12`, border: `1px solid ${tone}55`, color: C.textMuted }}>
        <div className="flex items-center gap-2 flex-wrap">
          <span style={{ color: tone, fontWeight: 700 }}>{over ? "目標を超えています" : roomy ? "目標まで余裕があります" : "目標の長さに収まっています"}</span>
          <span>見込み {fmtTime(predicted)}（速さ {rate.toFixed(2)}x）／目標</span>
          {format === "long" ? (
            <select value={project.targetMinutes} onChange={(e) => setProject((p) => ({ ...p, targetMinutes: Number(e.target.value) }))} className="px-1 py-0.5 rounded text-[11px]" style={inputStyle}>
              {LENGTH_OPTIONS.map((m) => <option key={m} value={m}>{m}:00以内</option>)}
            </select>
          ) : <span>1:00以内（ショート）</span>}
          <span style={{ color: C.textDim }}>{totalSec ? "※実測" : narrMeasure ? "※実測から計算" : "※文字数から推計"}</span>
        </div>
        {over && needRate != null && (
          <div className="flex items-center gap-2 flex-wrap">
            <span>声の速さを <b style={{ color: C.text }}>{needRate.toFixed(2)}x</b> にすると、約{fmtTime(predictTotalSec(scenes, needRate, narrMeasure))}で収まります。</span>
            <button onClick={() => applyRate(needRate)} className="text-[10px] px-2 py-0.5 rounded" style={btn("primary")}>この速さにする</button>
            {needRate > COMFORT_RATE.max && <span style={{ color: C.rust }}>（{COMFORT_RATE.max}xを超えると聞き取りにくくなります。場面を減らすか、目標を延ばすのがおすすめです）</span>}
          </div>
        )}
        {over && needRate == null && <div style={{ color: C.rust }}>速さを上げても収まりません。場面を減らすか、目標の長さを延ばしてください。</div>}
        {over && format === "long" && (needRate == null || needRate > COMFORT_RATE.max) && (
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => handleGenerate(project.targetMinutes)} disabled={genBusy} className="text-[11px] px-2.5 py-1 rounded flex items-center gap-1" style={{ ...btn("primary"), opacity: genBusy ? 0.5 : 1 }}><RefreshCw size={11} /> {genBusy ? (genProgress?.step || "作り直し中…") : `${project.targetMinutes}分以内に収まるよう台本を作り直す`}</button>
            <span style={{ color: C.textDim }}>いまの声の速さ（{rate.toFixed(2)}x）で長さを見積もって作ります。テーマ・参考情報はそのまま使います。</span>
          </div>
        )}
        {roomy && (
          <div className="flex items-center gap-2 flex-wrap">
            <span>速さを <b style={{ color: C.text }}>{relaxRate.toFixed(2)}x</b> に下げると、約{fmtTime(predictTotalSec(scenes, relaxRate, narrMeasure))}で、ゆったり聞きやすくなります。</span>
            <button onClick={() => applyRate(relaxRate)} className="text-[10px] px-2 py-0.5 rounded" style={btn()}>この速さにする</button>
          </div>
        )}
        <div className="flex items-center gap-2 flex-wrap" style={{ color: C.textDim }}>
          <span>聞き取りやすい速さの目安は {COMFORT_RATE.min}〜{COMFORT_RATE.max}x です。</span>
          {!totalSec && <button onClick={measureNow} disabled={measuring} className="text-[10px] px-2 py-0.5 rounded" style={{ ...btn(), opacity: measuring ? 0.5 : 1 }}>{measuring ? "音声を作って計測中…" : "実際の音声で長さを計測"}</button>}
        </div>
      </div>
    );
  };

  const sizeKb = (b) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)}MB` : `${Math.round(b / 1024)}KB`);

  // ======================= 画面 =======================
  return (
    <div className="min-h-screen" style={{ background: C.bg, color: C.text, fontFamily: "'Zen Kaku Gothic New',sans-serif" }}>
      <div className="max-w-[1240px] mx-auto px-4 py-4 flex flex-col gap-4">
        <header className="flex items-center gap-3 flex-wrap">
          <a href={`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/`} className="text-[11px] flex items-center gap-1" style={{ color: C.textMuted }}><ArrowLeft size={12} /> ダッシュボード</a>
          <h1 className="text-base font-bold">ニュース・キーワード解説動画</h1>
          <span className="text-[11px]" style={{ color: C.textDim }}>長尺（16:9）＋宣伝用ショート（9:16）</span>
          <div className="ml-auto flex items-center gap-2">
            {project && <button onClick={saveProjectFile} className="text-[11px] px-2 py-1 rounded flex items-center gap-1" style={btn()}><Download size={11} /> 台本を保存</button>}
            <button onClick={handleReset} disabled={genBusy || isExporting} title="テーマ・参考情報・台本を消して、新しい動画を作り始めます（声・アバター等の設定は残ります）" className="text-[11px] px-2 py-1 rounded flex items-center gap-1" style={{ ...btn(), color: C.amber, borderColor: C.amber + "88", opacity: genBusy || isExporting ? 0.5 : 1 }}><Plus size={11} /> 新しい動画を作る</button>
            <label className="text-[11px] px-2 py-1 rounded flex items-center gap-1" style={btn()}><Upload size={11} /> 台本を開く
              <input type="file" accept="application/json,.json" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) loadProjectFile(f); }} />
            </label>
          </div>
        </header>

        {/* ---------- 入力 ---------- */}
        <div className="rounded-lg p-3" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
          <button onClick={() => setInputOpen((v) => !v)} className="w-full flex items-center justify-between text-xs font-semibold" style={{ background: "none", border: "none", color: C.text, cursor: "pointer", padding: 0 }}>
            <span className="flex items-center gap-1.5"><Sparkles size={13} style={{ color: C.teal }} /> テーマと参考情報{project && !inputOpen ? `：${project.topic}` : ""}</span>
            <ChevronRight size={14} style={{ transform: inputOpen ? "rotate(90deg)" : "none", transition: "transform .15s", color: C.textMuted }} />
          </button>
          {inputOpen && (
            <div className="flex flex-col gap-3 mt-3 text-xs">
              <div className="flex flex-wrap gap-2 items-center">
                {[["news", "ニュース"], ["keyword", "キーワード（用語）"]].map(([k, l]) => (
                  <button key={k} onClick={() => setMode(k)} className="text-[11px] px-2.5 py-1 rounded" style={{ color: mode === k ? C.bg : C.textMuted, background: mode === k ? C.teal : "transparent", border: `1px solid ${C.borderSoft}`, cursor: "pointer", fontWeight: mode === k ? 700 : 400 }}>{l}</button>
                ))}
                <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder={mode === "news" ? "例：日銀が政策金利を0.75%に引き上げ" : "例：インフレ／NISA／半導体の微細化"} className="flex-1 min-w-[220px] px-2 py-1.5 rounded text-sm" style={inputStyle} />
              </div>
              <div className="flex flex-wrap gap-3 items-center" style={{ color: C.textMuted }}>
                <label className="flex items-center gap-1.5">視聴者
                  <select value={audience} onChange={(e) => setAudience(e.target.value)} className="px-1.5 py-1 rounded text-[11px]" style={inputStyle}>
                    <option value="beginner">初心者向け</option><option value="general">一般向け</option><option value="advanced">詳しめ</option>
                  </select>
                </label>
                <label className="flex items-center gap-1.5">長尺の長さ
                  <select value={targetMinutes} onChange={(e) => setTargetMinutes(Number(e.target.value))} className="px-1.5 py-1 rounded text-[11px]" style={inputStyle}>
                    {LENGTH_OPTIONS.map((m) => <option key={m} value={m}>{m}分以内</option>)}
                  </select>
                </label>
                <input value={extraInstruction} onChange={(e) => setExtraInstruction(e.target.value)} placeholder="追加の指示（任意）：例）投資家目線の影響を厚めに／例え話を多めに" className="flex-1 min-w-[220px] px-2 py-1 rounded text-[11px]" style={inputStyle} />
              </div>

              <div>
                <div className="text-[11px] font-semibold mb-1.5" style={{ color: C.textMuted }}>参考情報（AIはこれを最優先に解説します。文章は丸写しせず言い換えます）</div>
                <div className="flex flex-col gap-1 mb-2">
                  {refs.length === 0 && <div className="text-[10px]" style={{ color: C.textDim }}>未追加です。ニュースは元記事や公式発表を追加すると正確になります（参考情報なしの場合は、一般に確立した知識の範囲で解説します）。</div>}
                  {refs.map((r) => (
                    <div key={r.id} className="flex items-center gap-2 px-2 py-1 rounded" style={{ background: C.panel2, border: `1px solid ${r.kind === "url" && r.status === "error" ? C.rust + "88" : C.borderSoft}` }}>
                      {r.kind === "url" ? <Link2 size={12} style={{ color: C.blue, flexShrink: 0 }} /> : r.kind === "pdf" ? <FileText size={12} style={{ color: C.rust, flexShrink: 0 }} /> : <Type size={12} style={{ color: C.amber, flexShrink: 0 }} />}
                      <span className="truncate flex-1 text-[11px]" title={r.kind === "url" ? r.url : r.title}>{refLabel(r)}</span>
                      <span className="text-[10px] shrink-0" style={{ color: r.kind === "url" && r.status === "error" ? C.rust : C.textDim }}>
                        {r.kind === "url" ? (r.status === "pending" ? "読み込み中…" : r.status === "error" ? r.error : r.pdfBase64 ? "PDF" : `${r.note ? `${r.note}・` : ""}${r.text.length.toLocaleString()}字`) : r.kind === "pdf" ? sizeKb(r.sizeBytes) : `${r.text.length.toLocaleString()}字`}
                      </span>
                      {r.kind === "url" && r.status === "error" && <button onClick={() => loadUrl(r.id, r.url)} title="もう一度読み込む" style={{ color: C.textMuted, background: "none", border: "none", cursor: "pointer" }}><RefreshCw size={11} /></button>}
                      <button onClick={() => setRefs((p) => p.filter((x) => x.id !== r.id))} title="削除" style={{ color: C.textDim, background: "none", border: "none", cursor: "pointer" }}><X size={12} /></button>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2 items-center">
                  <input value={urlInput} onChange={(e) => setUrlInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addUrls(); }} placeholder="URLを貼り付け：記事・PDF・YouTube動画（複数は空白・改行区切り）" className="flex-1 min-w-[240px] px-2 py-1 rounded text-[11px]" style={inputStyle} />
                  <button onClick={addUrls} className="text-[11px] px-2 py-1 rounded flex items-center gap-1" style={btn()}><Link2 size={11} /> URLを追加</button>
                  <label className="text-[11px] px-2 py-1 rounded flex items-center gap-1" style={btn()}><FileText size={11} /> PDFを追加
                    <input type="file" accept="application/pdf,.pdf" multiple style={{ display: "none" }} onChange={(e) => { const fs = e.target.files; addPdfs(fs); e.target.value = ""; }} />
                  </label>
                  <button onClick={() => setRefTextOpen((v) => !v)} className="text-[11px] px-2 py-1 rounded flex items-center gap-1" style={btn()}><Type size={11} /> テキストを追加</button>
                </div>
                <div className="text-[10px] mt-1" style={{ color: C.textDim }}>URLの本文はローカルサーバー（{getTtsBaseUrl()}）が取得します。YouTube動画はタイトル・概要欄・字幕（公開されている場合）を読み込みます。字幕が取れない動画は、YouTubeの「文字起こしを表示」の内容をコピーして「テキスト」で追加してください。ログインが必要なページや有料記事は読めないため、本文をコピーして「テキスト」で追加してください。</div>
                {refTextOpen && (
                  <div className="mt-2 flex flex-col gap-1.5 p-2 rounded" style={{ background: C.panel2, border: `1px solid ${C.borderSoft}` }}>
                    <input value={refTextTitle} onChange={(e) => setRefTextTitle(e.target.value)} placeholder="資料名（例：日銀の公表文、○○新聞 10月25日）" className="px-2 py-1 rounded text-[11px]" style={{ ...inputStyle, background: C.panel }} />
                    <textarea value={refTextBody} onChange={(e) => setRefTextBody(e.target.value)} placeholder="本文やメモを貼り付け" rows={5} className="px-2 py-1 rounded text-[11px]" style={{ ...inputStyle, background: C.panel, resize: "vertical" }} />
                    <div className="flex gap-2"><button onClick={addTextRef} className="text-[11px] px-2 py-1 rounded" style={btn("primary")}>追加</button><button onClick={() => setRefTextOpen(false)} className="text-[11px] px-2 py-1 rounded" style={{ ...btn(), color: C.textMuted, borderColor: C.borderSoft }}>やめる</button></div>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={() => handleGenerate()} disabled={genBusy} className="text-xs px-3 py-1.5 rounded flex items-center gap-1.5" style={{ ...btn("primary"), opacity: genBusy ? 0.6 : 1 }}><Sparkles size={13} /> {project ? "台本を作り直す" : "台本を生成（長尺＋ショート）"}</button>
                {genBusy && <button onClick={() => abortRef.current?.abort()} className="text-[11px] px-2 py-1 rounded" style={{ ...btn(), color: C.rust, borderColor: C.rust + "88" }}>中止</button>}
                {genProgress && (
                  <div className="flex items-center gap-2 text-[11px]" style={{ color: C.textMuted }}>
                    <div className="w-40 h-1.5 rounded overflow-hidden" style={{ background: C.panel2 }}><div className="h-full" style={{ width: `${Math.round((genProgress.done / Math.max(1, genProgress.total)) * 100)}%`, background: C.teal, transition: "width .3s" }} /></div>
                    {genProgress.step}
                  </div>
                )}
                {!genBusy && <span className="text-[10px]" style={{ color: C.textDim }}>長さは、いま選んでいる声の速さ（{rate.toFixed(2)}x）で約{targetMinutes}分以内に収まるよう見積もって作ります。先に声と速さを決めてから生成すると正確です。</span>}
              </div>
              {genError && <div className="text-[11px] px-2 py-1.5 rounded" style={{ background: `${C.rust}1a`, border: `1px solid ${C.rust}44`, color: C.rust }}>{genError}</div>}
            </div>
          )}
          {!inputOpen && genError && <div className="text-[11px] mt-2" style={{ color: C.rust }}>{genError}</div>}
        </div>

        {voicesLoaded && voices.length === 0 && (
          <div className="text-xs px-3 py-2 rounded" style={{ background: `${C.rust}1a`, border: `1px solid ${C.rust}44`, color: C.rust }}>
            ローカルTTSサーバーの音声が見つかりません。<code className="mono">npm run dev:video</code>（または <code className="mono">npm run tts-server</code>）でサーバーを起動してください。プレビュー映像の確認は音声なしでも可能です。
          </div>
        )}

        {!project && (
          <div className="rounded-lg p-6 text-xs leading-relaxed" style={{ background: C.panel, border: `1px dashed ${C.border}`, color: C.textMuted }}>
            テーマを入力し、参考情報（URL・PDF・テキスト）を添えて「台本を生成」を押すと、章立て → 章ごとの場面（ナレーション・図解）→ 本編へ誘導するショートの順にAIが作ります。
            図解（グラフ・流れ図・年表・比較・イメージ図など）はすべてこの画面で描くオリジナルで、実在の人物の写真やロゴは使いません。写真を使いたい場面には、権利を確認した画像を自分で追加できます。
          </div>
        )}

        {project && (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              {[["long", "長尺（16:9）", project.longScenes.length], ["short", "ショート（9:16）", project.shortScenes.length]].map(([k, l, n]) => (
                <button key={k} onClick={() => { handlePause(); setFormat(k); setSeekPos(0); setCurrentSceneIdx(0); }} className="text-xs px-3 py-1.5 rounded" style={{ color: format === k ? C.bg : C.textMuted, background: format === k ? C.teal : C.panel, border: `1px solid ${C.borderSoft}`, cursor: "pointer", fontWeight: format === k ? 700 : 400 }}>{l}・{n}場面</button>
              ))}
              {format === "short" && <button onClick={handleRegenerateShort} disabled={genBusy} className="text-[11px] px-2 py-1 rounded flex items-center gap-1" style={btn()}><RefreshCw size={11} /> ショートを作り直す</button>}
              {genBusy && genProgress && <span className="text-[11px]" style={{ color: C.textMuted }}>{genProgress.step}</span>}
              <span className="ml-auto text-[11px]" style={{ color: C.textDim }}>「{project.videoTitle}」</span>
            </div>

            <div className="flex flex-col gap-4 md:flex-row md:items-start">
              {/* ---------- プレビュー（スクロールしても追従） ---------- */}
              <div className="flex flex-col gap-2 w-full" style={{ flex: "0 0 auto", maxWidth: format === "long" ? 560 : 330, position: "sticky", top: 8, alignSelf: "flex-start" }}>
                <div className="relative rounded-lg overflow-hidden border" style={{ borderColor: C.borderSoft, background: "#000", aspectRatio: format === "long" ? "16 / 9" : "9 / 16" }}>
                  <canvas ref={canvasRef} className="w-full h-full" />
                </div>
                <input type="range" min={0} max={1} step={0.001} value={seekPos} onChange={(e) => handleSeek(Number(e.target.value))} className="w-full" />
                <div className="text-[11px] mono -mt-1" style={{ color: C.textDim }}>
                  {fmtTime(seekPos * displayTotal)} / {fmtTime(displayTotal)}{totalSec ? "" : "（見込み）"}
                </div>
                {SpeedGuide()}
                <div className="flex items-center gap-1.5 text-[11px]" style={{ color: C.textDim }}>
                  ラベル<input value={project.kicker} onChange={(e) => setProject((p) => ({ ...p, kicker: e.target.value }))} className="w-32 px-1.5 py-0.5 rounded text-[11px]" style={inputStyle} title="左上の色付きラベル" />
                  タイトル<input value={project.videoTitle} onChange={(e) => setProject((p) => ({ ...p, videoTitle: e.target.value }))} className="flex-1 min-w-0 px-1.5 py-0.5 rounded text-[11px]" style={inputStyle} title="画面上部に出す動画タイトル" />
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <button onClick={isPlaying ? handlePause : handlePlay} className="text-xs px-3 py-1.5 rounded flex items-center gap-1.5" style={btn("primary")}>{isPlaying ? <><Pause size={13} /> 一時停止</> : <><Play size={13} /> プレビュー再生</>}</button>
                  <button onClick={() => { handlePause(); handleSeek(0); }} className="text-xs px-3 py-1.5 rounded flex items-center gap-1.5" style={{ background: C.panel2, color: C.textMuted, border: `1px solid ${C.borderSoft}`, cursor: "pointer" }}><Square size={12} /> 先頭へ</button>
                  <button onClick={handleThumbnail} title={format === "long" ? "サムネ用の画像（大きな文字＋人物）をPNGで保存" : "いま表示中の1コマをPNGで保存"} className="text-xs px-3 py-1.5 rounded flex items-center gap-1.5" style={{ background: C.panel2, color: C.textMuted, border: `1px solid ${C.borderSoft}`, cursor: "pointer" }}><Camera size={12} /> サムネ保存</button>
                  <button onClick={handleExport} disabled={isExporting} className="text-xs px-3 py-1.5 rounded flex items-center gap-1.5 ml-auto" style={{ ...btn("amber"), background: isExporting ? C.panel2 : C.amber, color: isExporting ? C.textMuted : C.bg }}><Download size={13} /> {isExporting ? `書き出し中… ${exportProgress}%` : "動画を書き出す（MP4）"}</button>
                </div>
                {format === "long" && <label className="flex items-center gap-1.5 text-[11px]" style={{ color: C.textDim }}><input type="checkbox" checked={sourcesInVideo} onChange={(e) => setSourcesInVideo(e.target.checked)} /> 動画に出典を表示（各スライドの「出典：…」と最後の「参考資料」の場面。オフでも概要欄には記載します）</label>}
                <label className="flex items-center gap-1.5 text-[11px]" style={{ color: C.textDim }}><input type="checkbox" checked={showSubtitles} onChange={(e) => setShowSubtitles(e.target.checked)} /> 字幕（ナレーション）を表示（オフでテロップ）</label>
                <div className="flex items-center gap-2 flex-wrap text-[11px]" style={{ color: C.textDim }}>
                  <span>保存先：{canPickFolder() ? (exportFolder ? <b style={{ color: C.text }}>{exportFolder.name}</b> : "未選択（書き出し時に選びます）") : "ダウンロードフォルダ"}</span>
                  {canPickFolder() && <button onClick={chooseExportFolder} className="text-[10px] px-1.5 py-0.5 rounded" style={btn()}>{exportFolder ? "変更" : "選ぶ"}</button>}
                  {project && <span>→ フォルダ「{exportNames().folder}」に、動画「{exportNames().video}」・サムネ「{exportNames().thumb}.png」・概要欄テキストを保存</span>}
                </div>
                {exportNote && <div className="text-[11px]" style={{ color: C.teal }}>{exportNote}</div>}
                {ttsError && <div className="text-[11px]" style={{ color: C.rust }}>一部の場面でナレーション音声の生成に失敗しました（TTSサーバーをご確認ください）。</div>}
                <div className="text-[10px] leading-relaxed" style={{ color: C.textDim }}>書き出しは実時間で録画します（{fmtTime(displayTotal)}かかります）。録画中はこのタブを前面に表示したままにしてください。</div>
              </div>

              {/* ---------- 設定パネル ---------- */}
              <div className="flex flex-col gap-4 text-xs flex-1 min-w-0">
                {/* 公開前チェック */}
                <Section title={`公開前チェック（${issues.filter((x) => x.level === "warn").length}件の注意・${issues.filter((x) => x.level === "info").length}件の確認）`} right={issues.some((x) => x.message.startsWith("参考資料の文章")) ? <button onClick={paraphraseAll} disabled={!!paraAllBusy} className="text-[10px] px-1.5 py-0.5 rounded" style={{ ...btn("primary"), opacity: paraAllBusy ? 0.5 : 1 }}>{paraAllBusy || "参考資料と同じ言い回しをまとめて言い換える"}</button> : null}>
                  {issues.length === 0 ? (
                    <div className="text-[11px] flex items-center gap-1" style={{ color: C.teal }}><Check size={12} /> 出典の記載・丸写し・図解の連続などに問題は見つかりませんでした。</div>
                  ) : (
                    <div className="flex flex-col gap-0.5 max-h-28 overflow-y-auto pr-1">
                      {issues.map((x, k) => (
                        <button key={k} onClick={() => previewSceneAt(x.sceneIndex)} className="text-left text-[10px] flex items-start gap-1" style={{ color: x.level === "warn" ? C.amber : C.textDim, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                          <AlertTriangle size={10} style={{ marginTop: 2, flexShrink: 0 }} /> 場面{x.sceneIndex + 1}：{x.message}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="text-[10px] mt-1" style={{ color: C.textDim }}>数値・日付は必ず元の資料で確認してください。丸写しの確認はURL・テキストの参考情報が対象です（PDFは対象外）。</div>
                </Section>

                {/* 場面とナレーション */}
                <Section title={`場面とナレーション（${scenes.length}場面・ドラッグで並べ替え）`} right={
                  <button onClick={() => { setAiOpenId((v) => (v === "__new" ? null : "__new")); setAiText(""); setAiError(""); }} className="text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1" style={btn()}><Plus size={10} /> 場面をAIで追加</button>
                }>
                  {aiOpenId === "__new" && (
                    <div className="mb-1.5 p-2 rounded flex items-center gap-1.5" style={{ background: C.panel2, border: `1px solid ${C.borderSoft}` }}>
                      <input autoFocus value={aiText} onChange={(e) => setAiText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !aiBusy) runSceneAi("__new"); }} placeholder={`場面${currentSceneIdx + 1}の後ろに追加。例：住宅ローンの返済額の変化を棒グラフで`} className="flex-1 text-[11px] rounded px-2 py-1" style={{ ...inputStyle, background: C.panel }} />
                      <button onClick={() => runSceneAi("__new")} disabled={aiBusy || !aiText.trim()} className="text-[10px] px-2 py-1 rounded" style={{ ...btn("primary"), opacity: aiBusy || !aiText.trim() ? 0.5 : 1 }}>{aiBusy ? "生成中…" : "追加"}</button>
                    </div>
                  )}
                  {aiError && <div className="text-[10px] mb-1" style={{ color: "#ff6b6b" }}>{aiError}</div>}
                  <div ref={listRef} className="flex flex-col gap-1.5 overflow-y-auto pr-1" style={{ maxHeight: 560 }}>
                    {scenes.map((sc, i) => {
                      const cur = i === currentSceneIdx;
                      const est = sceneDurs[i] ?? estDurs[i];
                      const iss = issuesByScene[i] || [];
                      return (
                        <div key={sc.id} ref={(el) => { sceneRefs.current[i] = el; }} draggable
                          onDragStart={() => { dragIdxRef.current = i; }} onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => { e.preventDefault(); if (dragIdxRef.current !== null) moveScene(dragIdxRef.current, i); dragIdxRef.current = null; }}
                          className="rounded p-2" style={{ background: cur ? "rgba(46,230,184,0.08)" : C.panel2, border: `1px solid ${cur ? C.teal : C.borderSoft}`, boxShadow: cur ? `inset 3px 0 0 ${C.teal}` : "none" }}>
                          <div className="flex items-center gap-1.5 mb-1">
                            <GripVertical size={12} style={{ color: C.textDim, cursor: "grab", flexShrink: 0 }} />
                            <button onClick={() => previewSceneAt(i)} className="text-[10px] flex items-center gap-1 min-w-0 text-left" title="クリックでこの場面をプレビュー" style={{ color: cur ? C.teal : C.textMuted, fontWeight: cur ? 600 : 400, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                              {cur && <Play size={9} />}<span className="truncate">{i + 1}. {sc.title}</span>
                              <span style={{ color: est >= 24 ? C.rust : C.textDim, fontWeight: est >= 24 ? 700 : 400 }}>（{est.toFixed(0)}秒）</span>
                              {iss.some((x) => x.level === "warn") && <AlertTriangle size={10} style={{ color: C.amber }} />}
                            </button>
                            <select value={sc.visual.kind} onChange={(e) => { const k = e.target.value; patchScene(sc.id, { visual: normalizeVisual({ ...sc.visual, kind: k }), minSec: minSecFor(k) }); }} className="ml-auto text-[10px] px-1 py-0.5 rounded" style={inputStyle} title="図解の種類">
                              {[...VISUAL_KINDS, "chapter", "sources"].map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                            </select>
                            <button onClick={() => speak(ttsText(sc))} className="text-[10px] flex items-center gap-0.5" style={{ color: C.teal, background: "none", border: "none", cursor: "pointer" }}><Play size={10} />試聴</button>
                            <button onClick={() => { setAiOpenId((v) => (v === sc.id ? null : sc.id)); setAiText(""); setAiError(""); }} className="text-[10px] flex items-center gap-0.5" style={{ color: aiOpenId === sc.id ? C.teal : C.textDim, background: "none", border: "none", cursor: "pointer" }} title="AIに作り直しを指示"><MessageSquare size={10} />AI</button>
                            <button onClick={() => removeScene(sc.id)} title="この場面を削除" style={{ color: C.textDim, background: "none", border: "none", cursor: "pointer" }}><X size={12} /></button>
                          </div>
                          <textarea value={sc.narration} rows={2}
                            onChange={(e) => patchScene(sc.id, { narration: e.target.value.replace(/\n/g, ""), readingStale: true })}
                            className="w-full rounded px-1.5 py-1 text-[11px] leading-relaxed" style={{ ...inputStyle, background: C.panel, resize: "vertical" }} />
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <button onClick={() => setReadingOpenId((v) => (v === sc.id ? null : sc.id))} className="text-[10px] flex items-center gap-0.5" style={{ color: isKanaReading(sc.reading) && !sc.readingStale ? C.textDim : C.amber, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                              読み上げ文{sc.readingStale ? "（ナレーションと要確認）" : ""}<ChevronRight size={10} style={{ transform: readingOpenId === sc.id ? "rotate(90deg)" : "none" }} />
                            </button>
                            <button onClick={() => setEditVisualId((v) => (v === sc.id ? null : sc.id))} className="text-[10px] flex items-center gap-0.5" style={{ color: C.textDim, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                              図解の内容<ChevronRight size={10} style={{ transform: editVisualId === sc.id ? "rotate(90deg)" : "none" }} />
                            </button>
                            {sc.imageId ? (
                              <span className="text-[10px] inline-flex items-center gap-1" style={{ color: C.teal }}><ImageIcon size={10} /> 画像あり<button onClick={() => detachImage(sc)} style={{ color: C.textDim, background: "none", border: "none", cursor: "pointer" }}><X size={10} /></button></span>
                            ) : (
                              <button onClick={() => setRightsPendingId((v) => (v === sc.id ? null : sc.id))} className="text-[10px] flex items-center gap-0.5" style={{ color: C.textDim, background: "none", border: "none", cursor: "pointer", padding: 0 }}><ImageIcon size={10} /> 画像を追加</button>
                            )}
                            <span className="text-[10px] ml-auto" style={{ color: C.textDim }}>テロップ</span>
                            <input value={sc.caption} onChange={(e) => patchScene(sc.id, { caption: e.target.value })} className="text-[10px] px-1 py-0.5 rounded w-40" style={inputStyle} />
                          </div>
                          {readingOpenId === sc.id && (
                            <div className="mt-1">
                              <textarea value={sc.reading} rows={2} onChange={(e) => patchScene(sc.id, { reading: e.target.value.replace(/\n/g, ""), readingStale: false })} className="w-full rounded px-1.5 py-1 text-[11px]" style={{ ...inputStyle, background: C.panel, resize: "vertical" }} />
                              <div className="text-[10px] flex items-center gap-2" style={{ color: C.textDim }}>
                                音声はこの文（ひらがな）で読み上げます。ナレーションを直したら、ここも合わせて直すか「AI」で「読み上げ文を今のナレーションに合わせて」と指示してください。
                                <button onClick={() => patchScene(sc.id, { reading: sanitizeReading(sc.reading, sc.narration).reading })} className="shrink-0" style={{ color: C.teal, background: "none", border: "none", cursor: "pointer" }}>整える</button>
                              </div>
                            </div>
                          )}
                          {editVisualId === sc.id && (
                            <div className="mt-1 p-1.5 rounded flex flex-col gap-1" style={{ background: C.panel, border: `1px solid ${C.borderSoft}` }}>
                              <div className="flex gap-1">
                                <input value={sc.visual.heading} onChange={(e) => patchVisual(sc.id, { heading: e.target.value })} placeholder="見出し" className="flex-1 text-[10px] px-1 py-0.5 rounded" style={inputStyle} />
                                <input value={sc.visual.unit} onChange={(e) => patchVisual(sc.id, { unit: e.target.value })} placeholder="単位" className="w-14 text-[10px] px-1 py-0.5 rounded" style={inputStyle} />
                              </div>
                              <input value={sc.visual.subheading} onChange={(e) => patchVisual(sc.id, { subheading: e.target.value })} placeholder="副題・補足" className="text-[10px] px-1 py-0.5 rounded" style={inputStyle} />
                              <input value={sc.visual.emphasis} onChange={(e) => patchVisual(sc.id, { emphasis: e.target.value })} placeholder="強調のひとこと" className="text-[10px] px-1 py-0.5 rounded" style={inputStyle} />
                              <textarea defaultValue={itemsToText(sc.visual.items)} key={sc.id + JSON.stringify(sc.visual.items)} onBlur={(e) => patchScene(sc.id, { visual: normalizeVisual({ ...sc.visual, items: textToItems(e.target.value) }) })} rows={Math.max(2, sc.visual.items.length)} className="text-[10px] px-1 py-0.5 rounded mono" style={{ ...inputStyle, resize: "vertical" }} />
                              <div className="text-[10px]" style={{ color: C.textDim }}>1行1項目：見出し｜数値｜説明｜アイコン（枠の外をクリックで反映）。アイコン：{ICON_NAMES.join(", ")}</div>
                              <input value={sc.visual.source} onChange={(e) => patchVisual(sc.id, { source: e.target.value })} placeholder="出典（数値を使う場合は必須）" className="text-[10px] px-1 py-0.5 rounded" style={inputStyle} />
                              {sc.visual.imagePrompt && (
                                <div className="text-[10px] flex items-start gap-1" style={{ color: C.textDim }}>
                                  <span className="flex-1">画像生成用のプロンプト案：{sc.visual.imagePrompt}</span>
                                  <button onClick={() => copyText(sc.visual.imagePrompt)} title="コピー" style={{ color: C.teal, background: "none", border: "none", cursor: "pointer" }}><Copy size={10} /></button>
                                </div>
                              )}
                            </div>
                          )}
                          {rightsPendingId === sc.id && (
                            <div className="mt-1 p-1.5 rounded text-[10px] flex flex-col gap-1" style={{ background: `${C.amber}12`, border: `1px solid ${C.amber}55`, color: C.textMuted }}>
                              <div>使えるのは、自分で撮影・作成した画像、利用条件を確認したフリー素材、画像生成AIで自作したもの（実在の人物・ロゴ・既存作品を含まない）です。ニュースサイトの写真や人物写真をそのまま使うのは避けてください。</div>
                              {sc.visual.imagePrompt && <div className="flex items-center gap-1">プロンプト案をコピー<button onClick={() => copyText(sc.visual.imagePrompt)} style={{ color: C.teal, background: "none", border: "none", cursor: "pointer" }}><Copy size={10} /></button></div>}
                              <label className="self-start px-2 py-0.5 rounded cursor-pointer" style={btn()}>権利を確認した画像を選ぶ
                                <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) attachImage(sc.id, f); }} />
                              </label>
                            </div>
                          )}
                          {aiOpenId === sc.id && (
                            <div className="mt-1.5 pt-1.5 flex items-center gap-1.5" style={{ borderTop: `1px solid ${C.borderSoft}` }}>
                              <input autoFocus value={aiText} onChange={(e) => setAiText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !aiBusy) runSceneAi(sc.id); }} placeholder="例：もっとやさしく／流れ図にして／数字を入れて短く" className="flex-1 text-[11px] rounded px-2 py-1" style={{ ...inputStyle, background: C.panel }} />
                              <button onClick={() => runSceneAi(sc.id)} disabled={aiBusy || !aiText.trim()} className="text-[10px] px-2 py-1 rounded" style={{ ...btn("primary"), opacity: aiBusy || !aiText.trim() ? 0.5 : 1 }}>{aiBusy ? "生成中…" : "送信"}</button>
                            </div>
                          )}
                          {iss.length > 0 && <div className="mt-1 flex flex-col">{iss.map((x, k) => (
                            <span key={k} className="text-[10px] flex items-center gap-2 flex-wrap" style={{ color: x.level === "warn" ? C.amber : C.textDim }}>
                              ・{x.message}
                              {x.message.startsWith("参考資料の文章") && <button onClick={() => paraphraseOne(sc)} disabled={!!paraBusyId} className="text-[10px] px-1.5 py-0.5 rounded" style={{ ...btn("primary"), opacity: paraBusyId ? 0.5 : 1 }}>{paraBusyId === sc.id ? "言い換え中…" : "AIで言い換える"}</button>}
                            </span>
                          ))}</div>}
                        </div>
                      );
                    })}
                  </div>
                </Section>

                {/* アバター */}
                <Section title={`アバター（長尺動画作成と共通・1人につき最大${MAX_CLIPS}本）`} right={<button onClick={addAvatar} className="text-[11px] px-2 py-1 rounded" style={btn()}>＋ アバターを追加</button>}>
                  {avatars.length === 0 && <p className="text-[10px] mb-1.5" style={{ color: C.textDim }}>未登録のあいだは人物は表示されません。</p>}
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {avatars.map((a) => (
                      <span key={a.id} className="inline-flex items-center gap-1 text-[11px] pl-2 pr-1 py-1 rounded" style={{ color: avatarId === a.id ? C.bg : C.textMuted, background: avatarId === a.id ? C.teal : "transparent", border: `1px solid ${C.borderSoft}`, fontWeight: avatarId === a.id ? 700 : 400 }}>
                        <button onClick={() => setAvatarId(a.id)} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", fontWeight: "inherit" }}>{a.gender === "male" ? "♂" : "♀"} {a.name}（{a.clips.filter(Boolean).length}本）</button>
                        <X size={11} style={{ cursor: "pointer" }} onClick={() => removeAvatarHandler(a.id)} />
                      </span>
                    ))}
                  </div>
                  {curAvatar && (
                    <div className="rounded p-2 flex flex-col gap-1.5" style={{ background: C.panel2, border: `1px solid ${C.borderSoft}` }}>
                      <button onClick={() => setAvatarEditorOpen((v) => !v)} className="flex items-center justify-between w-full text-[11px]" style={{ color: C.textMuted, background: "transparent", border: "none", padding: 0, cursor: "pointer" }}>
                        <span>{curAvatar.name}（動画{curAvatar.clips.filter(Boolean).length}本・{curAvatar.keyOn ? `背景消去あり/感度${curAvatar.tol}` : "背景消去なし"}・大きさ{Math.round(curAvatar.zoom * 100)}%）</span>
                        <span style={{ color: C.teal }}>{avatarEditorOpen ? "▲ 閉じる" : "▼ 編集"}</span>
                      </button>
                      {avatarEditorOpen && (
                        <>
                          <div className="flex items-center flex-wrap gap-1.5 text-[11px]" style={{ color: C.textDim }}>
                            <span>名前</span><input value={curAvatar.name} onChange={(e) => patchAvatar(curAvatar.id, { name: e.target.value })} className="px-1.5 py-0.5 rounded text-xs" style={{ ...inputStyle, width: 120 }} />
                            <span className="ml-1">性別</span>
                            {["male", "female"].map((g) => <button key={g} onClick={() => patchAvatar(curAvatar.id, { gender: g })} className="text-[11px] px-2 py-0.5 rounded" style={{ color: curAvatar.gender === g ? C.bg : C.textMuted, background: curAvatar.gender === g ? C.teal : "transparent", border: `1px solid ${C.borderSoft}`, cursor: "pointer" }}>{g === "male" ? "男性" : "女性"}</button>)}
                          </div>
                          {Array.from({ length: MAX_CLIPS }).map((_, k) => {
                            const clip = curAvatar.clips[k] ?? null;
                            return (
                              <div key={k} className="flex items-center gap-1.5 text-[11px]" style={{ color: C.textDim }}>
                                <span style={{ width: 40 }}>動画{k + 1}</span>
                                <label className="px-2 py-0.5 rounded cursor-pointer" style={{ color: C.teal, border: `1px solid ${C.teal}66` }}>{clip ? "差し替え" : "MP4を選択"}
                                  <input type="file" accept="video/mp4,video/*,.mp4,.m4v,.mov,.webm" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0] ?? null; e.target.value = ""; if (f) setAvatarClip(curAvatar.id, k, f); }} />
                                </label>
                                <span className="truncate flex-1">{clip ? clip.name : "未登録"}</span>
                                {clip && <X size={12} style={{ cursor: "pointer" }} onClick={() => setAvatarClip(curAvatar.id, k, null)} />}
                              </div>
                            );
                          })}
                          <label className="flex items-center gap-1.5 text-[11px]" style={{ color: C.textDim }}><input type="checkbox" checked={curAvatar.keyOn} onChange={(e) => patchAvatar(curAvatar.id, { keyOn: e.target.checked })} /> 背景を消す（動画の四隅の色を基準）</label>
                          {curAvatar.keyOn && <label className="flex items-center gap-1.5" style={{ color: C.textDim }}>背景を消す感度 {curAvatar.tol}<input type="range" min={8} max={60} step={1} value={curAvatar.tol} onChange={(e) => patchAvatar(curAvatar.id, { tol: parseInt(e.target.value, 10) })} /></label>}
                          <label className="flex items-center gap-1.5" style={{ color: C.textDim }}>人物の大きさ {Math.round(curAvatar.zoom * 100)}%<input type="range" min={0.5} max={1.4} step={0.05} value={curAvatar.zoom} onChange={(e) => patchAvatar(curAvatar.id, { zoom: parseFloat(e.target.value) })} /></label>
                        </>
                      )}
                    </div>
                  )}
                </Section>

                {/* 声 */}
                <Section title="声（長尺動画作成と共通）">
                  <select value={activePresetId ? `preset:${activePresetId}` : voiceIndex} onChange={(e) => { const v = e.target.value; if (v.startsWith("preset:")) { const p = voicePresets.find((x) => `preset:${x.id}` === v); if (p) applyPreset(p); return; } setActivePresetId(null); setVoiceIndex(v); speak(SAMPLE, v); }} className="text-xs px-2 py-1.5 rounded w-full mb-1" style={inputStyle}>
                    {voicePresets.length > 0 && <optgroup label="登録したオリジナル音声">{voicePresets.map((p) => <option key={p.id} value={`preset:${p.id}`}>★ {p.name}</option>)}</optgroup>}
                    {voiceChoices.length === 0 && <option value="">（音声が見つかりません）</option>}
                    {voiceChoices.map((v) => <option key={v} value={v}>{v.replace(/^aivis:\d+:/, "Aivis：").replace(/^(sapi|oc):/, "")}</option>)}
                  </select>
                  {voiceNote && <div className="text-[10px] mb-1.5" style={{ color: C.rust }}>{voiceNote}</div>}
                  <div className="flex items-start gap-2 mb-2">
                    <p className="text-[10px] flex-1" style={{ color: C.textDim }}>
                      AivisSpeechを起動しておくと声の候補に追加されます（既定 {getAivisUrl()}）。{voices.some(isAivisVoice) ? "" : "候補に出ない場合は、AivisSpeechの起動完了を待って「声の一覧を更新」を押してください。それでも出ない場合は、AivisSpeechの設定でCORSを「all」にしてください。"}
                    </p>
                    <button onClick={refreshVoices} disabled={voicesRefreshing} className="text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1 shrink-0" style={{ ...btn(), opacity: voicesRefreshing ? 0.5 : 1 }}><RefreshCw size={10} /> {voicesRefreshing ? "確認中…" : "声の一覧を更新"}</button>
                  </div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="flex items-center gap-1.5">
                      <label className="flex items-center gap-1.5" style={{ color: C.textDim }}>速さ<input type="range" min={0.6} max={2.0} step={0.05} value={rate} onChange={(e) => { const v = Number(e.target.value); setRate(v); updateLocked("rate", v); setActivePresetId(null); }} onMouseUp={() => speak(SAMPLE)} onTouchEnd={() => speak(SAMPLE)} />{rate.toFixed(2)}x</label>
                      <SliderLockButton locked={!!sliderLocks.rate?.locked} onClick={() => toggleSliderLock("rate", rate)} />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <label className="flex items-center gap-1.5" style={{ color: C.textDim }}>高さ<input type="range" min={0.8} max={1.3} step={0.02} value={pitch} onChange={(e) => { const v = Number(e.target.value); setPitch(v); updateLocked("pitch", v); setActivePresetId(null); }} onMouseUp={() => speak(SAMPLE)} onTouchEnd={() => speak(SAMPLE)} />{pitch.toFixed(2)}x</label>
                      <SliderLockButton locked={!!sliderLocks.pitch?.locked} onClick={() => toggleSliderLock("pitch", pitch)} />
                    </div>
                  </div>
                  <div className="flex items-center gap-1 mt-1.5">
                    <input value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="この声に名前を付けて登録" className="flex-1 min-w-0 px-1.5 py-1 rounded text-[11px]" style={inputStyle} />
                    <button onClick={handleSavePreset} className="text-[11px] px-2 py-1 rounded whitespace-nowrap" style={btn()}>★ 登録</button>
                  </div>
                  {voicePresets.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {voicePresets.map((p) => (
                        <span key={p.id} className="text-[10px] px-1.5 py-0.5 rounded inline-flex items-center gap-1" style={{ border: `1px solid ${C.borderSoft}`, color: C.textMuted }}>
                          ★ {p.name}<button onClick={() => removePreset(p.id)} title="削除" style={{ color: C.textDim, background: "none", border: "none", cursor: "pointer" }}>×</button>
                        </span>
                      ))}
                    </div>
                  )}
                  <button onClick={() => { setPresetIoOpen((v) => !v); setPresetIoNote(""); }} className="text-[10px] mt-1.5 flex items-center gap-0.5" style={{ color: C.textDim, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                    他のサイトで登録した声を取り込む／書き出す<ChevronRight size={10} style={{ transform: presetIoOpen ? "rotate(90deg)" : "none" }} />
                  </button>
                  {presetIoOpen && (
                    <div className="mt-1 p-2 rounded flex flex-col gap-1.5" style={{ background: C.panel2, border: `1px solid ${C.borderSoft}` }}>
                      <div className="text-[10px] leading-relaxed" style={{ color: C.textDim }}>
                        取り込み元のページ（investment-shorts）を開き、F12 →「Console」に次の1行を貼り付けてEnterを押すと、登録した声がコピーされます。それを下の枠に貼り付けてください。
                      </div>
                      <div className="flex items-start gap-1">
                        <code className="mono text-[10px] flex-1 p-1 rounded break-all" style={{ background: C.panel, color: C.text }}>{PRESET_EXPORT_SNIPPET}</code>
                        <button onClick={() => copyText(PRESET_EXPORT_SNIPPET)} title="コピー" style={{ color: C.teal, background: "none", border: "none", cursor: "pointer" }}><Copy size={12} /></button>
                      </div>
                      <textarea value={presetIoText} onChange={(e) => setPresetIoText(e.target.value)} rows={3} placeholder="ここをクリックして Ctrl + V で貼り付け（コピーした声のデータ）" className="px-1.5 py-1 rounded text-[10px] mono" style={{ ...inputStyle, background: C.panel, resize: "vertical" }} />
                      <div className="flex items-center gap-2">
                        <button onClick={importPresets} disabled={!presetIoText.trim()} className="text-[10px] px-2 py-1 rounded" style={{ ...btn("primary"), opacity: presetIoText.trim() ? 1 : 0.5 }}>取り込む</button>
                        <button onClick={() => { copyText(JSON.stringify(voicePresets)); setPresetIoNote("この画面の登録済みの声をコピーしました"); }} className="text-[10px] px-2 py-1 rounded" style={btn()}>この画面の声をコピー（書き出し）</button>
                      </div>
                      {presetIoNote && <div className="text-[10px]" style={{ color: C.teal }}>{presetIoNote}</div>}
                      <div className="text-[10px]" style={{ color: C.textDim }}>取り込んだ声は、同じサイトのDD戦略ダッシュボード（長尺動画作成）でも選べます。localhost と公開サイトは別扱いのため、それぞれで取り込みが必要です。</div>
                    </div>
                  )}
                </Section>

                {/* 背景 */}
                <Section title="背景画像（人物のうしろ・長尺動画作成の長尺用と共通）">
                  <div className="flex flex-wrap gap-1.5 mb-1.5">
                    <button onClick={() => setActiveBackgroundId("")} className="text-[11px] px-2 py-1 rounded" style={{ color: activeBackgroundId === "" ? C.bg : C.textMuted, background: activeBackgroundId === "" ? C.teal : "transparent", border: `1px solid ${C.borderSoft}`, cursor: "pointer" }}>なし</button>
                    {backgrounds.map((b) => (
                      <span key={b.id} className="inline-flex items-center gap-1 text-[11px] pl-2 pr-1 py-1 rounded" style={{ color: activeBackgroundId === b.id ? C.bg : C.textMuted, background: activeBackgroundId === b.id ? C.teal : "transparent", border: `1px solid ${C.borderSoft}` }}>
                        <button onClick={() => setActiveBackgroundId(b.id)} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer" }}>{b.name}</button>
                        <X size={11} style={{ cursor: "pointer" }} onClick={() => handleBackgroundDelete(b.id)} />
                      </span>
                    ))}
                    <label className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded" style={{ color: C.textMuted, border: `1px solid ${C.borderSoft}`, cursor: "pointer" }}><Upload size={11} /> 追加<input type="file" accept="image/*" onChange={handleBackgroundUpload} style={{ display: "none" }} /></label>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <label className="flex items-center gap-1.5" style={{ color: C.textDim }}>不透明度<input type="range" min={0} max={100} value={backgroundOpacity} onChange={(e) => { const v = Number(e.target.value); setBackgroundOpacity(v); updateLocked("backgroundOpacity", v); }} />{backgroundOpacity}%</label>
                    <SliderLockButton locked={!!sliderLocks.backgroundOpacity?.locked} onClick={() => toggleSliderLock("backgroundOpacity", backgroundOpacity)} />
                  </div>
                </Section>

                {/* BGM */}
                <Section title="BGM（長尺動画作成の長尺用と共通）">
                  <div className="flex flex-wrap gap-1.5 mb-1.5">
                    <button onClick={() => setActiveBgmId("")} className="text-[11px] px-2 py-1 rounded" style={{ color: activeBgmId === "" ? C.bg : C.textMuted, background: activeBgmId === "" ? C.teal : "transparent", border: `1px solid ${C.borderSoft}`, cursor: "pointer" }}>なし</button>
                    {bgms.map((b) => (
                      <span key={b.id} className="inline-flex items-center gap-1 text-[11px] pl-2 pr-1 py-1 rounded" style={{ color: activeBgmId === b.id ? C.bg : C.textMuted, background: activeBgmId === b.id ? C.teal : "transparent", border: `1px solid ${C.borderSoft}` }}>
                        <button onClick={() => setActiveBgmId(b.id)} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer" }}>{b.name}</button>
                        <X size={11} style={{ cursor: "pointer" }} onClick={() => handleBgmDelete(b.id)} />
                      </span>
                    ))}
                    <label className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded" style={{ color: C.textMuted, border: `1px solid ${C.borderSoft}`, cursor: "pointer" }}><Upload size={11} /> 追加<input type="file" accept="audio/*" onChange={handleBgmUpload} style={{ display: "none" }} /></label>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <label className="flex items-center gap-1.5" style={{ color: C.textDim }}>音量<input type="range" min={0} max={100} value={bgmVolume} onChange={(e) => { const v = Number(e.target.value); setBgmVolume(v); updateLocked("bgmVolume", v); }} />{bgmVolume}%</label>
                    <SliderLockButton locked={!!sliderLocks.bgmVolume?.locked} onClick={() => toggleSliderLock("bgmVolume", bgmVolume)} />
                  </div>
                </Section>

                {/* YouTube */}
                <Section title={format === "long" ? "YouTube（本編）の投稿情報" : "YouTube（ショート）の投稿情報"}>
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-1">
                      <input value={format === "long" ? project.youtube.title : project.youtube.shortTitle} onChange={(e) => patchYoutube(format === "long" ? { title: e.target.value } : { shortTitle: e.target.value })} className="flex-1 px-1.5 py-1 rounded text-[11px]" style={inputStyle} />
                      <button onClick={() => copyText(format === "long" ? project.youtube.title : project.youtube.shortTitle)} title="タイトルをコピー" style={{ color: C.teal, background: "none", border: "none", cursor: "pointer" }}><Copy size={12} /></button>
                    </div>
                    {format === "long" && (
                      <div className="flex items-center gap-1 text-[11px]" style={{ color: C.textDim }}>サムネの文字
                        <input value={project.youtube.thumbnailText} onChange={(e) => patchYoutube({ thumbnailText: e.target.value })} className="flex-1 px-1.5 py-1 rounded text-[11px]" style={inputStyle} />
                      </div>
                    )}
                    <div className="relative">
                      <textarea readOnly value={description} rows={7} onClick={(e) => e.target.select()} className="w-full px-1.5 py-1 rounded text-[11px]" style={{ ...inputStyle, resize: "vertical" }} />
                      <button onClick={() => copyText(description)} className="absolute right-1 top-1 text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1" style={btn()}><Copy size={10} /> 概要欄をコピー</button>
                    </div>
                    <textarea value={format === "long" ? project.youtube.description : project.youtube.shortDescription} onChange={(e) => patchYoutube(format === "long" ? { description: e.target.value } : { shortDescription: e.target.value })} rows={3} className="w-full px-1.5 py-1 rounded text-[10px]" style={{ ...inputStyle, resize: "vertical" }} title="概要欄の本文（上のプレビューには参考資料・注記・タグが自動で付きます）" />
                    {format === "short" && <div className="text-[10px]" style={{ color: C.textDim }}>投稿後、ショートの「関連動画」に本編を設定すると、画面上の「続きは本編で」から本編へ移動できます。</div>}
                  </div>
                </Section>
              </div>
            </div>
          </>
        )}
        <div className="text-[10px] leading-relaxed" style={{ color: C.textDim }}>
          図解・イラストはこのアプリが描くオリジナルです。参考資料の文章は言い換えて使い、出典は動画末尾と概要欄に記載します。公開前に、数値・日付・固有名詞を元の資料で確認してください。
        </div>
      </div>
    </div>
  );
}
