"use client";
// ニュース・キーワード解説動画の作成画面（長尺16:9＋宣伝用ショート9:16）。
// DD戦略ダッシュボードの「長尺動画作成」（VideoCreateModalContent）のUI・仕組みをベースにしている：
//  - 左：Canvasプレビュー（再生・先頭へ・サムネ保存・書き出し）／右：構成→場面とナレーション→アバター→声→背景→BGM
//  - アバター・声（ローカルTTS／AivisSpeech・登録した声）・背景・BGMは、同じブラウザ内の保存データ（IndexedDB・localStorage）を
//    そのまま共有する（同じサイト内のページなので、長尺動画作成で登録したものがここでも選べる）。
// 違い：台本は「テーマ＋参考情報（テキスト・URL・PDF）」からAIが作る。図解はすべて自作の図形・アイコンで描く（著作権・肖像権への配慮）。
import { useEffect, useMemo, useRef, useState } from "react";
import NarrMixedBox from "@/components/NarrMixedBox";
import { Play, Pause, Square, Camera, Download, Upload, X, GripVertical, MessageSquare, ChevronRight, Lock, Unlock, Link2, FileText, Type, Sparkles, Copy, AlertTriangle, Check, Image as ImageIcon, RefreshCw, Plus, ArrowLeft, Search, ExternalLink, Eye, EyeOff, Pin, PinOff } from "lucide-react";
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
import { generateProject, generateShort, rewriteScene, rewriteNarration, applyLearnedEdit, updateReadingForEdit, CHARS_PER_MIN } from "@/lib/explainer/aiScript";
import { AiClientError } from "@/lib/explainer/aiClient";
import { referenceBlocks, referenceTexts, fetchUrlReference, fileToBase64, newRefId, refLabel, requiredRefNotes, MAX_PDF_BYTES } from "@/lib/explainer/references";
import { lintScenes, buildDescription, sourcesScene, assembleLong, findVerbatimOverlaps, predictTotalSec, suggestRate, COMFORT_RATE, normalizeVisual, minSecFor, sanitizeReading, isKanaReading } from "@/lib/explainer/scriptModel";
import { saveImage, listImages, deleteImage } from "@/lib/explainer/imageStore";
import { generateImage } from "@/lib/explainer/imageClient";
import { researchTopic } from "@/lib/explainer/researchClient";
import { safeFileName, canPickFolder, getSavedFolder, pickFolder, ensureWritable, saveBundle, descriptionText } from "@/lib/explainer/exportBundle";
import { exportVideoProfile, importVideoProfile } from "@/lib/videoProfileSnapshot";
import AutoScheduleStudio from "@/components/AutoScheduleStudio";
import { VISUAL_KINDS, ICON_NAMES } from "@/lib/explainer/types";
import { storage } from "@/lib/storage";
import { easternStamp } from "@/lib/marketClock";
import { parseStooqCSV } from "@/lib/csvPrice";
import { buildStockCatalogFromSnapshot, buildStockCatalogFromCsv, mergeStockCatalogs, resolveYearCompareItems } from "@/lib/explainer/stockCatalog";
import { buildFixedDataChapters, fixedChaptersNote, mergeFixedChapters, dataPeriodOf, dataPeriodNoteOf } from "@/lib/explainer/dataChapters";
import { decorateTitleScene } from "@/lib/explainer/sp500SheetScenes";
import { computeSp500Sheets } from "@/lib/sp500Sheets";
import { drawVisual, PALETTE } from "@/lib/explainer/visuals";

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
  yearCompare: "年比較グラフ", // [Stage E-9] 株式情報モードのみ使う
  branch: "分岐図", histogram: "ヒストグラム", distribution: "分布（ドット）", groupedBar: "グループ棒グラフ", // [Stage E-10〜13]
  fan: "重ね描き＋レンジ", zoomLine: "年初来→直近ズーム", butterfly: "バタフライ", ddHistory: "DDの推移（暴落）", // [Stage E-16] 固定場面専用
};
// [Stage E-17] 制作者がナレーションを直した記録（次回以降の台本生成に反映する）。
// fixed：実データの固定場面ごと（fixedKey→直す前の自動生成文・直した後の文・その読み上げ文）。数値は毎回変わるので、
//        次回はAIに「同じ直し方」を今回の文へ当てはめさせる（直す前と今回の文が同じなら、直した後の文をそのまま使う）。
// general：AIが作る場面の直し（モードごと、最新20件）。次回の台本生成のときにAIへ「この書き方にそろえる」例として渡す。
const LEARNED_KEY = "explainer-learned-edits-v1";
const loadLearned = () => { try { const j = JSON.parse(localStorage.getItem(LEARNED_KEY) || "null"); return j && typeof j === "object" ? { fixed: j.fixed || {}, general: j.general || {} } : { fixed: {}, general: {} }; } catch (e) { return { fixed: {}, general: {} }; } };
const saveLearned = (v) => { try { localStorage.setItem(LEARNED_KEY, JSON.stringify(v)); } catch (e) { /* 容量超過などは無視 */ } };
// fixedKeyを持たない以前の台本でも、固定場面のタイトルなら同じ場面として扱う
const FIXED_TITLES = new Set(["前提条件", "DD（ドローダウン）とは", "発生回数と深さの分布", "「谷間」の考え方", "現在の状況（年初来→直近）", "年初来の騰落日数", "DD速度センサー", "過去のDD局面との重ね描き", "DD速度センサー（分岐）", "1日で1%超下がったら", "1日下落のその後", "保有期間で変わる勝率", "最高値更新のペース", "最高値更新ペース", "暴落の歴史（DDチャート）", "現在地点からの深掘り", "現在地点からの3パターン", "長期ローリングリターン", "年初来パス比較", "将来シナリオ①", "将来シナリオ②", "将来シナリオ③", "将来シナリオ④", "将来シナリオ⑤", "将来シナリオ⑥", "将来シナリオ⑦", "類似局面サーチ", "まとめ：分かった事実", "免責事項"]);
const fixedKeyOf = (sc) => sc.fixedKey || (FIXED_TITLES.has(sc.title) ? `fixed:${sc.title}` : null);
// 取り込み元のページのConsoleで実行する1行：localStorageの中から「登録した声」の形の配列を探してクリップボードにコピーする
const PRESET_EXPORT_SNIPPET = `copy(JSON.stringify(Object.keys(localStorage).flatMap(k=>{try{const v=JSON.parse(localStorage.getItem(k));return Array.isArray(v)&&v.length&&v.every(p=>p&&typeof p.name==='string'&&typeof p.voice==='string')?v:[]}catch(e){return[]}})))`;
const LENGTH_OPTIONS = [3, 4, 5, 6, 7, 8];
// 長尺の長さ（分）を選んだら、ラベル（kicker）に自動で入れる文言。あとから自由に書き換えられる（変更後はこのパターンに一致しなくなるので自動更新の対象から外れる）
const autoKickerFor = (minutes) => `${minutes}分で解説`;
const KICKER_AUTO_RE = /^\d+分で解説$/;
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
// Stage G-2：長考（台本生成等）の進行状況を、画面右下に固定表示するフローティングパネル
// （「Japan Untold Studio」の進行状況パネルを参考に見た目を近づけた。実コードは参照していない）。
function GenProgressPanel({ step, done, total, elapsedSec, onAbort }) {
  const pct = Math.round((done / Math.max(1, total)) * 100);
  return (
    <div className="fixed bottom-4 right-4 z-50 rounded-lg p-3 shadow-lg" style={{ background: C.panel, border: `1px solid ${C.border}`, width: 300, boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className="rounded-full animate-pulse" style={{ width: 8, height: 8, background: C.amber, flexShrink: 0 }} />
        <span className="text-[12px] font-semibold flex-1 min-w-0 truncate" style={{ color: C.text }}>生成しています…</span>
        <span className="text-[11px]" style={{ color: C.textMuted }}>{pct}%</span>
      </div>
      <div className="text-[11px] mb-1.5 leading-relaxed" style={{ color: C.textMuted }}>{step}</div>
      <div className="w-full h-1.5 rounded overflow-hidden mb-1.5" style={{ background: C.panel2 }}>
        <div className="h-full" style={{ width: `${pct}%`, background: C.teal, transition: "width .3s" }} />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[10px]" style={{ color: C.textDim }}>経過 {fmtTime(elapsedSec)}</span>
        <button onClick={onAbort} className="text-[11px] px-2 py-0.5 rounded" style={{ background: "transparent", color: C.rust, border: `1px solid ${C.rust}66`, cursor: "pointer" }}>中止</button>
      </div>
    </div>
  );
}
// [Stage G-4] 場面カードのサムネイル：画像（sc.imageId）が無い場面は、lib/explainer/visuals.tsの
// drawVisual()を直接呼んで図解（棒グラフ・折れ線・要点カード等）の静止画を小さなcanvasに描く
// （ExplainerRendererクラス＝アバター・音声込みのフル描画は使わない。図解単体の軽量な描画のみ）。
// p=1（場面の最後まで進んだ状態）で描くことで、アニメーションの途中状態ではない完成形を見せる。
function SceneThumbCanvas({ sc, portrait }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const vis = portrait ? { W: 420, H: 361 } : { W: 640, H: 400 };
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = canvas.clientWidth || 240, cssH = canvas.clientHeight || (portrait ? 206 : 150);
    canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
    const scale = Math.min(canvas.width / vis.W, canvas.height / vis.H);
    const offX = (canvas.width - vis.W * scale) / 2, offY = (canvas.height - vis.H * scale) / 2;
    ctx.fillStyle = "#0c1222"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, offX, offY);
    const accent = PALETTE[(sc.chapter || 0) % PALETTE.length];
    try { drawVisual(ctx, sc, { W: vis.W, H: vis.H, p: 1, t: 1, portrait, image: null, accent, showSource: false }); } catch (e) { /* 図解の描画に失敗しても一覧全体は壊さない */ }
  }, [sc.visual, sc.chapter, portrait]);
  return <canvas ref={ref} style={{ width: "100%", height: "100%", display: "block", borderRadius: 4 }} />;
}
// [ライブラリピッカーのポップアップ化] 56px丸グリッドだと見えにくいという指摘を受け、画面中央に大きく
// 表示するモーダルに変更。チェックボックスで複数選択→まとめて追加できる（単押しのその場追加はしない）。
function LibraryPickerModal({ images, imageEls, selectedIds, setSelectedIds, onConfirm, onClose }) {
  const toggle = (id) => setSelectedIds((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const list = images.slice().reverse();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="rounded-lg flex flex-col" style={{ background: C.panel, border: `1px solid ${C.border}`, width: "min(720px, 100%)", maxHeight: "85vh", boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}>
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid ${C.borderSoft}` }}>
          <div className="text-sm font-semibold" style={{ color: C.text }}>画像ライブラリから選ぶ</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.textMuted, cursor: "pointer" }}><X size={16} /></button>
        </div>
        <div className="px-4 py-2 text-[11px]" style={{ color: C.textDim }}>グラフ作成ページ（/chart-studio/）で保存したスクリーンショットなど。クリックで選択・解除し、複数選べます。</div>
        <div className="flex-1 overflow-y-auto px-4 py-2">
          {list.length ? (
            <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))" }}>
              {list.map((im) => {
                const checked = selectedIds.has(im.id);
                return (
                  <button key={im.id} onClick={() => toggle(im.id)} className="flex flex-col rounded overflow-hidden text-left" style={{ padding: 0, border: `2px solid ${checked ? C.teal : C.borderSoft}`, background: C.panel2, cursor: "pointer" }}>
                    <div className="relative" style={{ width: "100%", height: 120, background: C.panel }}>
                      {imageEls[im.id] && <img src={imageEls[im.id].src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
                      <div className="absolute top-1 right-1 rounded-full flex items-center justify-center" style={{ width: 18, height: 18, background: checked ? C.teal : "rgba(0,0,0,0.5)", border: `1px solid ${checked ? C.teal : "rgba(255,255,255,0.5)"}` }}>
                        {checked && <Check size={12} style={{ color: C.bg }} />}
                      </div>
                    </div>
                    <div className="px-1.5 py-1 text-[10px] leading-snug" style={{ color: C.textMuted, minHeight: 28 }}>{im.caption || im.name}</div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="text-[11px] py-6 text-center" style={{ color: C.textDim }}>まだ画像ライブラリに何もありません。グラフ作成ページでスクリーンショットを保存すると、ここに出てきます。</div>
          )}
        </div>
        <div className="flex items-center justify-between px-4 py-3" style={{ borderTop: `1px solid ${C.borderSoft}` }}>
          <span className="text-[11px]" style={{ color: C.textDim }}>{selectedIds.size}枚選択中</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="text-[11px] px-3 py-1.5 rounded" style={{ ...btn(), color: C.textMuted, borderColor: C.borderSoft }}>やめる</button>
            <button onClick={onConfirm} disabled={!selectedIds.size} className="text-[11px] px-3 py-1.5 rounded" style={{ ...btn("primary"), opacity: selectedIds.size ? 1 : 0.5 }}>選択した画像を追加（{selectedIds.size}件）</button>
          </div>
        </div>
      </div>
    </div>
  );
}
function Section({ title, right, children, collapsible = false, defaultOpen = true }) {
  // collapsible=true のときは見出しの▼/▶で本文を開閉する（既定の開閉はdefaultOpen）
  const [open, setOpen] = useState(defaultOpen);
  const shown = !collapsible || open;
  return (
    <div>
      <div className={`flex items-center justify-between ${shown ? "mb-1.5" : ""} gap-2`}>
        {collapsible ? (
          <button onClick={() => setOpen((v) => !v)} className="text-[11px] font-semibold flex items-center gap-1 text-left" style={{ color: C.textMuted, background: "none", border: "none", cursor: "pointer", padding: 0 }} aria-expanded={open}>
            <span style={{ display: "inline-block", width: 10 }}>{open ? "▼" : "▶"}</span>{title}
          </button>
        ) : (
          <div className="text-[11px] font-semibold" style={{ color: C.textMuted }}>{title}</div>
        )}
        {shown && right}
      </div>
      {shown && children}
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
  const [refs, setRefs] = useState(() => (saved0?.refs ?? []).filter((r) => r.kind !== "pdf" && r.kind !== "csv" && r.kind !== "image"));
  useEffect(() => {
    // PDF・CSV・スクショは容量が大きいため保存しない（テキストとURLの本文は保存して次回も使える）
    const keep = refs.filter((r) => r.kind !== "pdf" && r.kind !== "csv" && r.kind !== "image").map((r) => (r.kind === "url" ? { ...r, pdfBase64: undefined, status: r.pdfBase64 ? "pending" : r.status } : r));
    try { localStorage.setItem(INPUT_KEY, JSON.stringify({ topic, mode, audience, targetMinutes, extraInstruction, refs: keep })); } catch (e) { /* 容量超過などは無視 */ }
  }, [topic, mode, audience, targetMinutes, extraInstruction, refs]);
  const [refTextOpen, setRefTextOpen] = useState(false);
  const [refImgLibOpen, setRefImgLibOpen] = useState(false); // 参考情報「スクショを追加」の、画像ライブラリから選ぶポップアップの開閉
  const [libSelectedIds, setLibSelectedIds] = useState(() => new Set()); // ライブラリピッカー内での複数選択（ポップアップを開くたびにリセット）
  const [expandedRefId, setExpandedRefId] = useState(null); // 参考情報（テキスト）の本文をその場で確認する
  const [selectedRefIds, setSelectedRefIds] = useState(() => new Set()); // 参考情報のチェックボックス選択（まとめて削除・必須設定・サイトを開く用）
  const toggleRefSelected = (id) => setSelectedRefIds((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const [refTextTitle, setRefTextTitle] = useState("");
  const [refTextBody, setRefTextBody] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [inputOpen, setInputOpen] = useState(true);
  const [chaptersOpen, setChaptersOpen] = useState(false); // [Stage E-11] 章タイトルは既定で折りたたみ
  // [Stage E-6] 株式情報モード：データソースを選ぶ操作は廃止し、ダッシュボードが持つS&P500・SOXLのデータを
  // 常に背景で読み込んでおき（UIには出さない）、シナリオに応じてAIが必要な銘柄のキーだけを選んで使う
  // （lib/explainer/stockCatalog.tsのmergeStockCatalogsで1つに統合してgenInput()が渡す）。
  const [stockSnapshots, setStockSnapshots] = useState({ SP500: null, SOXL: null });
  // [Stage E-16] モックアップ25枚のシート（年初来ズーム・騰落日数・暴落の歴史・将来シナリオ等）は、ダッシュボードが書き出す
  // S&P500の日次終値（price-series:VOO）からこの画面で計算する（lib/sp500Sheets.ts）。
  const [sp500Points, setSp500Points] = useState(null);
  useEffect(() => {
    if (mode !== "stock" && mode !== "sp500") return;
    ["SP500", "SOXL"].forEach((src) => {
      storage.get(`stock-catalog:${src}`).then((res) => {
        if (res?.value) { try { setStockSnapshots((p) => ({ ...p, [src]: JSON.parse(res.value) })); } catch (e) { /* 読めなければそのまま無視（キーが使えないだけ） */ } }
      }).catch(() => {});
    });
    storage.get("price-series:VOO").then((res) => {
      if (res?.value) { try { const j = JSON.parse(res.value); if (Array.isArray(j?.points)) setSp500Points(j.points); } catch (e) { /* 読めなければシートの場面を省くだけ */ } }
    }).catch(() => {});
  }, [mode]);
  const sp500Sheets = useMemo(() => { try { return sp500Points?.length ? computeSp500Sheets(sp500Points) : null; } catch (e) { return null; } }, [sp500Points]);
  // シートはS&P500のデータなので、主に使う銘柄がS&P500のときだけ渡す
  const sheetInputFor = (snap) => (snap && /S&P500|SP500/.test(String(snap.instrumentLabel ?? "")) && sp500Sheets ? { sheets: sp500Sheets, points: sp500Points } : null);
  // 「株式情報」「S&P500」ボタンを押した瞬間、テーマ欄が空、または自動入力の既定文言のまま（別のボタンや
  // 前回保存分で入った日付入りの既定文言を含む）なら、その場で米国東部時間の「今日」入りの既定文言に入れ替える。
  // 自分で書き換えたテーマはそのまま残す（消去・書き換えは自由）。
  const AUTO_TOPIC_PATTERNS = [
    /^\d{4}年\d{1,2}月\d{1,2}日$/, // 株式情報の既定
    /^S&P500の最新の値動き（\d{4}年\d{1,2}月\d{1,2}日時点）$/, // S&P500の旧既定
    /^S&P500[ 　]最新分析（\d{4}\.\d{2}\.\d{2}）$/, // S&P500の既定
  ];
  const isAutoTopic = (t) => !t.trim() || AUTO_TOPIC_PATTERNS.some((re) => re.test(t.trim()));
  const defaultTopicFor = (k) => {
    const [y, m, dd] = easternStamp(new Date()).slice(0, 10).split("-");
    if (k === "stock") return `${y}年${Number(m)}月${Number(dd)}日`;
    if (k === "sp500") return `S&P500　最新分析（${y}.${m}.${dd}）`;
    return null;
  };
  const handleModeClick = (k) => {
    setMode(k);
    const def = defaultTopicFor(k);
    if (def && isAutoTopic(topic)) setTopic(def);
  };
  // 画面を開いた時点で前回のモード（株式情報／S&P500）が復元され、テーマ欄が既定文言のまま（別モードの既定や
  // 前日の日付を含む）なら、ボタンを押し直さなくても今日の日付入りの既定文言に揃える。
  useEffect(() => {
    const def = defaultTopicFor(mode);
    if (def && isAutoTopic(topic) && topic !== def) setTopic(def);
    // 初回表示時のみ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // AI画像の自動生成（Google Gemini / Imagen。費用が発生するため既定はオフ）
  const [imageGenEnabled, setImageGenEnabled] = useState(false);
  const [imageGenCount, setImageGenCount] = useState(3);
  // 画風・表現の自由記述リクエスト（例：「写真のようなリアルな画像で」）。場面ごとのimagePromptに追記して使う
  const [imageStyleHint, setImageStyleHint] = useState("写真のようなリアルな画像でニュースの途中の映像の画角にしてください。");
  const [reuseImagesEnabled, setReuseImagesEnabled] = useState(true); // 前回の台本で場面に付いていた画像を、作り直し時に再利用する（画像生成の課金を抑える）
  const withStyleHint = (prompt, hint) => {
    const h = (hint || "").trim();
    return h ? `${prompt}\n追加の指示（画風・表現について。ユーザー自身の希望）: ${h}` : prompt;
  };

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
  // [Stage E-6] 株式情報モード：ダッシュボードが持たない企業のCSV（Date/Close列、lib/csvPrice.tsと同じ形式）を
  // 参考情報として追加する（URL・PDF・スクショと同じ「追加」操作。複数社分を追加でき、置き換えない）。
  // 企業名はファイル名から取る（必要なら別のファイル名で読み込み直せば変更できる）。
  const addStockCsv = (files) => {
    for (const f of Array.from(files || [])) {
      if (!(/\.csv$/i.test(f.name) || f.type === "text/csv")) { alert(`CSVファイルではありません：${f.name}`); continue; }
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = String(ev.target.result);
        const rows = parseStooqCSV(text);
        if (!rows.length) { alert(`Date/Close列が見つかりませんでした：${f.name}`); return; }
        setRefs((p) => [...p, { id: newRefId(), kind: "csv", title: f.name.replace(/\.csv$/i, ""), text, sizeBytes: f.size }]);
      };
      reader.onerror = () => alert(`CSVを読み込めませんでした：${f.name}`);
      reader.readAsText(f);
    }
  };
  const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
  // [Stage E-3] ニュース・株式情報どちらのモードでも使えるスクリーンショット参照の追加
  const addScreenshot = async (file) => {
    if (!/^image\//.test(file.type)) { alert(`画像ファイルではありません：${file.name}`); return; }
    if (file.size > MAX_IMAGE_BYTES) { alert(`画像が大きすぎます（8MBまで）：${file.name}`); return; }
    const base64 = await fileToBase64(file);
    setRefs((p) => [...p, { id: newRefId(), kind: "image", title: file.name, base64, mediaType: file.type, sizeBytes: file.size }]);
  };
  // グラフ作成ページ（/chart-studio/）で保存したスクリーンショット等、画像ライブラリ（IndexedDB）に
  // 既にある画像を、ファイル選択なしでそのまま参考情報として追加する（listImages()はIndexedDBを都度読むため、
  // 直前に別タブで保存したものもrefreshImages()を挟めばすぐに反映される）。
  // [複数選択対応] 一度に複数枚まとめて追加できる。titleにはグラフ作成ページが自動で付けたcaption（どの銘柄・
  // どんなグラフかの説明）があればそれを使う（無ければファイル名）。これが参考情報としてAIに渡るテキストになり、
  // 「スクショの情報を把握できるか」という問いへの回答＝画像に説明を持たせて文章として一緒に渡す、という仕組み。
  const addScreenshotsFromLibrary = async (ims) => {
    if (!ims.length) return;
    const tooBig = [];
    const added = [];
    for (const im of ims) {
      if (im.blob.size > MAX_IMAGE_BYTES) { tooBig.push(im.name); continue; }
      try {
        const base64 = await fileToBase64(im.blob);
        added.push({ id: newRefId(), kind: "image", title: im.caption || im.name, base64, mediaType: im.blob.type || "image/png", sizeBytes: im.blob.size });
      } catch (e) { tooBig.push(im.name); }
    }
    if (added.length) setRefs((p) => [...p, ...added]);
    if (tooBig.length) alert(`以下の画像は追加できませんでした（8MBまで、または読み込みエラー）：${tooBig.join("、")}`);
    setRefImgLibOpen(false);
    setLibSelectedIds(new Set());
  };
  // テーマから、Claude（Web検索）とGemini（Google検索）にまとめて参考情報を探させる。
  // 何度でも押せる（見つかったURLの中身が合わなければ削除して、もう一度押せば別の候補に入れ替わる）。
  const [researchBusy, setResearchBusy] = useState(false);
  const [researchError, setResearchError] = useState("");
  // [Stage E-8] 検索内容をテーマ本文と分けて指定したい場合の、AI検索専用プロンプト（任意）。
  // 空欄ならテーマをそのまま検索クエリとして使う（従来通りの挙動）。
  const [researchPrompt, setResearchPrompt] = useState("");
  const researchAbortRef = useRef(null);
  const runResearch = async () => {
    const t = topic.trim(), fp = researchPrompt.trim();
    // テーマが入力されていれば常に主軸とし、検索プロンプトは「テーマに加えてどこに注目するか」の
    // 観点として別送りする（サーバー側でテーマと組み合わせて検索するよう明示的に指示する。
    // クライアント側で1本の文字列に結合すると、検索プロンプトの語句だけが単独で検索され、
    // テーマと無関係な結果が混ざることがあったため）。テーマが空なら検索プロンプトをテーマ扱いにする。
    const reqTopic = t || fp, reqFocus = t ? fp : "";
    if (!reqTopic) { setResearchError("先にテーマ（ニュースやキーワード）、または検索プロンプトを入力してください。"); return; }
    setResearchBusy(true); setResearchError("");
    const ac = new AbortController(); researchAbortRef.current = ac;
    try {
      const r = await researchTopic(reqTopic, reqFocus, ac.signal);
      const existingUrls = new Set(refs.filter((x) => x.kind === "url").map((x) => x.url));
      const combined = [];
      [...r.claude.urls, ...r.gemini.urls].forEach((u) => {
        if (combined.length >= 5) return;
        if (existingUrls.has(u.url) || combined.some((x) => x.url === u.url)) return;
        combined.push(u);
      });
      const newUrlRefs = combined.map((u) => ({ id: newRefId(), kind: "url", url: u.url, title: u.title || u.url, text: "", status: "pending" }));
      const newTextRefs = [];
      if (r.gemini.text.trim()) newTextRefs.push({ id: newRefId(), kind: "text", title: "Gemini", text: r.gemini.text.trim() });
      if (r.claude.text.trim()) newTextRefs.push({ id: newRefId(), kind: "text", title: "Claude", text: r.claude.text.trim() });
      if (newUrlRefs.length || newTextRefs.length) setRefs((p) => [...p, ...newUrlRefs, ...newTextRefs]);
      newUrlRefs.forEach((it) => loadUrl(it.id, it.url));
      const errs = [r.claude.error, r.gemini.error].filter(Boolean);
      if (errs.length) setResearchError(errs.join(" / "));
      else if (!newUrlRefs.length && !newTextRefs.length) setResearchError("新しい参考情報が見つかりませんでした（すでに追加済みかもしれません）。もう一度お試しください。");
    } catch (e) {
      setResearchError(e instanceof AiClientError ? e.message : e?.message || String(e));
    } finally {
      setResearchBusy(false); researchAbortRef.current = null;
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
  // Stage G-2：右下の進行状況パネル用の経過時間。genBusyがtrueになった瞬間から1秒ごとに数える。
  const genStartRef = useRef(0);
  const [genElapsedSec, setGenElapsedSec] = useState(0);
  useEffect(() => {
    if (!genBusy) { setGenElapsedSec(0); return; }
    genStartRef.current = Date.now();
    setGenElapsedSec(0);
    const t = setInterval(() => setGenElapsedSec(Math.floor((Date.now() - genStartRef.current) / 1000)), 1000);
    return () => clearInterval(t);
  }, [genBusy]);
  const [genError, setGenError] = useState("");
  const abortRef = useRef(null);
  // Stage F-4：平日朝の自動実行（scripts/auto-run.mjsが開く ?autorun=1&mode=preview|video&run=<id>）用。
  // autorunRefが非nullの間だけ、handleExport()は保存先フォルダの選択ダイアログを使わずtts-server経由で
  // サーバー側へ直接保存する。lastGenErrorRef／lastExportErrorRefは、handleGenerate／handleExportが
  // 内部でcatchしてalertするだけ（例外を再throwしない）既存の作りのまま、自動実行側が成否を判定できるように
  // 追加した「最後のエラー」の記録（手動操作時の挙動は変えない）。
  const autorunRef = useRef(null);
  const lastGenErrorRef = useRef(null);
  const lastExportErrorRef = useRef(null);
  // [Stage E-6] 「株式情報」モードのときだけ、実データのカタログ（StockCatalog）を生成入力に含める。
  // ダッシュボードのS&P500・SOXL（背景で読み込み済み）と、参考情報に追加したCSV各社分をすべて統合し、
  // シナリオに応じてAIが必要な銘柄のキーだけを選べるようにする（データソースを選ばせる操作は廃止）。
  // これにより台本生成側（lib/explainer/aiScript.ts）がdataKey/seriesKeyで実数を解決できる（AIの創作値を禁止する仕組み）。
  // [Stage E-9] 図解の内容パネルの年比較グラフ（yearCompare）用の系列選択UIからも同じ統合カタログを参照したいので、
  // genInput()内だけのローカル変数ではなくuseMemoに切り出す（AI生成・手動選択で同じデータソースを共用する）。
  const stockOverlayCatalog = useMemo(() => {
    const catalogs = [stockSnapshots.SP500 && buildStockCatalogFromSnapshot(stockSnapshots.SP500), stockSnapshots.SOXL && buildStockCatalogFromSnapshot(stockSnapshots.SOXL)];
    for (const r of refs) {
      if (r.kind !== "csv") continue;
      const rows = parseStooqCSV(r.text);
      if (rows.length) catalogs.push(buildStockCatalogFromCsv(r.title, rows));
    }
    return mergeStockCatalogs(catalogs);
  }, [stockSnapshots, refs]);
  // [Stage G-?]「S&P500」モード専用：SOXLや参考CSVは混ぜず、ダッシュボードのS&P500データだけで
  // 常に最新の情報を基に生成できるようにする（テーマ・参考情報の手入力を不要にする）。
  const sp500OnlyCatalog = useMemo(() => mergeStockCatalogs([stockSnapshots.SP500 && buildStockCatalogFromSnapshot(stockSnapshots.SP500)]), [stockSnapshots]);
  const genInput = (minutes = targetMinutes) => {
    let stockCatalog;
    if (mode === "stock" && (Object.keys(stockOverlayCatalog.scalars).length || Object.keys(stockOverlayCatalog.series).length)) {
      stockCatalog = stockOverlayCatalog;
    } else if (mode === "sp500" && (Object.keys(sp500OnlyCatalog.scalars).length || Object.keys(sp500OnlyCatalog.series).length)) {
      stockCatalog = sp500OnlyCatalog;
    }
    // [Stage E-15] 株式情報・S&P500モード：保有データの期間（「数十年」等の曖昧な表現の禁止に使う）と、
    // アプリが本編に挿入する実データの固定章（AIの場面数の予算から差し引く）をAIに伝える。
    let dataExtra = {};
    if (mode === "stock" || mode === "sp500") {
      const snap = primaryStockSnapshot();
      const label = snap?.instrumentLabel ?? "S&P500";
      const fixed = buildFixedDataChapters(snap, label, sheetInputFor(snap));
      const period = dataPeriodOf(snap);
      dataExtra = {
        dataPeriodNote: dataPeriodNoteOf(snap, label) ?? undefined,
        dataYears: period?.years,
        reservedScenes: fixed.reduce((a, c) => a + c.scenes.length + 1, 0),
        ...(mode === "sp500" && fixed.length ? { fixedBodyNote: fixedChaptersNote(fixed) } : {}),
      };
    }
    return { topic: topic.trim(), mode, audience, targetMinutes: minutes, extraInstruction, refBlocks: referenceBlocks(refs), today: todayStr(), speechRate: rate, imageTarget: imageGenEnabled ? imageGenCount : 0, stockCatalog, requiredRefNotes: requiredRefNotes(refs), learnedEdits: (learned.general[mode] || []).map((x) => ({ before: x.before, after: x.after })), ...dataExtra };
  };
  // 株式情報モードはS&P500を優先（無ければSOXL）、S&P500モードはS&P500のみ
  function primaryStockSnapshot() { return mode === "sp500" ? stockSnapshots.SP500 : (stockSnapshots.SP500 ?? stockSnapshots.SOXL); }
  const errMsg = (e) => (e instanceof AiClientError ? e.message : e?.message || String(e));
  // visual.kind=image の場面（AIがimagePromptを用意している場面）のうち、先頭から指定枚数だけAIで画像を生成して
  // 自動で割り当てる。GEMINI_API_KEY未設定・生成失敗は場面単位でスキップし、台本自体は壊さない（呼び出し側でまとめて案内する）。
  const genImagesForScenes = async (list, count, signal, onStep, styleHint = "") => {
    const targets = list.map((s, i) => ({ i, s })).filter((x) => x.s.visual.kind === "image" && x.s.visual.imagePrompt && !x.s.imageId).slice(0, Math.max(0, count));
    if (!targets.length) return { scenes: list, failed: 0, noKey: false };
    const out = list.slice();
    let failed = 0, noKey = false;
    for (let k = 0; k < targets.length; k++) {
      const { i, s } = targets[k];
      onStep?.(k + 1, targets.length);
      try {
        const blob = await generateImage(withStyleHint(s.visual.imagePrompt, styleHint), "16:9", signal);
        const file = new File([blob], `ai-${s.id}.png`, { type: blob.type || "image/png" });
        const im = await saveImage(file);
        out[i] = { ...out[i], imageId: im.id };
      } catch (e) {
        if (e?.code === "ABORTED") throw e;
        if (e?.code === "NO_API_KEY") noKey = true;
        failed += 1;
      }
    }
    return { scenes: out, failed, noKey };
  };
  const handleGenerate = async (minutesOverride) => {
    const minutes = typeof minutesOverride === "number" ? minutesOverride : targetMinutes;
    if (!topic.trim()) { const m = "テーマ（ニュースやキーワード）を入力してください。"; setGenError(m); lastGenErrorRef.current = m; return; }
    if (refs.some((r) => r.kind === "url" && r.status === "pending")) { const m = "URLの読み込みが終わるまでお待ちください。"; setGenError(m); lastGenErrorRef.current = m; return; }
    if (project && !confirm(`いまの台本を、${minutes}分以内・声の速さ${rate.toFixed(2)}xに合わせて新しく作り直します。よろしいですか？（現在の台本は「台本を保存」で残せます）`)) return;
    if (minutes !== targetMinutes) setTargetMinutes(minutes);
    setGenBusy(true); setGenError(""); lastGenErrorRef.current = null;
    const ac = new AbortController(); abortRef.current = ac;
    // 作り直し前の台本に付いていた画像を、場面の順番で引き継ぐための候補（課金を避けるため）
    const prevImagePool = reuseImagesEnabled ? (project?.longScenes || []).filter((s) => s.imageId).map((s) => s.imageId) : [];
    try {
      const inp = genInput(minutes);
      let p = await generateProject(inp, setGenProgress, ac.signal, true, sourcesInVideo);
      // 参考資料の文章とほぼ同じ箇所は、自動で言い換える（長尺・ショート）
      const L = await paraphraseScenes(p.longScenes, inp, p.videoTitle, "long", ac.signal, (k, n) => setGenProgress({ step: `参考資料と同じ言い回しを言い換え中…（長尺 ${k}/${n}）`, done: 1, total: 1 }));
      const S = await paraphraseScenes(p.shortScenes, inp, p.videoTitle, "short", ac.signal, (k, n) => setGenProgress({ step: `参考資料と同じ言い回しを言い換え中…（ショート ${k}/${n}）`, done: 1, total: 1 }));
      let longScenes = L.scenes;
      let imgFailed = 0, imgNoKey = false, reusedCount = 0;
      if (prevImagePool.length) {
        let poolIdx = 0;
        longScenes = longScenes.map((s) => {
          if (s.visual.kind === "image" && s.visual.imagePrompt && poolIdx < prevImagePool.length) {
            return { ...s, imageId: prevImagePool[poolIdx++] };
          }
          return s;
        });
        reusedCount = poolIdx;
      }
      if (imageGenEnabled && imageGenCount > 0) {
        const r = await genImagesForScenes(longScenes, imageGenCount, ac.signal, (k, n) => setGenProgress({ step: `AIで画像を生成中…（${k}/${n}）`, done: 1, total: 1 }), imageStyleHint);
        longScenes = r.scenes; imgFailed = r.failed; imgNoKey = r.noKey;
        await refreshImages(); // 保存した画像をプレビュー/書き出し側の一覧に反映する（手動の「画像を追加」と同じ扱いにする）
      } else if (reusedCount > 0) {
        await refreshImages(); // 新規生成が無くても、再利用した画像をプレビュー側の一覧に反映する
      }
      // [Stage G-3→E-15] 「株式情報」「S&P500」モードでは、ダッシュボードの実データから作る固定場面（前提条件・DD速度センサー・
      // ローリングリターン・最高値更新ペース・類似局面サーチ等。AIには生成させない）を、内容ごとの章にまとめて
      // AIの導入章の直後に挿入する（以前は導入章＝「つかみ」の章の先頭にまとめて差し込んでいた）。章の扉・章番号は振り直す。
      // 新しい分析をダッシュボードに足して動画にも反映したいときは、DDDashboard.jsx側でstock-catalog:*に書き出し→
      // lib/explainer/に固定場面ビルダーを足し→lib/explainer/dataChapters.tsのbuildFixedDataChaptersに追加する。
      if (mode === "stock" || mode === "sp500") {
        const snap = primaryStockSnapshot();
        const fixed = buildFixedDataChapters(snap, snap?.instrumentLabel ?? "S&P500", sheetInputFor(snap));
        if (fixed.length) {
          const merged = mergeFixedChapters(p.chapters, longScenes, fixed);
          longScenes = assembleLong(merged.chapters, merged.perChapter, p.sources, true, sourcesInVideo);
          p = { ...p, chapters: merged.chapters };
        }
        // [Stage E-16] タイトル場面の背景に、全期間の推移をうっすら描く（モックアップ1枚目）
        const ti = longScenes.findIndex((sc) => sc.visual.kind === "title");
        // S&P500モードは見出しをテンプレ（「S&P500最新分析」／「過去◯年間のチャートから今後を検証・分析」）に固定する
        if (ti >= 0 && sheetInputFor(snap)) longScenes = longScenes.map((sc, i) => (i === ti ? decorateTitleScene(sc, sp500Sheets.title, mode === "sp500") : sc));
      }
      // [Stage E-17] 自動生成のナレーションを「直す前」として残し、固定場面には以前の直し方を当てはめる
      longScenes = longScenes.map((sc) => ({ ...sc, genNarration: sc.narration }));
      const toApply = longScenes.map((sc, i) => ({ sc, i, ed: fixedKeyOf(sc) ? learned.fixed[fixedKeyOf(sc)] : null })).filter((x) => x.ed);
      if (toApply.length) {
        setGenProgress({ step: `記憶した直しを反映中…（${toApply.length}場面）`, done: 1, total: 1 });
        const results = await Promise.all(toApply.map(async ({ sc, ed }) => {
          if (sc.narration.trim() === ed.before.trim() && ed.afterReading) return { narration: ed.after, reading: ed.afterReading };
          try { return await applyLearnedEdit(inp, { before: ed.before, after: ed.after }, sc.narration, ac.signal); } catch (e) { if (e?.code === "ABORTED") throw e; return null; }
        }));
        toApply.forEach(({ i }, k) => { if (results[k]) longScenes[i] = { ...longScenes[i], narration: results[k].narration, reading: results[k].reading, readingStale: false }; });
      }
      // ラベル（kicker）は、選んだ長尺の長さから自動で入れる（例：5分で解説）。生成後も自由に書き換えられる
      p = { ...p, longScenes, shortScenes: S.scenes, kicker: autoKickerFor(minutes) };
      setProject(p); setFormat("long"); setInputOpen(false); setSeekPos(0);
      if (imgNoKey) alert("画像の自動生成に失敗しました：tts-server/.env に GEMINI_API_KEY が設定されていません（tts-server/.env.example を参考に設定してください）。台本自体は生成できています。あとから各場面の「画像を追加」→「AIで生成」からやり直せます。");
      else if (imgFailed > 0) alert(`${imgFailed}件の場面で画像の自動生成に失敗しました（台本は生成できています）。あとから各場面の「画像を追加」→「AIで生成」からやり直せます。`);
    } catch (e) { const msg = errMsg(e); setGenError(msg); lastGenErrorRef.current = msg; }
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

  // 全場面への一括AI修正指示（例：すべてのスライドのドル表記の後に円換算を加える、など）。
  // paraphraseScenesと違い対象を絞り込まず、全場面を1つずつ順番にrewriteScene()へ同じ指示で投げ、
  // スライド（図解・テロップ）とナレーションの両方を書き直す。当てはまらない場面はAI自身に元のまま
  // 返させる（指示文の末尾に注記を添える）。1場面ずつ順番に呼ぶため時間がかかるが、途中でキャンセルでき、
  // それまでに完了した場面はキャンセル後も反映される。
  const [bulkAiOpen, setBulkAiOpen] = useState(false);
  const [bulkAiText, setBulkAiText] = useState("");
  const [bulkAiBusy, setBulkAiBusy] = useState(""); // ""＝停止中、それ以外は進捗文言
  const [bulkAiError, setBulkAiError] = useState("");
  const bulkAiAbortRef = useRef(null);
  const bulkRewriteAllScenes = async (list, inp, title, fmt, instruction, signal, onStep) => {
    const out = list.slice();
    let failCount = 0;
    let cancelled = false;
    for (let i = 0; i < out.length; i++) {
      if (signal?.aborted) { cancelled = true; break; }
      onStep?.(i + 1, out.length);
      try {
        const neighbors = [out[i - 1], out[i + 1]].filter(Boolean).map((x) => x.narration);
        const instr = `${instruction}\n（この指示は動画内の全場面に同じ基準で一括適用しています。当てはまらない場面はそのままで構いません。）`;
        out[i] = await rewriteScene(inp, title, instr, out[i], neighbors, fmt, signal);
      } catch (e) {
        if (e?.code === "ABORTED") { cancelled = true; break; }
        failCount += 1; // 1場面失敗しても続ける
      }
    }
    return { scenes: out, failCount, cancelled };
  };
  const runBulkAi = async () => {
    const instr = bulkAiText.trim();
    if (!instr || !project) return;
    const ac = new AbortController(); bulkAiAbortRef.current = ac;
    setBulkAiBusy("準備中…"); setBulkAiError("");
    try {
      const { scenes: out, failCount, cancelled } = await bulkRewriteAllScenes(scenes, genInput(), project.videoTitle, format, instr, ac.signal, (k, n) => setBulkAiBusy(`修正中…（${k}/${n}）`));
      setScenes(out);
      setBulkAiOpen(false); setBulkAiText("");
      if (cancelled) setBulkAiError("キャンセルしました（それまでの場面は反映済みです）。");
      else if (failCount > 0) setBulkAiError(`${failCount}件の場面で修正に失敗しました（他の場面は適用済みです）。`);
    } catch (e) { setBulkAiError(errMsg(e)); }
    finally { setBulkAiBusy(""); bulkAiAbortRef.current = null; }
  };
  const cancelBulkAi = () => bulkAiAbortRef.current?.abort();

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
  // [Stage E-17] ナレーションの直しの記憶と、読み上げ文の自動更新
  const [learned, setLearned] = useState(() => (typeof window === "undefined" ? { fixed: {}, general: {} } : loadLearned()));
  const editBaseRef = useRef({}); // 場面id → 直し始める前の { narration, reading }
  const [readingBusyIds, setReadingBusyIds] = useState(() => new Set());
  const learnedOf = (sc) => (fixedKeyOf(sc) ? learned.fixed[fixedKeyOf(sc)] : (learned.general[mode] || []).find((x) => x.sceneId === sc.id)) || null;
  const rememberEdit = (sc, after, afterReading, fallbackBefore = null) => {
    const before = sc.genNarration ?? fallbackBefore;
    if (!before) return;
    const fk = fixedKeyOf(sc);
    setLearned((prev) => {
      const next = { fixed: { ...prev.fixed }, general: { ...prev.general } };
      if (fk) {
        if (after.trim() === before.trim()) delete next.fixed[fk];
        else next.fixed[fk] = { before, after, afterReading, at: Date.now() };
      } else {
        const list = (next.general[mode] || []).filter((x) => x.sceneId !== sc.id);
        if (after.trim() !== before.trim()) list.push({ sceneId: sc.id, title: sc.title, before, after, at: Date.now() });
        next.general[mode] = list.slice(-20);
      }
      saveLearned(next);
      return next;
    });
  };
  const forgetEdit = (sc) => setLearned((prev) => {
    const next = { fixed: { ...prev.fixed }, general: { ...prev.general } };
    if (fixedKeyOf(sc)) delete next.fixed[fixedKeyOf(sc)];
    else next.general[mode] = (next.general[mode] || []).filter((x) => x.sceneId !== sc.id);
    saveLearned(next);
    return next;
  });
  // ナレーションの入力欄から離れたとき：直した部分だけ読み上げ文を書き換え（AI）、直しを記憶する
  const handleNarrBlur = async (sceneId) => {
    const base = editBaseRef.current[sceneId];
    delete editBaseRef.current[sceneId];
    const sc = scenes.find((x) => x.id === sceneId);
    if (!base || !sc || base.narration === sc.narration) return;
    const newNarr = sc.narration;
    setReadingBusyIds((prev) => new Set(prev).add(sceneId));
    let newReading = null;
    try {
      newReading = await updateReadingForEdit(base.narration, base.reading || "", newNarr);
      // 待っているあいだに、さらに書き換えられていたら反映しない（次の入力欄から離れたときに改めて更新する）
      setScenes((list) => list.map((x) => (x.id === sceneId && x.narration === newNarr ? { ...x, reading: newReading, readingStale: false } : x)));
    } catch (e) { /* 失敗時は従来どおり「要確認」のまま（手で直すか「整える」を使う） */ }
    finally { setReadingBusyIds((prev) => { const n = new Set(prev); n.delete(sceneId); return n; }); }
    rememberEdit(sc, newNarr, newReading, base.narration);
  };
  // 場面ごとの「ナレーション変更」：スライド（図解）は変えず、ナレーションだけをAIで変える
  const [narrAiOpenId, setNarrAiOpenId] = useState(null);
  const [narrAiText, setNarrAiText] = useState("");
  const [narrAiBusy, setNarrAiBusy] = useState(false);
  const [narrAiError, setNarrAiError] = useState("");
  const runNarrationAi = async (sceneId) => {
    if (!project) return;
    setNarrAiBusy(true); setNarrAiError("");
    try {
      const idx = scenes.findIndex((s) => s.id === sceneId);
      const cur = scenes[idx];
      if (!cur) throw new Error("場面が見つかりません。");
      const neighbors = [scenes[idx - 1], scenes[idx + 1]].filter(Boolean).map((s) => s.narration);
      const { narration, reading } = await rewriteNarration(genInput(), project.videoTitle, narrAiText.trim(), cur, neighbors, format);
      patchScene(sceneId, { narration, reading, readingStale: false });
      rememberEdit(cur, narration, reading, cur.narration); // [Stage E-17] AIで直した結果も、次回以降の台本に反映する
      setNarrAiOpenId(null); setNarrAiText("");
    } catch (e) { setNarrAiError(errMsg(e)); }
    finally { setNarrAiBusy(false); }
  };
  const [editVisualId, setEditVisualId] = useState(null);
  const [readingOpenId, setReadingOpenId] = useState(null);

  // ---------------- 画像（権利を確認したものだけ・場面ごと） ----------------
  const [images, setImages] = useState([]);
  const refreshImages = () => listImages().then(setImages).catch(() => {});
  useEffect(() => { refreshImages(); }, []);
  // グラフ作成ページ（/chart-studio/）など、別タブ・別ウィンドウで画像ライブラリに保存してからこのタブに
  // 戻ってきたときに一覧が古いままにならないよう、このタブが前面に戻るたびに読み直す
  // （IndexedDBへの書き込みは他タブに自動通知されないため、マウント時の1回読み込みだけでは追従しない）。
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") refreshImages(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => { document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("focus", onVisible); };
  }, []);
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
    // [Stage E-11] 画像を添付したら、まず変更後のスライドをプレビューに表示する
    const idx = scenes.findIndex((s) => s.id === sceneId);
    if (idx >= 0) previewSceneAt(idx);
  };
  const detachImage = async (sc) => {
    const id = sc.imageId;
    patchScene(sc.id, { imageId: null });
    const usedElsewhere = project && [...project.longScenes, ...project.shortScenes].some((s) => s.imageId === id && s.id !== sc.id);
    if (id && !usedElsewhere) { await deleteImage(id).catch(() => {}); refreshImages(); }
    const idx = scenes.findIndex((s) => s.id === sc.id);
    if (idx >= 0) previewSceneAt(idx);
  };
  // [ライブラリから選ぶ] 既に画像ライブラリ（listImages）にある画像を、新規アップロードせずそのまま場面へ添付する。
  // グラフ作成ページ（/chart-studio/）のスクリーンショットや、他の場面で使った画像・以前の手動アップロード／AI生成画像を
  // 選べるようにするためのもの（attachImageと違い、saveImageは呼ばない＝ライブラリには何も追加しない）。
  const attachExistingImage = (sceneId, imageId) => {
    setScenes((list) => list.map((s) => (s.id === sceneId ? { ...s, imageId, visual: { ...s.visual, kind: "image" } } : s)));
    setRightsPendingId(null);
    const idx = scenes.findIndex((s) => s.id === sceneId);
    if (idx >= 0) previewSceneAt(idx);
  };
  // 場面ごとに「AIで生成」：既存のimagePrompt（台本生成時にAIが用意した英語のプロンプト案）で1枚生成し、そのまま添付する
  const [imgGenBusyId, setImgGenBusyId] = useState(null);
  const [imgGenError, setImgGenError] = useState("");
  const genSceneImage = async (sc) => {
    if (!sc.visual.imagePrompt) return;
    setImgGenBusyId(sc.id); setImgGenError("");
    try {
      const blob = await generateImage(withStyleHint(sc.visual.imagePrompt, imageStyleHint), format === "short" ? "9:16" : "16:9");
      const file = new File([blob], `ai-${sc.id}-${Date.now()}.png`, { type: blob.type || "image/png" });
      await attachImage(sc.id, file);
    } catch (e) { setImgGenError(errMsg(e)); }
    finally { setImgGenBusyId(null); }
  };

  // ---------------- アバター（長尺動画作成と共通の保存データ） ----------------
  const [avatars, setAvatars] = useState([]);
  // [共通化] 長尺動画作成（S&P500／SOXL）と同じ保存キーを使い、どちらで選んだ人物も引き継ぐ。
  // 旧キー（explainer-avatar-v1）に既存の選択があれば、初回だけそれを引き継ぐ（今までの選択を失わないため）
  const [avatarId, setAvatarId] = useState(() => { try { return localStorage.getItem("video-avatar-v1") || localStorage.getItem("explainer-avatar-v1") || null; } catch (e) { return null; } });
  useEffect(() => { try { if (avatarId) localStorage.setItem("video-avatar-v1", avatarId); } catch (e) { /* ignore */ } }, [avatarId]);
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
  // Stage F-3：平日朝の自動実行は専用の別Chromeプロファイルを使うため、この画面の声・アバター・
  // BGM・背景などの設定をそちらへ引き継ぐ（投資shortsの「設定の引き継ぎ」と同じ考え方）。
  const [profileSnapshotBusy, setProfileSnapshotBusy] = useState(false);
  const [profileSnapshotNote, setProfileSnapshotNote] = useState("");
  // Stage F-5：配信設定パネル（既定は折りたたみ。頻繁に開くものではないため）
  const [autoScheduleOpen, setAutoScheduleOpen] = useState(false);
  const handleExportProfileForAutorun = async () => {
    setProfileSnapshotBusy(true); setProfileSnapshotNote("");
    try {
      const json = await exportVideoProfile();
      const r = await fetch(`${getTtsBaseUrl()}/api/profile-snapshot`, { method: "POST", headers: { "Content-Type": "application/json" }, body: json });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setProfileSnapshotNote(`引き継ぎました（${((j.bytes ?? json.length) / 1048576).toFixed(1)}MB）。次回の自動実行から反映されます。`);
    } catch (e) {
      setProfileSnapshotNote(`⚠ 引き継ぎに失敗しました：${e?.message ?? e}（ローカルサーバーが起動しているかご確認ください）`);
    } finally {
      setProfileSnapshotBusy(false);
    }
  };
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
  // [共通化] 長尺動画作成と同じ保存キーを使い、どちらで選んだBGMも引き継ぐ。
  // 旧キー（explainer-bgm-v1）に既存の選択があれば、初回だけそれを引き継ぐ
  const [activeBgmId, setActiveBgmId] = useState(() => { try { return localStorage.getItem("video-bgm-v1") || localStorage.getItem("explainer-bgm-v1") || ""; } catch (e) { return ""; } });
  useEffect(() => { try { localStorage.setItem("video-bgm-v1", activeBgmId); } catch (e) { /* ignore */ } }, [activeBgmId]);
  const [bgmVolume, setBgmVolume] = useState(() => sliderInitValue("bgmVolume", 25));
  const refreshBgms = () => listBgms(true).then(setBgms).catch(() => {});
  useEffect(() => { refreshBgms(); }, []);
  const activeBgm = bgms.find((b) => b.id === activeBgmId) || null;
  const [bgmUrl, setBgmUrl] = useState(null);
  useEffect(() => { if (!activeBgm) { setBgmUrl(null); return; } const u = URL.createObjectURL(activeBgm.blob); setBgmUrl(u); return () => URL.revokeObjectURL(u); }, [activeBgm]);
  const handleBgmUpload = async (e) => { const f = e.target.files?.[0]; if (!f) return; try { const s = await saveBgm(f, true); await refreshBgms(); setActiveBgmId(s.id); } catch (err) { alert("BGMの保存に失敗しました"); } };
  const handleBgmDelete = async (id) => { await deleteBgm(id, true); if (activeBgmId === id) setActiveBgmId(""); refreshBgms(); };

  const [backgrounds, setBackgrounds] = useState([]);
  // [共通化] 長尺動画作成と同じ保存キーを使い、どちらで選んだ背景も引き継ぐ
  const [activeBackgroundId, setActiveBackgroundId] = useState(() => { try { return localStorage.getItem("video-background-v1") || ""; } catch (e) { return ""; } });
  useEffect(() => { try { localStorage.setItem("video-background-v1", activeBackgroundId); } catch (e) { /* ignore */ } }, [activeBackgroundId]);
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
  const scenesRef = useRef([]);
  useEffect(() => { scenesRef.current = scenes; }, [scenes]);
  const sceneRefs = useRef([]);
  const listRef = useRef(null);
  // 台本・形式が変わったら、実測した長さは使えないので概算に戻す
  useEffect(() => { setTotalSec(0); setSceneDurs([]); setNarrMeasure(null); }, [scenes, format]);
  // 速さを変えたら、実測した全体の長さは使えないので見込みに戻す（ナレーションの実測値は残して比で計算する）
  useEffect(() => { setTotalSec(0); setSceneDurs([]); }, [rate]);
  useEffect(() => {
    const el = sceneRefs.current[currentSceneIdx];
    if (!el) return;
    // 場面一覧（listRef）だけでなく、ページ全体のスクロールも必要な分だけ連動させ、
    // 再生中は常にこのカードが画面に見えるようにする（block:"nearest"なので、既に見えているときは動かさない）
    el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [currentSceneIdx]);
  // 読み上げ中の場面の、どの文字まで読み終えたか（ナレーション枠のハイライト用）。音声の長さは prepareAudio で確定する
  const narrDursRef = useRef([]);
  const [readCharIdx, setReadCharIdx] = useState(0);
  const updateSceneProgress = (progress) => {
    const r = rendererRef.current; if (!r) return;
    const idx = r.getSceneIndexAt(progress);
    setCurrentSceneIdx(idx);
    const localT = r.getSceneLocalTimeAt(progress);
    const dur = narrDursRef.current[idx] || 0;
    const len = scenesRef.current[idx]?.narration?.length ?? 0;
    setReadCharIdx(dur > 0 ? Math.round(Math.min(1, Math.max(0, (localT - 0.3) / dur)) * len) : 0);
  };

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
    narrDursRef.current = bufs.map((b) => (b ? b.duration : 0));
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
    seekPosRef.current = target; setSeekPos(target); r.draw(target); updateSceneProgress(target);
  };
  // [Stage E-10] 場面カードの「再生」：その場面の最初から、最後の場面まで通しで再生する
  // （previewSceneAtは場面の終盤に静止した状態で止める用途のため、別関数として用意する）。
  const playFromScene = async (idx) => {
    const r = rendererRef.current; if (!r || idx < 0) return;
    if (isPlayingRef.current) handlePause();
    const durs = sceneDurs.length === scenes.length ? sceneDurs : estDurs;
    const total = durs.reduce((a, b) => a + b, 0) || 1;
    const before = durs.slice(0, idx).reduce((a, b) => a + b, 0);
    const target = Math.min(1, before / total);
    seekPosRef.current = target; setSeekPos(target); r.draw(target); updateSceneProgress(target);
    await handlePlay();
  };
  const download = (blob, name) => { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000); };
  const stamp = () => new Date().toISOString().slice(0, 10).replace(/-/g, "");
  // ---- 書き出しの名前 ----
  // 動画：YouTubeに投稿するタイトル（アップロード時にそのまま動画名になる）／サムネ・概要欄テキスト・フォルダ：サムネの文字
  const exportNames = () => {
    const y = project.youtube;
    const thumb = safeFileName(y.thumbnailText || project.videoTitle);
    const isShort = format === "short";
    // ファイル名・動画名称は「ラベル＋タイトル」（ラベルを先に、【】で囲んで表示）。
    // 例：【3分で解説】米国の中間選挙ってなに？…　／　ショートはラベルの概念が無いので付けない。
    const rawTitle = isShort ? (y.shortTitle || y.title) : y.title;
    const kicker = (project.kicker || "").trim();
    const title = !isShort && kicker ? `【${kicker}】${rawTitle}` : rawTitle;
    return {
      folder: isShort ? `${thumb}_ショート` : thumb,
      video: safeFileName(title, thumb),
      thumb: isShort ? `${thumb}_ショート` : thumb,
      title,
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
    setTopic(""); setExtraInstruction(""); setRefs([]); setSelectedRefIds(new Set());
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

  // Stage F-4：自動実行中（autorunRef非null）は、ファイル保存をtts-server経由のサーバー側書き込みで行う
  // （File System Access APIのフォルダ選択は無人実行では使えないため）。投資shortsのsaveFile()と同じ考え方。
  const saveViaServer = async (blob, name, outDir, sub) => {
    const buf = await blob.arrayBuffer();
    const r = await fetch(`${getTtsBaseUrl()}/api/save-output`, {
      method: "POST",
      headers: { "x-dir": encodeURIComponent(outDir), "x-sub": encodeURIComponent(sub || ""), "x-name": encodeURIComponent(name) },
      body: buf,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.error || `保存に失敗しました（${name}）`);
    return j.file;
  };
  const handleExport = async () => {
    const r = rendererRef.current, canvas = canvasRef.current;
    if (!r || !canvas || !scenes.length || !project) return;
    const autorun = autorunRef.current;
    lastExportErrorRef.current = null;
    // 保存先フォルダ（ボタンを押した直後でないと選べない・許可を求められないため、録画の前に確認する）。
    // 自動実行中はユーザー操作が無いためフォルダ選択ダイアログを呼ばず、保存は下のsaveViaServerに委ねる。
    let folder = exportFolder;
    if (!autorun && canPickFolder()) {
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
      // MediaRecorder開始直後の数フレームはエンコーダーのパイプラインがまだ安定しておらず、書き出した
      // ファイルの先頭が壊れる（YouTube側で「ファイルを読み取れません」となる）ことがごくまれにある。
      // 特にショート（1分前後）はその不安定な区間が全体に占める割合が大きく、症状が出やすい
      // （プレビュー再生を一度もせずに書き出すと起きやすい、という報告と一致する）。本編のタイマー
      // （t0）を始める前に、実際の1コマ目を数フレーム分あらかじめ録画しておき、パイプラインを
      // 安定させてから本編を始める（音声はまだ鳴らさないため、音ズレは発生しない）。
      await new Promise((resolve) => {
        let warmN = 0;
        const warm = () => {
          rendererRef.current?.draw(0);
          warmN++;
          if (warmN < 9) requestAnimationFrame(warm); else resolve();
        };
        requestAnimationFrame(warm);
      });
      await new Promise((resolve) => {
        const t0 = performance.now();
        pr.bufs.forEach((b, i) => { if (b) mixer().playBufferAfter(b, pr.starts[i] + 0.3); });
        let fading = false, lastUi = 0, finished = false;
        // タブを裏に回す・最小化するなどで非表示になると、requestAnimationFrameはブラウザ側で止まるか
        // ごく低頻度になる（録画中であっても）。一方、canvas.captureStream()によるMediaRecorderの録画と
        // BGMの再生（Web Audio）はタブの表示状態に関係なく進み続けるため、rAFのtick()だけで終了判定を
        // していると、本編の時間（totalMs）を過ぎても録画が止まらず、ユーザーがタブに戻って来るまで
        // BGMだけが流れる静止画面が録画され続けてしまう。setTimeoutはrAFほど厳しく止まらないため、
        // 本来の終了予定時刻に確実に終了させる保険として使う（tick()が正常に動いていれば、通常は
        // こちらより先にelがtotalMsへ達してresolveするので、この保険が働くのは裏に回っていた場合のみ）。
        const finish = () => {
          if (finished) return;
          finished = true;
          if (!fading) { fading = true; mixer().fadeBGM(0.2); }
          resolve();
        };
        setTimeout(finish, totalMs + 200);
        const tick = () => {
          if (finished) return;
          const now = performance.now(), el = now - t0, prog = Math.min(1, el / animMs);
          rendererRef.current?.draw(prog);
          if (!thumbPending && el >= thumbAtMs) thumbPending = canvasPng(canvas).then((b) => { thumbBlob = b; });
          // 画面の表示更新は1秒に4回まで（毎コマ更新すると画面全体の再描画で録画が引っかかり、人物が途切れる原因になる）
          if (now - lastUi > 200) { lastUi = now; setSeekPos(prog); updateSceneProgress(prog); setExportProgress(Math.round(Math.min(1, el / totalMs) * 95)); }
          if (!fading && el >= totalMs - 1400) { fading = true; mixer().fadeBGM(1.4); }
          if (el < totalMs) requestAnimationFrame(tick); else finish();
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
      let where;
      if (autorun) {
        if (!autorun.outDir) throw new Error("保存先フォルダが設定されていません（配信設定でフォルダを指定してください）");
        for (const f of files) await saveViaServer(f.blob, f.name, autorun.outDir, names.folder);
        where = `${autorun.outDir}\\${names.folder}`;
      } else {
        where = await saveBundle(folder && (await ensureWritable(folder)) ? folder : null, names.folder, files);
      }
      setExportProgress(100);
      setExportNote(where ? `保存しました：${where}（${files.map((f) => f.name).join("、")}）` : `ダウンロードフォルダに保存しました：${files.map((f) => f.name).join("、")}`);
      if (pr.failed) alert("一部のナレーションを動画に入れられませんでした。ローカルTTSサーバー（npm run dev:video）またはAivisSpeechが起動しているかご確認ください。");
      if (handle.extension === "webm") alert("WebM形式で保存しました（MP4はYouTube側の取り込み処理が時々失敗するため、より安定するWebMを使っています）。YouTubeにはそのままアップロードできます。");
    } catch (err) {
      lastExportErrorRef.current = err;
      alert(`書き出しエラー: ${err?.message ?? err}`);
      try { await handle?.stop(); } catch (e2) { /* ignore */ }
      mixer().stopBGM(); mixer().stopRecordingTap();
    } finally {
      rendererRef.current?.draw(seekPosRef.current);
      setTimeout(() => { setIsExporting(false); setExportProgress(0); }, 800);
    }
  };

  // ---------------- Stage F-4：平日朝の自動実行オーケストレーション ----------------
  // scripts/auto-run.mjsが開く ?autorun=1&mode=preview|video&run=<id> を検出し、「株式情報」モードで
  // 台本生成（mode=previewはここまで）・動画生成（mode=videoはhandleExportまで）を無人で実行する。
  // investment-shortsのBatchPanel.tsxと同じ「同じrunを二重実行しない」考え方（localStorageのautorun-last）を使う。
  // alert()・confirm()はscripts/auto-run.mjs側のPlaywright dialogハンドラーが自動で閉じるため、
  // ここでは画面側のalert呼び出し自体には手を入れない（window.alertの差し替えは行わない）。
  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    if (qs.get("autorun") !== "1") return;
    const run = qs.get("run") || "";
    const autoMode = qs.get("mode") === "video" ? "video" : "preview";
    if (!run) return;
    let lastRun = "";
    try { lastRun = localStorage.getItem("autorun-last") || ""; } catch (e) { /* 無視 */ }
    if (lastRun === run) return; // 同じrunを二重実行しない（useEffectの再発火・再読み込み対策）
    try { localStorage.setItem("autorun-last", run); } catch (e) { /* 無視 */ }

    const steps = [];
    const addStep = (name, ok, note = "") => { steps.push({ name, ok, note }); return steps.slice(); };
    const postStatus = (patch) => fetch(`${getTtsBaseUrl()}/api/auto-status`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ run, mode: autoMode, ...patch }),
    }).catch(() => {});

    (async () => {
      try {
        postStatus({ state: "running", message: "設定を読み込んでいます…", steps: addStep("開始", true) });

        // ①保存先フォルダ（mode=videoのときのみ使う）を配信設定（/api/auto-schedule）から取得
        let outDir = "";
        try {
          const cfgRes = await fetch(`${getTtsBaseUrl()}/api/auto-schedule`);
          const cfg = await cfgRes.json().catch(() => null);
          outDir = (cfg && cfg.outDir) || "";
        } catch (e) { /* 空のままでも進める（video時のみ下でエラーにする） */ }

        // ②声・アバター・BGM・背景などの設定を自動運転プロファイルへ反映する（Stage F-3）。
        //   失敗しても続行する（未設定でも既定のアバター・声のまま生成できるため）。
        try {
          const r = await fetch(`${getTtsBaseUrl()}/api/profile-snapshot`);
          const text = await r.text();
          if (text && text !== "null") await importVideoProfile(text);
          postStatus({ state: "running", message: "株式情報モードに切り替えています…", steps: addStep("設定の引き継み", true) });
        } catch (e) {
          postStatus({ state: "running", message: "株式情報モードに切り替えています…", steps: addStep("設定の引き継み", false, String(e?.message ?? e)) });
        }

        // ③「株式情報」モードへ切り替え、テーマ欄を今日の日付にする（前回の残り・引き継いだ設定の影響を受けないよう、
        //   topic・参考情報・前回の台本は毎回明示的にリセットする＝「毎日同じ型」を保証する）
        setMode("stock"); setRefs([]); setExtraInstruction(""); setProject(null);
        const [y, mo, dd] = easternStamp(new Date()).slice(0, 10).split("-");
        setTopic(`${y}年${Number(mo)}月${Number(dd)}日`);

        // ④ダッシュボードが書き出す stock-catalog:SP500/SOXL（storage.get経由）が揃うまで待つ（最大30秒）
        const waitUntil = Date.now() + 30000;
        for (;;) {
          const got = await Promise.all(["SP500", "SOXL"].map((src) => storage.get(`stock-catalog:${src}`).catch(() => null)));
          if (got.some((g) => g?.value) || Date.now() > waitUntil) break;
          await new Promise((res) => setTimeout(res, 500));
        }
        await new Promise((res) => setTimeout(res, 800)); // Reactの状態反映（stockSnapshots等）を一拍待つ

        // ⑤台本生成（これで mode=preview はここまで完成）
        postStatus({ state: "running", message: "台本を生成しています…", steps: addStep("データ読み込み", true) });
        await handleGenerate();
        if (lastGenErrorRef.current) throw new Error(lastGenErrorRef.current);
        postStatus({ state: "running", message: "台本の生成が完了しました", steps: addStep("台本生成", true) });

        if (autoMode === "preview") {
          postStatus({ state: "ok", message: "プレビューまで完了しました", steps: addStep("完了（プレビューまで）", true) });
          return;
        }

        // ⑥動画生成（mode=video）：レンダラーの初期化（canvas・プレビュー）を待ってから書き出す
        const rendererWaitUntil = Date.now() + 20000;
        while (!rendererRef.current && Date.now() < rendererWaitUntil) await new Promise((res) => setTimeout(res, 300));
        if (!rendererRef.current) throw new Error("プレビュー画面の初期化に失敗しました");

        autorunRef.current = { run, mode: autoMode, outDir };
        postStatus({ state: "running", message: "動画を書き出しています…", steps: addStep("動画書き出し開始", true) });
        await handleExport();
        if (lastExportErrorRef.current) throw new Error(lastExportErrorRef.current?.message || String(lastExportErrorRef.current));
        postStatus({ state: "ok", message: "動画の生成・保存が完了しました", steps: addStep("完了（動画生成まで）", true) });
      } catch (e) {
        postStatus({ state: "ng", message: e?.message || String(e), steps: addStep("エラー", false, e?.message || String(e)) });
      } finally {
        autorunRef.current = null;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------- 公開前チェック・YouTube情報 ----------------
  const refTexts = useMemo(() => referenceTexts(refs), [refs]);
  const issues = useMemo(() => lintScenes(scenes, refTexts, sceneDurs), [scenes, refTexts, sceneDurs]);
  const issuesByScene = useMemo(() => { const m = {}; issues.forEach((x) => { (m[x.sceneIndex] ??= []).push(x); }); return m; }, [issues]);
  const urlList = useMemo(() => refs.filter((r) => r.kind === "url" && r.status === "ok").map((r) => r.url), [refs]);
  const description = useMemo(() => (project ? buildDescription(project, urlList, format === "short") : ""), [project, urlList, format]);
  const patchYoutube = (patch) => setProject((p) => ({ ...p, youtube: { ...p.youtube, ...patch } }));

  // ---------------- 長さと声の速さのガイド ----------------
  // 「超過」または「20秒以上不足」を赤字アラートの条件にする（例：目標3分なら2分40秒〜3分の間に収める）
  const SHORT_WINDOW_SEC = 20;
  const targetSec = format === "long" ? (project?.targetMinutes || 5) * 60 : 60;
  const predicted = useMemo(() => (totalSec > 0 ? totalSec : predictTotalSec(scenes, rate, narrMeasure)), [totalSec, scenes, rate, narrMeasure]);
  // 目標の窓（targetSec-SHORT_WINDOW_SEC 〜 targetSec）の中央あたりを狙う速さ。
  // suggestRateは「predicted <= 指定秒数を満たす最もゆっくりな速さ」を返すため、超過（速める）・不足（ゆっくりにする）
  // どちらの場合もこの1つの計算で正しい向きの提案になる。
  const fitRate = useMemo(() => suggestRate(scenes, targetSec - SHORT_WINDOW_SEC / 2, narrMeasure), [scenes, targetSec, narrMeasure]);
  const fitPredicted = useMemo(() => (fitRate != null ? predictTotalSec(scenes, fitRate, narrMeasure) : null), [fitRate, scenes, narrMeasure]);
  const applyRate = (r) => { const v = Math.round(r * 100) / 100; setRate(v); updateLocked("rate", v); setActivePresetId(null); };
  const measureNow = async () => { if (isPlayingRef.current) handlePause(); setMeasuring(true); try { await prepareAudio(); } finally { setMeasuring(false); } };
  // 「長尺の長さ」を変えたら、ラベルが自動入力のパターン（{n}分で解説）のままなら新しい長さに合わせて更新する
  // （手で書き換え済みのラベルは上書きしない）
  const handleTargetMinutesChange = (minutes) => {
    setProject((p) => {
      const nextKicker = KICKER_AUTO_RE.test((p.kicker || "").trim()) ? autoKickerFor(minutes) : p.kicker;
      return { ...p, targetMinutes: minutes, kicker: nextKicker };
    });
  };
  const SpeedGuide = () => {
    if (!project || !scenes.length) return null;
    const over = predicted > targetSec;
    const short = !over && predicted < targetSec - SHORT_WINDOW_SEC;
    const bad = over || short;
    const tone = bad ? C.rust : C.teal;
    const fitWorks = fitPredicted != null && fitPredicted <= targetSec && fitPredicted >= targetSec - SHORT_WINDOW_SEC;
    return (
      <div className="rounded p-2 text-[11px] flex flex-col gap-1.5" style={{ background: `${tone}12`, border: `1px solid ${tone}55`, color: C.textMuted }}>
        <div className="flex items-center gap-2 flex-wrap">
          <span style={{ color: tone, fontWeight: 700 }}>{over ? "目標を超えています" : short ? `目標より${SHORT_WINDOW_SEC}秒以上短くなっています` : "目標の長さに収まっています"}</span>
          <span>見込み {fmtTime(predicted)}（速さ {rate.toFixed(2)}x）／目標</span>
          {format === "long" ? (
            <select value={project.targetMinutes} onChange={(e) => handleTargetMinutesChange(Number(e.target.value))} className="px-1 py-0.5 rounded text-[11px]" style={inputStyle}>
              {LENGTH_OPTIONS.map((m) => <option key={m} value={m}>{m}:00以内</option>)}
            </select>
          ) : <span>1:00以内（ショート）</span>}
          <span style={{ color: C.textDim }}>{totalSec ? "※実測" : narrMeasure ? "※実測から計算" : "※文字数から推計"}</span>
        </div>
        {bad && fitRate != null && fitWorks && (
          <div className="flex items-center gap-2 flex-wrap">
            <span>声の速さを <b style={{ color: C.text }}>{fitRate.toFixed(2)}x</b> にすると、約{fmtTime(fitPredicted)}で、目標（{fmtTime(targetSec - SHORT_WINDOW_SEC)}〜{fmtTime(targetSec)}）に収まります。</span>
            <button onClick={() => applyRate(fitRate)} className="text-[10px] px-2 py-0.5 rounded" style={btn("primary")}>この速さにする</button>
            {fitRate > COMFORT_RATE.max && <span style={{ color: C.rust }}>（{COMFORT_RATE.max}xを超えると聞き取りにくくなります。場面を減らすか、目標を延ばすのがおすすめです）</span>}
            {fitRate < COMFORT_RATE.min && <span style={{ color: C.rust }}>（{COMFORT_RATE.min}x未満では聞き取りにくくなります。場面を増やすか、目標を短くするのがおすすめです）</span>}
          </div>
        )}
        {over && !fitWorks && <div style={{ color: C.rust }}>速さを上げても収まりません。場面を減らすか、目標の長さを延ばしてください。</div>}
        {short && !fitWorks && <div style={{ color: C.rust }}>速さを下げても目標に届きません。場面を増やすか、目標の長さを短くしてください。</div>}
        {over && format === "long" && !fitWorks && (
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => handleGenerate(project.targetMinutes)} disabled={genBusy} className="text-[11px] px-2.5 py-1 rounded flex items-center gap-1" style={{ ...btn("primary"), opacity: genBusy ? 0.5 : 1 }}><RefreshCw size={11} /> {genBusy ? (genProgress?.step || "作り直し中…") : `${project.targetMinutes}分以内に収まるよう台本を作り直す`}</button>
            <span style={{ color: C.textDim }}>いまの声の速さ（{rate.toFixed(2)}x）で長さを見積もって作ります。テーマ・参考情報はそのまま使います。</span>
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
          <a href={`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/`} target="_blank" rel="noopener noreferrer" title="別タブで開きます" className="text-[11px] flex items-center gap-1" style={{ color: C.textMuted }}><ArrowLeft size={12} /> ダッシュボード</a>
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
                {[["news", "ニュース"], ["stock", "株式情報"], ["sp500", "S&P500"], ["keyword", "キーワード（用語）"]].map(([k, l]) => (
                  <button key={k} onClick={() => handleModeClick(k)} className="text-[11px] px-2.5 py-1 rounded" style={{ color: mode === k ? C.bg : C.textMuted, background: mode === k ? C.teal : "transparent", border: `1px solid ${C.borderSoft}`, cursor: "pointer", fontWeight: mode === k ? 700 : 400 }}>{l}</button>
                ))}
                <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder={mode === "news" ? "例：日銀が政策金利を0.75%に引き上げ" : mode === "stock" ? "例：2026年10月28日（消去・書き換え可）" : mode === "sp500" ? "例：S&P500　最新分析（消去・書き換え可）" : "例：インフレ／NISA／半導体の微細化"} className="flex-1 min-w-[220px] px-2 py-1.5 rounded text-sm" style={inputStyle} />
              </div>
              {(mode === "stock" || mode === "sp500") && (() => {
                // [Stage E-15] 動画に使う実データの期間を表示する（ダッシュボードを開いた時点のデータが使われるため、古い・未取得に気づけるように）
                const snap = primaryStockSnapshot();
                const note = snap ? dataPeriodNoteOf(snap, snap.instrumentLabel ?? "S&P500") : null;
                return (
                  <div className="text-[10px]" style={{ color: note ? C.textDim : C.amber }}>
                    {note ? `使用するデータ：${note}。最新にするには、先にダッシュボードを開いてデータを読み込んでください。` : "ダッシュボードのデータがまだ書き出されていません。先にダッシュボードを開いてから作成してください。"}
                  </div>
                );
              })()}
              <div className="flex flex-wrap gap-3 items-center" style={{ color: C.textMuted }}>
                <label className="flex items-center gap-1.5">視聴者
                  <select value={audience} onChange={(e) => setAudience(e.target.value)} className="px-1.5 py-1 rounded text-[11px]" style={inputStyle}>
                    <option value="beginner">初心者向け</option><option value="general">一般向け</option><option value="advanced">詳しめ</option><option value="expert">専門的</option>
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
                <div className="text-[10px] mb-1.5" style={{ color: C.textDim }}>各資料の<Pin size={10} style={{ display: "inline", verticalAlign: "-1px", color: C.teal }} />ボタンを押すと「必ず動画に含める」情報として固定できます（押していない資料は、AIが内容を見て取捨選択します）。</div>
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <input value={researchPrompt} onChange={(e) => setResearchPrompt(e.target.value)} placeholder="検索プロンプト（任意）：空欄ならテーマをそのまま検索します。例）2026年10月の決算の反応に絞って" className="flex-1 min-w-[260px] px-2 py-1 rounded text-[11px]" style={inputStyle} />
                </div>
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <button onClick={runResearch} disabled={researchBusy} className="text-[11px] px-2 py-1 rounded flex items-center gap-1" style={{ ...btn("primary"), opacity: researchBusy ? 0.6 : 1 }}><Search size={11} /> {researchBusy ? "検索中…" : "AIで検索して参考情報を追加"}</button>
                  <span className="text-[10px]" style={{ color: C.textDim }}>{researchPrompt.trim() ? (topic.trim() ? "テーマ＋上の検索プロンプトの内容で" : "上の検索プロンプトの内容で") : "テーマについて"}、Claudeの検索とGeminiの検索でURL最大5件・要約テキスト2件（Gemini・Claude）を自動で追加します（何度でも押せます。不要な結果は個別に削除できます）。</span>
                  {researchError && <div className="text-[10px] w-full" style={{ color: C.rust }}>{researchError}</div>}
                </div>
                <div className="flex flex-col gap-1 mb-2">
                  {refs.length === 0 && <div className="text-[10px]" style={{ color: C.textDim }}>未追加です。ニュースは元記事や公式発表を追加すると正確になります（参考情報なしの場合は、一般に確立した知識の範囲で解説します）。</div>}
                  {refs.length > 0 && (
                    <div className="flex items-center gap-2 flex-wrap text-[10px] mb-0.5" style={{ color: C.textDim }}>
                      <label className="flex items-center gap-1 cursor-pointer">
                        <input type="checkbox" checked={refs.every((r) => selectedRefIds.has(r.id))} onChange={(e) => setSelectedRefIds(e.target.checked ? new Set(refs.map((r) => r.id)) : new Set())} />
                        すべて選択
                      </label>
                      {selectedRefIds.size > 0 && (
                        <>
                          <span>{selectedRefIds.size}件選択中：</span>
                          <button onClick={() => { setRefs((p) => p.filter((x) => !selectedRefIds.has(x.id))); setSelectedRefIds(new Set()); }} className="px-1.5 py-0.5 rounded flex items-center gap-1" style={btn()}><X size={10} /> まとめて削除</button>
                          <button onClick={() => setRefs((p) => p.map((x) => (selectedRefIds.has(x.id) ? { ...x, required: true } : x)))} className="px-1.5 py-0.5 rounded flex items-center gap-1" style={btn()}><Pin size={10} /> まとめて必須に設定</button>
                          <button onClick={() => setRefs((p) => p.map((x) => (selectedRefIds.has(x.id) ? { ...x, required: false } : x)))} className="px-1.5 py-0.5 rounded flex items-center gap-1" style={btn()}><PinOff size={10} /> 必須を解除</button>
                          {refs.some((x) => selectedRefIds.has(x.id) && x.kind === "url") && (
                            <button onClick={() => refs.filter((x) => selectedRefIds.has(x.id) && x.kind === "url").forEach((x) => window.open(x.url, "_blank", "noopener,noreferrer"))} className="px-1.5 py-0.5 rounded flex items-center gap-1" style={btn()}><ExternalLink size={10} /> 選択したURLを開く</button>
                          )}
                        </>
                      )}
                    </div>
                  )}
                  {refs.map((r) => (
                    <div key={r.id}>
                      <div className="flex items-center gap-2 px-2 py-1 rounded" style={{ background: C.panel2, border: `1px solid ${r.kind === "url" && r.status === "error" ? C.rust + "88" : r.required ? C.teal + "99" : C.borderSoft}` }}>
                        <input type="checkbox" checked={selectedRefIds.has(r.id)} onChange={() => toggleRefSelected(r.id)} className="shrink-0" />
                        {r.kind === "url" ? <Link2 size={12} style={{ color: C.blue, flexShrink: 0 }} /> : r.kind === "pdf" ? <FileText size={12} style={{ color: C.rust, flexShrink: 0 }} /> : r.kind === "csv" ? <FileText size={12} style={{ color: C.blue, flexShrink: 0 }} /> : r.kind === "image" ? <ImageIcon size={12} style={{ color: C.teal, flexShrink: 0 }} /> : <Type size={12} style={{ color: C.amber, flexShrink: 0 }} />}
                        <span className="truncate flex-1 text-[11px]" title={r.kind === "url" ? r.url : r.title}>{refLabel(r)}</span>
                        {r.required && <span className="text-[9px] px-1 rounded shrink-0" style={{ color: C.bg, background: C.teal, fontWeight: 700 }}>必須</span>}
                        <span className="text-[10px] shrink-0" style={{ color: r.kind === "url" && r.status === "error" ? C.rust : C.textDim }}>
                          {r.kind === "url" ? (r.status === "pending" ? "読み込み中…" : r.status === "error" ? r.error : r.pdfBase64 ? "PDF" : `${r.note ? `${r.note}・` : ""}${r.text.length.toLocaleString()}字`) : r.kind === "pdf" ? sizeKb(r.sizeBytes) : r.kind === "csv" ? `CSV・${sizeKb(r.sizeBytes)}` : r.kind === "image" ? `画像・${sizeKb(r.sizeBytes)}` : `${r.text.length.toLocaleString()}字`}
                        </span>
                        {r.kind === "url" && <a href={r.url} target="_blank" rel="noopener noreferrer" title="サイトを新しいタブで開く（採用するか確認）" style={{ color: C.textMuted, flexShrink: 0, display: "flex" }}><ExternalLink size={11} /></a>}
                        {r.kind === "text" && <button onClick={() => setExpandedRefId((id) => (id === r.id ? null : r.id))} title="本文を確認" style={{ color: C.textMuted, background: "none", border: "none", cursor: "pointer" }}>{expandedRefId === r.id ? <EyeOff size={12} /> : <Eye size={12} />}</button>}
                        {r.kind === "url" && r.status === "error" && <button onClick={() => loadUrl(r.id, r.url)} title="もう一度読み込む" style={{ color: C.textMuted, background: "none", border: "none", cursor: "pointer" }}><RefreshCw size={11} /></button>}
                        <button onClick={() => setRefs((p) => p.map((x) => (x.id === r.id ? { ...x, required: !x.required } : x)))} title={r.required ? "「必ず動画に含める」を解除" : "必ず動画に含める（AIに省略させない）"} style={{ color: r.required ? C.teal : C.textDim, background: "none", border: "none", cursor: "pointer" }}>{r.required ? <Pin size={12} /> : <PinOff size={12} />}</button>
                        <button onClick={() => { setRefs((p) => p.filter((x) => x.id !== r.id)); setSelectedRefIds((prev) => { if (!prev.has(r.id)) return prev; const next = new Set(prev); next.delete(r.id); return next; }); }} title="削除" style={{ color: C.textDim, background: "none", border: "none", cursor: "pointer" }}><X size={12} /></button>
                      </div>
                      {r.kind === "text" && expandedRefId === r.id && (
                        <textarea readOnly value={r.text} rows={6} className="w-full mt-1 px-2 py-1 rounded text-[11px]" style={{ ...inputStyle, background: C.panel, resize: "vertical" }} />
                      )}
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2 items-center">
                  <input value={urlInput} onChange={(e) => setUrlInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addUrls(); }} placeholder="URLを貼り付け：記事・PDF・YouTube動画（複数は空白・改行区切り）" className="flex-1 min-w-[240px] px-2 py-1 rounded text-[11px]" style={inputStyle} />
                  <button onClick={addUrls} className="text-[11px] px-2 py-1 rounded flex items-center gap-1" style={btn()}><Link2 size={11} /> URLを追加</button>
                  <label className="text-[11px] px-2 py-1 rounded flex items-center gap-1" style={btn()}><FileText size={11} /> PDFを追加
                    <input type="file" accept="application/pdf,.pdf" multiple style={{ display: "none" }} onChange={(e) => { const fs = e.target.files; addPdfs(fs); e.target.value = ""; }} />
                  </label>
                  {mode === "stock" && (
                    <label className="text-[11px] px-2 py-1 rounded flex items-center gap-1" style={btn()}><FileText size={11} /> CSVを追加（株価データ）
                      <input type="file" accept=".csv,text/csv" multiple style={{ display: "none" }} onChange={(e) => { const fs = e.target.files; addStockCsv(fs); e.target.value = ""; }} />
                    </label>
                  )}
                  <label className="text-[11px] px-2 py-1 rounded flex items-center gap-1" style={btn()}><Camera size={11} /> スクショを追加
                    <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) addScreenshot(f); }} />
                  </label>
                  <button onClick={() => { setLibSelectedIds(new Set()); setRefImgLibOpen(true); refreshImages(); }} className="text-[11px] px-2 py-1 rounded flex items-center gap-1" style={btn()}><ImageIcon size={11} /> ライブラリから選ぶ</button>
                  <button onClick={() => setRefTextOpen((v) => !v)} className="text-[11px] px-2 py-1 rounded flex items-center gap-1" style={btn()}><Type size={11} /> テキストを追加</button>
                </div>
                <div className="text-[10px] mt-1" style={{ color: C.textDim }}>URLの本文はローカルサーバー（{getTtsBaseUrl()}）が取得します。YouTube動画はタイトル・概要欄・字幕（公開されている場合）を読み込みます。字幕が取れない動画は、YouTubeの「文字起こしを表示」の内容をコピーして「テキスト」で追加してください。ログインが必要なページや有料記事は読めないため、本文をコピーして「テキスト」で追加してください。グラフ作成ページで保存したスクリーンショットは「ライブラリから選ぶ」からすぐに追加できます。</div>
                {refTextOpen && (
                  <div className="mt-2 flex flex-col gap-1.5 p-2 rounded" style={{ background: C.panel2, border: `1px solid ${C.borderSoft}` }}>
                    <input value={refTextTitle} onChange={(e) => setRefTextTitle(e.target.value)} placeholder="資料名（例：日銀の公表文、○○新聞 10月25日）" className="px-2 py-1 rounded text-[11px]" style={{ ...inputStyle, background: C.panel }} />
                    <textarea value={refTextBody} onChange={(e) => setRefTextBody(e.target.value)} placeholder="本文やメモを貼り付け" rows={5} className="px-2 py-1 rounded text-[11px]" style={{ ...inputStyle, background: C.panel, resize: "vertical" }} />
                    <div className="flex gap-2"><button onClick={addTextRef} className="text-[11px] px-2 py-1 rounded" style={btn("primary")}>追加</button><button onClick={() => setRefTextOpen(false)} className="text-[11px] px-2 py-1 rounded" style={{ ...btn(), color: C.textMuted, borderColor: C.borderSoft }}>やめる</button></div>
                  </div>
                )}
              </div>

              {project?.longScenes?.some((s) => s.imageId) && (
                <div className="flex flex-wrap gap-3 items-center p-2 rounded" style={{ background: C.panel2, border: `1px solid ${C.borderSoft}` }}>
                  <label className="flex items-center gap-1.5 text-[11px]" style={{ color: C.textMuted }}>
                    <input type="checkbox" checked={reuseImagesEnabled} onChange={(e) => setReuseImagesEnabled(e.target.checked)} />
                    台本を作り直す時、前回の画像を再利用する（場面の順番で引き継ぎ、課金なし）
                  </label>
                  <span className="text-[10px]" style={{ color: C.textDim }}>
                    {reuseImagesEnabled
                      ? "前回付いていた画像を先に引き継ぎ、それで埋まらない場面だけ下の設定に応じて新しく生成します。"
                      : "オフの場合、画像が付いていた場面もすべて新しく生成し直します（その分課金されます）。"}
                  </span>
                </div>
              )}
              <div className="flex flex-wrap gap-3 items-center p-2 rounded" style={{ background: C.panel2, border: `1px solid ${C.borderSoft}` }}>
                <label className="flex items-center gap-1.5 text-[11px]" style={{ color: C.textMuted }}>
                  <input type="checkbox" checked={imageGenEnabled} onChange={(e) => setImageGenEnabled(e.target.checked)} />
                  AIで画像を自動生成してスライドに挿入する
                </label>
                {imageGenEnabled && (
                  <label className="flex items-center gap-1.5 text-[11px]" style={{ color: C.textMuted }}>枚数
                    <select value={imageGenCount} onChange={(e) => setImageGenCount(Number(e.target.value))} className="px-1.5 py-1 rounded text-[11px]" style={inputStyle}>
                      {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => <option key={n} value={n}>{n}枚</option>)}
                    </select>
                  </label>
                )}
                {imageGenEnabled && (
                  <label className="flex items-center gap-1.5 text-[11px] flex-1 min-w-[220px]" style={{ color: C.textMuted }}>画風の指定（任意）
                    <input value={imageStyleHint} onChange={(e) => setImageStyleHint(e.target.value)} placeholder="例：写真のようなリアルな画像で表現してください" className="flex-1 px-2 py-1 rounded text-[11px]" style={inputStyle} />
                  </label>
                )}
                <span className="text-[10px]" style={{ color: C.textDim }}>
                  {imageGenEnabled
                    ? "内容に合う場面を選び、画像1枚ごとに課金されるGoogle Gemini（Imagen）で生成します（tts-server/.envにGEMINI_API_KEYの設定が必要）。実在の人物・ロゴ・既存作品を描かないよう指示しています。生成後も場面ごとに作り直せます。"
                    : "オフの場合、図解はこれまで通りすべて自作の図形・アイコンで描きます（あとから場面ごとに「画像を追加」→「AIで生成」で追加することもできます）。"}
                </span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={() => handleGenerate()} disabled={genBusy} className="text-xs px-3 py-1.5 rounded flex items-center gap-1.5" style={{ ...btn("primary"), opacity: genBusy ? 0.6 : 1 }}><Sparkles size={13} /> {project ? "台本を作り直す" : "台本を生成（長尺＋ショート）"}</button>
                {/* Stage G-2：詳細な進捗（手順・%・経過時間・中止）は画面右下のGenProgressPanelに集約した。
                    ここでは生成中かどうかが一目で分かる短い表示のみ残す。 */}
                {genBusy && <span className="text-[11px]" style={{ color: C.textMuted }}>生成中…（右下に進み具合を表示）</span>}
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
                  <button onClick={handleExport} disabled={isExporting} className="text-xs px-3 py-1.5 rounded flex items-center gap-1.5 ml-auto" style={{ ...btn("amber"), background: isExporting ? C.panel2 : C.amber, color: isExporting ? C.textMuted : C.bg }}><Download size={13} /> {isExporting ? `書き出し中… ${exportProgress}%` : "動画を書き出す"}</button>
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

              {/* ---------- 設定パネル（常にプレビューの右横に枠として表示し、内側のスクロールバーで移動する） ---------- */}
              <div className="flex flex-col gap-4 text-xs flex-1 min-w-0 rounded-lg p-3 overflow-y-auto" style={{ border: `1px solid ${C.border}`, background: C.panel, maxHeight: "min(85vh, 900px)" }}>
                {/* 公開前チェック */}
                <Section collapsible defaultOpen={false} title={`公開前チェック（${issues.filter((x) => x.level === "warn").length}件の注意・${issues.filter((x) => x.level === "info").length}件の確認）`} right={issues.some((x) => x.message.startsWith("参考資料の文章")) ? <button onClick={paraphraseAll} disabled={!!paraAllBusy} className="text-[10px] px-1.5 py-0.5 rounded" style={{ ...btn("primary"), opacity: paraAllBusy ? 0.5 : 1 }}>{paraAllBusy || "参考資料と同じ言い回しをまとめて言い換える"}</button> : null}>
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
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => { setBulkAiOpen((v) => !v); setBulkAiError(""); }} className="text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1" style={btn(bulkAiOpen ? "primary" : undefined)}><RefreshCw size={10} /> 全体をAIで一括修正</button>
                    <button onClick={() => { setAiOpenId((v) => (v === "__new" ? null : "__new")); setAiText(""); setAiError(""); }} className="text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1" style={btn()}><Plus size={10} /> 場面をAIで追加</button>
                  </div>
                }>
                  {bulkAiOpen && (
                    <div className="mb-1.5 p-2 rounded flex flex-col gap-1.5" style={{ background: C.panel2, border: `1px solid ${C.borderSoft}` }}>
                      <div className="flex items-center gap-1.5">
                        <input autoFocus value={bulkAiText} onChange={(e) => setBulkAiText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !bulkAiBusy) runBulkAi(); }} disabled={!!bulkAiBusy}
                          placeholder="例：すべてのスライドのドル表記の後に（）で円換算を表記して、ナレーションでも円換算を加えてください"
                          className="flex-1 text-[11px] rounded px-2 py-1" style={{ ...inputStyle, background: C.panel }} />
                        {bulkAiBusy ? (
                          <button onClick={cancelBulkAi} className="text-[10px] px-2 py-1 rounded" style={btn()}>キャンセル</button>
                        ) : (
                          <button onClick={runBulkAi} disabled={!bulkAiText.trim()} className="text-[10px] px-2 py-1 rounded" style={{ ...btn("primary"), opacity: bulkAiText.trim() ? 1 : 0.5 }}>全{scenes.length}場面に適用</button>
                        )}
                      </div>
                      <div className="text-[10px]" style={{ color: C.textDim }}>
                        {bulkAiBusy || `全${scenes.length}場面それぞれに、この指示でスライド（図解・テロップ）とナレーションの書き直しを依頼します。1場面ずつ順番に処理するため時間がかかります（途中でキャンセルできます。キャンセルまでに完了した場面は反映されます）。`}
                      </div>
                      {bulkAiError && <div className="text-[10px]" style={{ color: "#ff6b6b" }}>{bulkAiError}</div>}
                    </div>
                  )}
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
                            <button onClick={() => playFromScene(i)} title="この場面の最初から、最後の場面まで通しで再生" className="text-[10px] flex items-center gap-0.5" style={{ color: C.teal, background: "none", border: "none", cursor: "pointer" }}><Play size={10} />再生</button>
                            <button onClick={() => { if (isPlaying) handlePause(); }} disabled={!isPlaying} title="プレビューを一時停止" className="text-[10px] flex items-center gap-0.5" style={{ color: isPlaying ? C.teal : C.textDim, background: "none", border: "none", cursor: isPlaying ? "pointer" : "default", opacity: isPlaying ? 1 : 0.4 }}><Pause size={10} />一時停止</button>
                            <button onClick={() => { setNarrAiOpenId((v) => (v === sc.id ? null : sc.id)); setNarrAiText(""); setNarrAiError(""); }} className="text-[10px] flex items-center gap-0.5" style={{ color: narrAiOpenId === sc.id ? C.teal : C.textDim, background: "none", border: "none", cursor: "pointer" }} title="スライドはそのまま、ナレーションだけをAIで変える"><RefreshCw size={10} />ナレーション変更</button>
                            <button onClick={() => { setAiOpenId((v) => (v === sc.id ? null : sc.id)); setAiText(""); setAiError(""); }} className="text-[10px] flex items-center gap-0.5" style={{ color: aiOpenId === sc.id ? C.teal : C.textDim, background: "none", border: "none", cursor: "pointer" }} title="AIに作り直しを指示（スライドごと作り直します）"><MessageSquare size={10} />AI</button>
                            <button onClick={() => removeScene(sc.id)} title="この場面を削除" style={{ color: C.textDim, background: "none", border: "none", cursor: "pointer" }}><X size={12} /></button>
                          </div>
                          {/* [Stage G-4] スライド（図解・画像）のサムネイル。画像が無ければ図解をそのままcanvasに描く */}
                          <div className="flex gap-2 mb-1.5">
                            <div className="shrink-0 rounded overflow-hidden" style={{ width: format === "short" ? 92 : 150, height: format === "short" ? 158 : 94, background: C.panel2, border: `1px solid ${C.borderSoft}` }}>
                              {sc.imageId && imageEls[sc.imageId] ? (
                                <img src={imageEls[sc.imageId].src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                              ) : (
                                <SceneThumbCanvas sc={sc} portrait={format === "short"} />
                              )}
                            </div>
                            <div className="flex-1 min-w-0 flex flex-col gap-1">
                              <div className="text-[10px] leading-snug" style={{ color: C.textDim }}>使えるのは、自分で撮影・作成した画像、利用条件を確認したフリー素材、画像生成AIで自作したもの（実在の人物・ロゴ・既存作品を含まない）です。</div>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {sc.imageId ? (
                                  <button onClick={() => detachImage(sc)} className="text-[10px] px-1.5 py-0.5 rounded flex items-center gap-0.5" style={btn()}><X size={10} />画像を外す（図解表示に戻す）</button>
                                ) : (
                                  <>
                                    <label className="text-[10px] px-1.5 py-0.5 rounded cursor-pointer" style={btn()}>ファイル選択
                                      <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) attachImage(sc.id, f); }} />
                                    </label>
                                    {images.length > 0 && (
                                      <button onClick={() => { setRightsPendingId((v) => (v === sc.id ? null : sc.id)); setImgGenError(""); refreshImages(); }} className="text-[10px] px-1.5 py-0.5 rounded" style={{ ...btn(), color: rightsPendingId === sc.id ? C.teal : C.textMuted }}>ライブラリから選ぶ</button>
                                    )}
                                    {sc.visual.imagePrompt && (
                                      <button onClick={() => genSceneImage(sc)} disabled={imgGenBusyId === sc.id} className="text-[10px] px-1.5 py-0.5 rounded" style={{ ...btn("primary"), opacity: imgGenBusyId === sc.id ? 0.5 : 1 }}>{imgGenBusyId === sc.id ? "生成中…" : "AIで生成"}</button>
                                    )}
                                  </>
                                )}
                              </div>
                              {!sc.imageId && rightsPendingId === sc.id && images.length > 0 && (
                                <div className="flex flex-wrap gap-1" style={{ maxHeight: 92, overflowY: "auto" }}>
                                  {images.slice().reverse().map((im) => (
                                    <button key={im.id} onClick={() => { attachExistingImage(sc.id, im.id); setRightsPendingId(null); }} title={im.name} className="shrink-0 rounded overflow-hidden" style={{ width: 36, height: 36, padding: 0, border: `1px solid ${C.borderSoft}`, background: C.panel2, cursor: "pointer" }}>
                                      {imageEls[im.id] && <img src={imageEls[im.id].src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
                                    </button>
                                  ))}
                                </div>
                              )}
                              {imgGenError && imgGenBusyId === null && <div className="text-[10px]" style={{ color: "#ff6b6b" }}>{imgGenError}</div>}
                            </div>
                          </div>
                          <div className="rounded" style={{ background: C.panel }}>
                            <NarrMixedBox value={sc.narration} base={sc.narration}
                              onChange={(t) => { if (isPlayingRef.current) handlePause(); if (!editBaseRef.current[sc.id]) editBaseRef.current[sc.id] = { narration: sc.narration, reading: sc.reading }; patchScene(sc.id, { narration: t, readingStale: true, ...(sc.genNarration ? {} : { genNarration: sc.narration }) }); }}
                              onBlur={() => handleNarrBlur(sc.id)}
                              colors={{ text: C.text, border: C.borderSoft }}
                              readUpTo={cur && (isPlaying || isExporting) ? readCharIdx : null} />
                          </div>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <button onClick={() => setReadingOpenId((v) => (v === sc.id ? null : sc.id))} className="text-[10px] flex items-center gap-0.5" style={{ color: isKanaReading(sc.reading) && !sc.readingStale ? C.textDim : C.amber, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                              読み上げ文{readingBusyIds.has(sc.id) ? "（直した部分を更新中…）" : sc.readingStale ? "（ナレーションと要確認）" : ""}<ChevronRight size={10} style={{ transform: readingOpenId === sc.id ? "rotate(90deg)" : "none" }} />
                            </button>
                            {learnedOf(sc) && (
                              <span className="text-[10px] flex items-center gap-1" style={{ color: C.teal }} title="この場面のナレーションの直しを記憶しています。次回以降の台本でも同じ直し方を当てはめます。">
                                <Check size={10} /> 直しを記憶済み（次回以降も反映）
                                <button onClick={() => forgetEdit(sc)} className="underline" style={{ color: C.textDim, background: "none", border: "none", cursor: "pointer", padding: 0 }}>忘れる</button>
                              </span>
                            )}
                            <button onClick={() => setEditVisualId((v) => (v === sc.id ? null : sc.id))} className="text-[10px] flex items-center gap-0.5" style={{ color: C.textDim, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                              図解の内容<ChevronRight size={10} style={{ transform: editVisualId === sc.id ? "rotate(90deg)" : "none" }} />
                            </button>
                            <span className="text-[10px] ml-auto" style={{ color: C.textDim }}>テロップ</span>
                            <input value={sc.caption} onChange={(e) => patchScene(sc.id, { caption: e.target.value })} className="text-[10px] px-1 py-0.5 rounded w-40" style={inputStyle} />
                          </div>
                          {readingOpenId === sc.id && (
                            <div className="mt-1">
                              <textarea value={sc.reading} rows={2} onChange={(e) => { if (isPlayingRef.current) handlePause(); patchScene(sc.id, { reading: e.target.value.replace(/\n/g, ""), readingStale: false }); }} className="w-full rounded px-1.5 py-1 text-[11px]" style={{ ...inputStyle, background: C.panel, resize: "vertical" }} />
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
                              {sc.visual.kind === "yearCompare" ? (
                                // [Stage E-9] 年比較グラフ：itemsは系列ごとの実データ点列（seriesKey付き）なので、
                                // 他の図解と同じ「見出し｜数値｜説明｜アイコン」のテキスト編集には適さない
                                // （編集すると系列情報が失われる）。代わりに系列をチェックボックスで選ぶ専用UIにする。
                                <div className="p-1.5 rounded flex flex-col gap-1" style={{ background: C.panel2, border: `1px solid ${C.borderSoft}` }}>
                                  <div className="text-[10px]" style={{ color: C.textDim }}>重ねて表示する系列を選択（2〜8個。今年などの強調系列も含めると見やすくなります）</div>
                                  {stockOverlayCatalog.yearCompare ? (
                                    <div className="flex flex-wrap gap-2">
                                      {Object.entries(stockOverlayCatalog.yearCompare.series).map(([key, s]) => {
                                        const selectedKeys = [...new Set(sc.visual.items.map((it) => it.seriesKey).filter(Boolean))];
                                        const checked = selectedKeys.includes(key);
                                        return (
                                          <label key={key} className="text-[10px] flex items-center gap-1" style={{ color: checked ? C.teal : C.textMuted, cursor: "pointer" }}>
                                            <input type="checkbox" checked={checked} onChange={(e) => {
                                              const next = e.target.checked ? [...selectedKeys, key] : selectedKeys.filter((k) => k !== key);
                                              const items = resolveYearCompareItems(next, stockOverlayCatalog.yearCompare);
                                              patchScene(sc.id, { visual: normalizeVisual({ ...sc.visual, items }) });
                                              previewSceneAt(i); // [Stage E-11] 系列を変更したら、まず変更後のスライドを表示する
                                            }} />
                                            {s.label}
                                          </label>
                                        );
                                      })}
                                    </div>
                                  ) : (
                                    <div className="text-[10px]" style={{ color: C.textDim }}>年比較データがまだ読み込まれていません。ダッシュボードを一度開いてから、しばらくしてお試しください。</div>
                                  )}
                                </div>
                              ) : (
                                <>
                                  <textarea defaultValue={itemsToText(sc.visual.items)} key={sc.id + JSON.stringify(sc.visual.items)} onBlur={(e) => { patchScene(sc.id, { visual: normalizeVisual({ ...sc.visual, items: textToItems(e.target.value) }) }); previewSceneAt(i); }} rows={Math.max(2, sc.visual.items.length)} className="text-[10px] px-1 py-0.5 rounded mono" style={{ ...inputStyle, resize: "vertical" }} />
                                  <div className="text-[10px]" style={{ color: C.textDim }}>1行1項目：見出し｜数値｜説明｜アイコン（枠の外をクリックで反映）。アイコン：{ICON_NAMES.join(", ")}</div>
                                </>
                              )}
                              <input value={sc.visual.source} onChange={(e) => patchVisual(sc.id, { source: e.target.value })} placeholder="出典（数値を使う場合は必須）" className="text-[10px] px-1 py-0.5 rounded" style={inputStyle} />
                              {sc.visual.imagePrompt && (
                                <div className="text-[10px] flex items-start gap-1" style={{ color: C.textDim }}>
                                  <span className="flex-1">画像生成用のプロンプト案：{sc.visual.imagePrompt}</span>
                                  <button onClick={() => copyText(sc.visual.imagePrompt)} title="コピー" style={{ color: C.teal, background: "none", border: "none", cursor: "pointer" }}><Copy size={10} /></button>
                                </div>
                              )}
                            </div>
                          )}
                          {aiOpenId === sc.id && (
                            <div className="mt-1.5 pt-1.5 flex items-center gap-1.5" style={{ borderTop: `1px solid ${C.borderSoft}` }}>
                              <input autoFocus value={aiText} onChange={(e) => setAiText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !aiBusy) runSceneAi(sc.id); }} placeholder="例：もっとやさしく／流れ図にして／数字を入れて短く" className="flex-1 text-[11px] rounded px-2 py-1" style={{ ...inputStyle, background: C.panel }} />
                              <button onClick={() => runSceneAi(sc.id)} disabled={aiBusy || !aiText.trim()} className="text-[10px] px-2 py-1 rounded" style={{ ...btn("primary"), opacity: aiBusy || !aiText.trim() ? 0.5 : 1 }}>{aiBusy ? "生成中…" : "送信"}</button>
                            </div>
                          )}
                          {narrAiOpenId === sc.id && (
                            <div className="mt-1.5 pt-1.5 flex flex-col gap-1" style={{ borderTop: `1px solid ${C.borderSoft}` }}>
                              <div className="flex items-center gap-1.5">
                                <input autoFocus value={narrAiText} onChange={(e) => setNarrAiText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !narrAiBusy) runNarrationAi(sc.id); }} placeholder="空欄のまま送信で、別の言い回しを1つ提案します（例：もっと短く／やさしい言葉で）" className="flex-1 text-[11px] rounded px-2 py-1" style={{ ...inputStyle, background: C.panel }} />
                                <button onClick={() => runNarrationAi(sc.id)} disabled={narrAiBusy} className="text-[10px] px-2 py-1 rounded" style={{ ...btn("primary"), opacity: narrAiBusy ? 0.5 : 1 }}>{narrAiBusy ? "生成中…" : "送信"}</button>
                              </div>
                              <div className="text-[10px]" style={{ color: C.textDim }}>図解（スライド）は変えず、ナレーションだけを書き直します。</div>
                              {narrAiError && <div className="text-[10px]" style={{ color: "#ff6b6b" }}>{narrAiError}</div>}
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

                {/* 章タイトル（ヘッダー右側に表示。長尺のみ。既定では折りたたみ） */}
                {format === "long" && project.chapters?.length > 0 && (
                  <Section title="章タイトル（ヘッダー右側に表示）" right={
                    <button onClick={() => setChaptersOpen((v) => !v)} className="text-[10px] flex items-center gap-0.5" style={{ color: C.textDim, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                      {chaptersOpen ? "閉じる" : "開く"}<ChevronRight size={10} style={{ transform: chaptersOpen ? "rotate(90deg)" : "none" }} />
                    </button>
                  }>
                    {chaptersOpen && (
                      <>
                        <div className="text-[10px] mb-1.5" style={{ color: C.textDim }}>画面右上に出る見出しです。今プレビュー中の場面の章に応じて切り替わります。</div>
                        <div className="flex flex-col gap-1">
                          {project.chapters.map((ch, i) => {
                            const example = scenes.find((s) => s.chapter === i && s.visual.kind !== "chapter")?.caption || "";
                            return (
                              <div key={i} className="flex items-center gap-1.5">
                                <span className="text-[10px] shrink-0" style={{ color: C.textDim, width: 44 }}>第{i + 1}章</span>
                                <input
                                  value={ch.title}
                                  onChange={(e) => { const v = e.target.value; setProject((p) => ({ ...p, chapters: p.chapters.map((c, idx) => (idx === i ? { ...c, title: v } : c)) })); }}
                                  className="flex-1 min-w-0 text-[11px] px-1.5 py-0.5 rounded"
                                  style={inputStyle}
                                />
                                {example && <span className="text-[10px] shrink-0" style={{ color: C.textDim, maxWidth: 160, whiteSpace: "normal", wordBreak: "break-word" }} title={example}>{example}</span>}
                              </div>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </Section>
                )}

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

                {/* Stage F-3：平日朝の自動配信（タスクスケジューラ）用の設定引き継ぎ */}
                <Section title="自動配信用の設定引き継ぎ">
                  <div className="text-[10px] leading-relaxed mb-1.5" style={{ color: C.textDim }}>
                    平日朝の自動実行は、この画面とは別の専用Chromeプロファイルで動きます。声・アバター・BGM・背景などの設定を変えたら、このボタンで引き継いでください（自動実行の曜日・時刻・モードの設定は、すぐ下の「平日朝の自動配信」で行います）。
                  </div>
                  <button onClick={handleExportProfileForAutorun} disabled={profileSnapshotBusy} className="text-[11px] px-2.5 py-1 rounded flex items-center gap-1" style={{ ...btn(), opacity: profileSnapshotBusy ? 0.6 : 1 }}>
                    <Upload size={11} /> {profileSnapshotBusy ? "引き継ぎ中…" : "自動実行用に今の設定を引き継ぐ"}
                  </button>
                  {profileSnapshotNote && <div className="text-[10px] mt-1" style={{ color: profileSnapshotNote.startsWith("⚠") ? C.rust : C.teal }}>{profileSnapshotNote}</div>}
                </Section>

                {/* Stage F-5：平日朝の自動配信（タスクスケジューラ）の設定パネル（最小構成） */}
                <Section title="平日朝の自動配信" right={<button onClick={() => setAutoScheduleOpen((v) => !v)} className="text-[10px] px-1.5 py-0.5 rounded" style={btn()}>{autoScheduleOpen ? "閉じる" : "開く"}</button>}>
                  {autoScheduleOpen ? <AutoScheduleStudio colors={C} btn={btn} /> : <div className="text-[10px]" style={{ color: C.textDim }}>曜日・時刻・「プレビューまで／動画生成まで」を設定してWindowsのタスクスケジューラに登録します。</div>}
                </Section>

                {/* YouTube */}
                <Section title={format === "long" ? "YouTube（本編）の投稿情報" : "YouTube（ショート）の投稿情報"}>
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-1">
                      <input value={format === "long" ? project.youtube.title : project.youtube.shortTitle} onChange={(e) => patchYoutube(format === "long" ? { title: e.target.value } : { shortTitle: e.target.value })} className="flex-1 px-1.5 py-1 rounded text-[11px]" style={inputStyle} />
                      {/* 長尺はコピー時に「【ラベル】タイトル」の形にする（ファイル名・概要欄の【タイトル】と同じ形。入力欄自体はラベル無しのまま編集できる） */}
                      <button onClick={() => copyText(format === "long" ? exportNames().title : project.youtube.shortTitle)} title={format === "long" ? "動画名称（【ラベル】タイトル）をコピー" : "タイトルをコピー"} style={{ color: C.teal, background: "none", border: "none", cursor: "pointer" }}><Copy size={12} /></button>
                    </div>
                    {format === "long" && project.kicker?.trim() && <div className="text-[10px]" style={{ color: C.textDim }}>動画名称：【{project.kicker.trim()}】{project.youtube.title}</div>}
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
      {genBusy && genProgress && <GenProgressPanel step={genProgress.step} done={genProgress.done} total={genProgress.total} elapsedSec={genElapsedSec} onAbort={() => abortRef.current?.abort()} />}
      {refImgLibOpen && (
        <LibraryPickerModal
          images={images}
          imageEls={imageEls}
          selectedIds={libSelectedIds}
          setSelectedIds={setLibSelectedIds}
          onConfirm={() => addScreenshotsFromLibrary(images.filter((im) => libSelectedIds.has(im.id)))}
          onClose={() => { setRefImgLibOpen(false); setLibSelectedIds(new Set()); }}
        />
      )}
    </div>
  );
}
