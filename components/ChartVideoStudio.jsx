"use client";
// [グラフ動画] ダッシュボードのグラフを、動きのある動画（長尺16:9＋ショート9:16）にするページ（/chart-video/）。
// 解説動画作成（スライド中心）とは別の機能。まずは「資産形成レポート（年100万円投資で1億円を目指すチャンネル）」。
// ・数字：lib/chartVideo/assetReport.ts（ダッシュボードの保存データから。AIには作らせない）
// ・場面と台本：lib/chartVideo/assetScript.ts（定型文 → 「AIで台本を作る」で語り口を整える）
// ・描画：lib/chartVideo/render.ts（線が伸びる・数字が増える・棒が伸びる等）
// ・声・BGM・録画・保存：解説動画作成と同じ仕組み（AudioMixer・VideoExporter・exportBundle）。声・BGMの選択も共通
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Play, Square, Download, RefreshCw, Sparkles, ChevronRight, Copy, Check, AlertTriangle } from "lucide-react";
import { loadAssetReport } from "@/lib/chartVideo/assetReport";
import { buildAssetProject, refreshFacts, generateAssetScript, CV_PROJECT_VERSION } from "@/lib/chartVideo/assetScript";
import { drawCVFrame, sceneDurations, sceneAt, CV_SIZE } from "@/lib/chartVideo/render";
import { AudioMixer, getTtsBaseUrl } from "@/lib/videoAudioMixer";
import { listAivisVoices, isAivisVoice } from "@/lib/videoAivisClient";
import { listBgms } from "@/lib/videoBgmLibrary";
import { VideoExporter } from "@/lib/videoExporter";
import { canPickFolder, getSavedFolder, pickFolder, ensureWritable, saveBundle, safeFileName, descriptionText } from "@/lib/explainer/exportBundle";
import { fixHaForTts } from "@/lib/explainer/kanaFix";
import { applyTermReadings } from "@/lib/explainer/scriptModel";
import { loadReadingDict, applyReadingDict, applyReadingDictToText } from "@/lib/explainer/readingDict";

const C = {
  bg: "#0A0F1C", panel: "#111A2C", panel2: "#0D1424", border: "#22304C", borderSoft: "#1A2540",
  text: "#E7ECF3", textMuted: "#8592AC", textDim: "#56637F", teal: "#45C4B0", amber: "#D9A24B", rust: "#C0654B",
};
const btn = (v = "ghost") => v === "primary"
  ? { background: C.teal, color: C.bg, fontWeight: 700, border: "none", cursor: "pointer" }
  : v === "amber" ? { background: C.amber, color: C.bg, fontWeight: 700, border: "none", cursor: "pointer" }
  : { background: "transparent", color: C.teal, border: `1px solid ${C.teal}66`, cursor: "pointer" };
const inputStyle = { background: C.panel2, border: `1px solid ${C.borderSoft}`, color: C.text };
const PROJECT_KEY = "chart-video-asset-v1";
const RATE_KEY = "chart-video-rate-v1";
const fmtTime = (sec) => { const s = Math.max(0, Math.round(sec || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
// 音声を作る前の長さの見積もり（1秒に7文字くらい）
const estSec = (sc, rate) => (sc.narration ? sc.narration.length / (7 * (rate || 1)) : 0);
// 音声合成に渡す文：読み上げ文があればそれ（読み方辞書で補正）、無ければナレーション（辞書の語を読みに置き換える）
const ttsText = (sc) => applyTermReadings(sc.reading ? fixHaForTts(applyReadingDict(sc.reading, sc.narration), sc.narration) : applyReadingDictToText(sc.narration));

export default function ChartVideoStudio() {
  // ---------------- データ ----------------
  const [report, setReport] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [proj, setProj] = useState(null);
  const [note, setNote] = useState("");
  const reload = async () => {
    setLoading(true); setLoadError("");
    const { report: r, error } = await loadAssetReport().catch((e) => ({ report: null, error: e?.message || String(e) }));
    setReport(r); setLoadError(error); setLoading(false);
    if (!r) return;
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(PROJECT_KEY) || "null"); } catch (e) { saved = null; }
    if (saved && saved.asOf === r.asOf && saved.long && saved.short && saved.version === CV_PROJECT_VERSION) setProj(saved);
    else if (saved && saved.long) {
      setProj(refreshFacts(saved, r));
      setNote(saved.version !== CV_PROJECT_VERSION ? "場面の構成が新しくなった（銘柄シェアの円グラフを追加・銘柄名を略称に）ので、台本を作り直しました。" : `データが新しくなった（${r.asOf}時点）ので、台本を今の数字で作り直しました。`);
    }
    else setProj(buildAssetProject(r));
  };
  useEffect(() => { reload(); loadReadingDict(getTtsBaseUrl).catch(() => {}); }, []);
  useEffect(() => { if (proj) { try { localStorage.setItem(PROJECT_KEY, JSON.stringify(proj)); } catch (e) { /* ignore */ } } }, [proj]);

  const [format, setFormat] = useState("long");
  const scenes = useMemo(() => (proj ? proj[format].filter((s) => s.enabled) : []), [proj, format]);
  const patchScene = (key, patch) => setProj((p) => ({ ...p, [format]: p[format].map((s) => (s.key === key ? { ...s, ...patch } : s)) }));
  const resetScript = () => { if (report && confirm("台本を定型文に戻します（AIで作った文・手で直した文は消えます）。よろしいですか？")) setProj(buildAssetProject(report)); };

  // ---------------- 声・BGM（解説動画作成と共通の選択） ----------------
  const mixerRef = useRef(null);
  const mixer = () => (mixerRef.current ??= new AudioMixer());
  const [voices, setVoices] = useState([]);
  const [voice, setVoiceState] = useState(() => { try { return localStorage.getItem("video-voice-v1") || ""; } catch (e) { return ""; } });
  const setVoice = (v) => { setVoiceState(v); try { localStorage.setItem("video-voice-v1", v); } catch (e) { /* ignore */ } };
  const [rate, setRateState] = useState(() => { try { return Number(localStorage.getItem(RATE_KEY)) || 1.0; } catch (e) { return 1.0; } });
  const setRate = (v) => { setRateState(v); try { localStorage.setItem(RATE_KEY, String(v)); } catch (e) { /* ignore */ } };
  const refreshVoices = async () => {
    const sv = await mixer().listServerVoices().catch(() => []);
    const av = await listAivisVoices(4000).catch(() => []);
    const all = [...sv, ...av];
    setVoices(all);
    if (all.length && !all.includes(voice)) setVoice(all[0]);
  };
  useEffect(() => { refreshVoices(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const fallbackVoice = voices.find((v) => !isAivisVoice(v)) ?? "";
  const [bgms, setBgms] = useState([]);
  const [bgmId, setBgmIdState] = useState(() => { try { return localStorage.getItem("video-bgm-v1") || ""; } catch (e) { return ""; } });
  const setBgmId = (v) => { setBgmIdState(v); try { localStorage.setItem("video-bgm-v1", v); } catch (e) { /* ignore */ } };
  const [bgmVolume, setBgmVolume] = useState(20);
  useEffect(() => { listBgms(true).then(setBgms).catch(() => {}); }, []);
  const [bgmUrl, setBgmUrl] = useState(null);
  useEffect(() => { const b = bgms.find((x) => x.id === bgmId); if (!b) { setBgmUrl(null); return; } const u = URL.createObjectURL(b.blob); setBgmUrl(u); return () => URL.revokeObjectURL(u); }, [bgms, bgmId]);
  const [subtitles, setSubtitles] = useState(true);

  // ---------------- 音声の準備 ----------------
  const [narrSecs, setNarrSecs] = useState({}); // 場面のkey → ナレーションの秒数（作った音声の長さ）
  const [ttsError, setTtsError] = useState("");
  const prepareAudio = async (list, onStep) => {
    setTtsError("");
    const bufs = [];
    let v = voice, failed = 0;
    for (let i = 0; i < list.length; i++) {
      try {
        const { buffer, usedFallback } = await mixer().fetchNarrationBufferSmart(ttsText(list[i]), rate, v, 1.0, fallbackVoice);
        if (usedFallback && fallbackVoice) { v = fallbackVoice; setVoice(fallbackVoice); }
        bufs.push(buffer);
      } catch (e) { console.error("TTS error", e); bufs.push(null); failed++; }
      onStep?.(i + 1, list.length);
    }
    if (failed) setTtsError(`${failed}場面のナレーション音声を作れませんでした。ローカルTTSサーバー（npm run dev:video）またはAivisSpeechが起動しているか確認してください。`);
    const secs = bufs.map((b) => (b ? b.duration : null));
    setNarrSecs((m) => ({ ...m, ...Object.fromEntries(list.map((s, i) => [`${s.key}|${s.narration}|${s.reading}|${rate}`, secs[i]])) }));
    const durs = sceneDurations(list, secs);
    const starts = []; durs.reduce((a, d) => { starts.push(a); return a + d; }, 0);
    return { bufs, durs, starts, total: durs.reduce((a, b) => a + b, 0) };
  };
  // 画面上の長さ：作った音声があればその長さ、無ければ文字数からの見積もり
  const durs = useMemo(() => sceneDurations(scenes, scenes.map((s) => narrSecs[`${s.key}|${s.narration}|${s.reading}|${rate}`] ?? (estSec(s, rate) || null))), [scenes, narrSecs, rate]);
  const total = durs.reduce((a, b) => a + b, 0);

  // ---------------- プレビュー ----------------
  const canvasRef = useRef(null);
  const [seek, setSeek] = useState(0); // 秒
  const [playing, setPlaying] = useState(false);
  const [prep, setPrep] = useState("");
  const rafRef = useRef(0);
  const size = CV_SIZE[format];
  const drawAt = (time) => {
    const cv = canvasRef.current;
    if (!cv || !report || !scenes.length) return;
    drawCVFrame(cv.getContext("2d"), size.w, size.h, { report, scenes, durs, subtitles }, time);
  };
  // 止まっているあいだは毎回描き直す（先頭のときは、何も出ていない1コマ目ではなく、表紙がそろったところを見せる）
  useEffect(() => { if (!playing) drawAt(seek < 0.05 && durs.length ? durs[0] * 0.92 : Math.min(seek, Math.max(0, total - 0.05))); });
  const curIdx = scenes.length ? sceneAt(durs, seek).i : 0;
  const jumpTo = (i) => { const st = durs.slice(0, i).reduce((a, b) => a + b, 0); setSeek(st + durs[i] * 0.92); };
  const stop = () => { cancelAnimationFrame(rafRef.current); mixer().stopNarration(); mixer().stopBGM(); setPlaying(false); setPrep(""); };
  const play = async () => {
    if (!scenes.length || playing) return;
    stop();
    setPrep("ナレーション音声を準備中…");
    const pr = await prepareAudio(scenes, (k, n) => setPrep(`ナレーション音声を準備中…（${k}/${n}）`));
    setPrep("");
    const from = seek >= pr.total - 0.1 ? 0 : seek;
    pr.bufs.forEach((b, i) => {
      if (!b) return;
      const at = pr.starts[i] + 0.4 - from;
      if (at >= 0) mixer().playBufferAfter(b, at);
    });
    if (bgmUrl) await mixer().playBGM(bgmUrl, bgmVolume, true);
    setPlaying(true);
    const t0 = performance.now() - from * 1000;
    const tick = () => {
      const tt = (performance.now() - t0) / 1000;
      const cv = canvasRef.current;
      if (cv) drawCVFrame(cv.getContext("2d"), size.w, size.h, { report, scenes, durs: pr.durs, subtitles }, Math.min(tt, pr.total - 0.02));
      setSeek(tt);
      if (tt < pr.total) rafRef.current = requestAnimationFrame(tick);
      else { mixer().fadeBGM(1); setPlaying(false); }
    };
    rafRef.current = requestAnimationFrame(tick);
  };
  useEffect(() => () => stop(), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { stop(); setSeek(0); }, [format]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------- AIで台本 ----------------
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const runAi = async () => {
    if (!report || !proj) return;
    setAiBusy(true); setAiError("");
    try { setProj(await generateAssetScript(report, proj)); setNote("AIで台本を作りました。数字はダッシュボードのデータのままです。"); }
    catch (e) { setAiError(e?.message || String(e)); }
    finally { setAiBusy(false); }
  };

  // ---------------- 書き出し（長尺＋ショート） ----------------
  const [withShort, setWithShort] = useState(true);
  const [exportStage, setExportStage] = useState("");
  const [exportNote, setExportNote] = useState("");
  const recordOne = async (fmt) => {
    const list = proj[fmt].filter((s) => s.enabled);
    if (!list.length) throw new Error("場面がありません");
    const sz = CV_SIZE[fmt];
    const canvas = document.createElement("canvas");
    canvas.width = sz.w; canvas.height = sz.h;
    Object.assign(canvas.style, { position: "fixed", left: "0", top: "0", width: "2px", height: "2px", opacity: "0", pointerEvents: "none", zIndex: "-1" });
    document.body.appendChild(canvas);
    const label = fmt === "short" ? "ショート" : "長尺";
    const exporter = new VideoExporter();
    let handle = null;
    try {
      const pr = await prepareAudio(list, (k, n) => setExportStage(`${label}：ナレーション音声を準備中（${k}/${n}）`));
      const ctx = canvas.getContext("2d");
      const frame = { report, scenes: list, durs: pr.durs, subtitles };
      // サムネイル：表紙の場面がそろったところ
      drawCVFrame(ctx, sz.w, sz.h, { ...frame, subtitles: false }, pr.durs[0] * 0.9);
      const thumb = await new Promise((res) => canvas.toBlob(res, "image/png"));
      const audioStream = mixer().startRecordingTap();
      if (bgmUrl) await mixer().playBGM(bgmUrl, bgmVolume, true);
      handle = exporter.startRecording(canvas, audioStream, 30);
      setExportStage(`${label}：録画中`);
      // 録画の出だしが乱れないよう、1コマ目を少し録ってから始める
      await new Promise((resolve) => { let n = 0; const warm = () => { drawCVFrame(ctx, sz.w, sz.h, frame, 0); if (++n < 9) requestAnimationFrame(warm); else resolve(); }; requestAnimationFrame(warm); });
      await new Promise((resolve) => {
        const t0 = performance.now();
        pr.bufs.forEach((b, i) => { if (b) mixer().playBufferAfter(b, pr.starts[i] + 0.4); });
        let done = false, fading = false, lastUi = 0;
        const finish = () => { if (done) return; done = true; if (!fading) mixer().fadeBGM(0.2); resolve(); };
        setTimeout(finish, pr.total * 1000 + 300); // タブが裏に回っても終わるように
        const tick = () => {
          if (done) return;
          const el = (performance.now() - t0) / 1000;
          drawCVFrame(ctx, sz.w, sz.h, frame, Math.min(el, pr.total - 0.02));
          if (performance.now() - lastUi > 300) { lastUi = performance.now(); setExportStage(`${label}：録画中 ${Math.min(100, Math.round((el / pr.total) * 100))}%`); }
          if (!fading && el >= pr.total - 1.2) { fading = true; mixer().fadeBGM(1.2); }
          if (el < pr.total) requestAnimationFrame(tick); else finish();
        };
        requestAnimationFrame(tick);
      });
      await new Promise((r) => setTimeout(r, 400));
      const ext = handle.extension;
      const blob = await handle.stop(); handle = null;
      mixer().stopBGM(); mixer().stopRecordingTap();
      const y = proj.youtube;
      const title = fmt === "short" ? y.shortTitle : y.title;
      const base = safeFileName(`${fmt === "short" ? "ショート_" : ""}資産形成レポート_${report.asOf}`, "グラフ動画");
      return [
        { name: `${base}.${ext}`, blob },
        ...(thumb ? [{ name: `${base}_サムネ.png`, blob: thumb }] : []),
        { name: `${base}_概要欄.txt`, blob: new Blob(["﻿" + descriptionText(title, y.description + (fmt === "short" ? "\n#shorts" : ""), y.tags)], { type: "text/plain;charset=utf-8" }) },
      ];
    } finally {
      if (handle) { try { await handle.stop(); } catch (e) { /* ignore */ } }
      mixer().stopRecordingTap();
      canvas.remove();
    }
  };
  const exportAll = async () => {
    if (!proj || !report || exportStage) return;
    stop();
    let folder = null;
    if (canPickFolder()) {
      folder = await getSavedFolder("chart-video");
      if (!folder || !(await ensureWritable(folder))) folder = await pickFolder("chart-video");
    }
    const fmts = withShort ? ["long", "short"] : [format];
    mixer().setSpeakerOutput(false);
    setExportNote("");
    const where = [];
    try {
      for (const f of fmts) {
        const files = await recordOne(f);
        const w = await saveBundle(folder && (await ensureWritable(folder)) ? folder : null, safeFileName(`資産形成レポート_${report.asOf}`, "グラフ動画"), files);
        where.push(`${w || "ダウンロードフォルダ"}（${files.map((x) => x.name).join("、")}）`);
      }
      setExportNote(`保存しました：${where.join(" ／ ")}`);
    } catch (e) {
      alert(`書き出しエラー：${e?.message || e}`);
    } finally {
      mixer().setSpeakerOutput(true); mixer().stopBGM();
      setExportStage("");
    }
  };

  // ---------------- 画面 ----------------
  const [openReading, setOpenReading] = useState({});
  const [copied, setCopied] = useState("");
  const copy = (k, t) => { navigator.clipboard?.writeText(t).then(() => { setCopied(k); setTimeout(() => setCopied(""), 1500); }).catch(() => {}); };
  const yen = (v) => `¥${Math.round(v).toLocaleString("ja-JP")}`;

  return (
    <div className="min-h-screen" style={{ background: C.bg, color: C.text }}>
      <div className="max-w-[1500px] mx-auto px-4 py-3">
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <a href={`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/`} className="text-xs flex items-center gap-1" style={{ color: C.textMuted }}><ArrowLeft size={12} />ダッシュボード</a>
          <h1 className="text-lg font-bold">グラフ動画</h1>
          <span className="text-xs" style={{ color: C.textDim }}>ダッシュボードのグラフを、動きのある動画（長尺16:9＋ショート9:16）にします</span>
        </div>
        <div className="flex items-center gap-2 mb-3 flex-wrap text-xs">
          <span style={{ color: C.textMuted }}>レポート</span>
          <button className="px-2.5 py-1 rounded" style={btn("primary")}>資産形成レポート（年100万円）</button>
          <button className="px-2.5 py-1 rounded" style={{ ...btn(), opacity: 0.45, cursor: "default" }} title="準備中">S&P500詳細レポート（準備中）</button>
          <button onClick={reload} className="ml-auto px-2 py-1 rounded flex items-center gap-1" style={btn()}><RefreshCw size={11} />データを読み直す</button>
        </div>
        {loading && <div className="text-sm" style={{ color: C.textMuted }}>データを読み込み中…</div>}
        {loadError && <div className="text-sm flex items-center gap-1" style={{ color: C.amber }}><AlertTriangle size={14} />{loadError}</div>}
        {report && proj && (
          <>
            <div className="text-[11px] mb-2 flex flex-wrap gap-x-4 gap-y-1" style={{ color: C.textMuted }}>
              <span>{report.asOf} 時点（{report.source === "screenshot" ? "スクショ取込" : "投資収支xlsx"}）</span>
              <span>評価額 <b style={{ color: C.text }}>{yen(report.value)}</b></span>
              <span>元本 <b style={{ color: C.text }}>{yen(report.principal)}</b></span>
              <span>損益 <b style={{ color: report.pl >= 0 ? C.teal : C.rust }}>{report.pl >= 0 ? "+" : "−"}{yen(Math.abs(report.pl))}</b></span>
              <span>銘柄 {report.holdings.length}／推移 {report.points.length}点</span>
            </div>
            {note && <div className="text-[11px] mb-2" style={{ color: C.teal }}>{note}</div>}
            <div className="grid gap-4" style={{ gridTemplateColumns: "minmax(0, 1.25fr) minmax(0, 1fr)" }}>
              {/* 左：プレビュー */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  {[["long", "長尺（16:9）"], ["short", "ショート（9:16）"]].map(([k, l]) => (
                    <button key={k} onClick={() => setFormat(k)} className="text-xs px-3 py-1 rounded" style={format === k ? btn("primary") : btn()}>{l}・{proj[k].filter((s) => s.enabled).length}場面</button>
                  ))}
                  <span className="text-[11px] ml-auto" style={{ color: total > 60 && format === "short" ? C.amber : C.textDim }}>{fmtTime(seek)} / {fmtTime(total)}{format === "short" && total > 60 ? "（ショートは60秒以内がおすすめ）" : ""}</span>
                </div>
                <div className="rounded overflow-hidden flex justify-center" style={{ background: "#000", border: `1px solid ${C.borderSoft}` }}>
                  <canvas ref={canvasRef} width={size.w} height={size.h} style={format === "long" ? { width: "100%", aspectRatio: "16 / 9" } : { height: 620, aspectRatio: "9 / 16" }} />
                </div>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  {playing || prep
                    ? <button onClick={stop} className="text-xs px-3 py-1 rounded flex items-center gap-1" style={btn("primary")}><Square size={12} />{prep || "停止"}</button>
                    : <button onClick={play} disabled={!scenes.length || !!exportStage} className="text-xs px-3 py-1 rounded flex items-center gap-1" style={btn("primary")}><Play size={12} />再生</button>}
                  <button onClick={() => { stop(); setSeek(0); }} className="text-xs px-2 py-1 rounded" style={btn()}>先頭へ</button>
                  <button onClick={exportAll} disabled={!!exportStage || playing} className="text-xs px-3 py-1 rounded flex items-center gap-1" style={{ ...btn("amber"), opacity: exportStage ? 0.6 : 1 }}><Download size={12} />{exportStage || (withShort ? "長尺＋ショートを書き出す" : "書き出す")}</button>
                  <label className="text-[11px] flex items-center gap-1" style={{ color: C.textMuted }}><input type="checkbox" checked={withShort} onChange={(e) => setWithShort(e.target.checked)} />ショートも</label>
                  <label className="text-[11px] flex items-center gap-1" style={{ color: C.textMuted }}><input type="checkbox" checked={subtitles} onChange={(e) => setSubtitles(e.target.checked)} />字幕</label>
                </div>
                <input type="range" min={0} max={Math.max(0.1, total)} step={0.05} value={Math.min(seek, total)} onChange={(e) => { stop(); setSeek(Number(e.target.value)); }} className="w-full mt-2" />
                {exportNote && <div className="text-[11px] mt-1" style={{ color: C.teal }}>{exportNote}</div>}
                {ttsError && <div className="text-[11px] mt-1" style={{ color: C.amber }}>{ttsError}</div>}
                <div className="mt-3 p-2 rounded flex flex-col gap-2 text-[11px]" style={{ background: C.panel, border: `1px solid ${C.borderSoft}`, color: C.textMuted }}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span>声</span>
                    <select value={voice} onChange={(e) => setVoice(e.target.value)} className="px-1.5 py-0.5 rounded max-w-[260px]" style={inputStyle}>
                      {!voices.length && <option value="">（声が見つかりません）</option>}
                      {voices.map((v) => <option key={v} value={v}>{v.replace(/^aivis:\d+:/, "Aivis：").replace(/^(sapi|oc):/, "")}</option>)}
                    </select>
                    <button onClick={refreshVoices} className="px-1.5 py-0.5 rounded" style={btn()}>声の一覧を更新</button>
                    <span className="ml-2">速さ</span>
                    <input type="range" min={0.8} max={1.4} step={0.05} value={rate} onChange={(e) => setRate(Number(e.target.value))} />
                    <b style={{ color: C.text }}>{rate.toFixed(2)}x</b>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span>BGM</span>
                    <select value={bgmId} onChange={(e) => setBgmId(e.target.value)} className="px-1.5 py-0.5 rounded max-w-[260px]" style={inputStyle}>
                      <option value="">なし</option>
                      {bgms.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                    <span className="ml-2">音量</span>
                    <input type="range" min={0} max={60} step={1} value={bgmVolume} onChange={(e) => setBgmVolume(Number(e.target.value))} />
                    <b style={{ color: C.text }}>{bgmVolume}%</b>
                    <span style={{ color: C.textDim }}>（BGMの追加は解説動画作成の画面で）</span>
                  </div>
                </div>
                <div className="mt-3 p-2 rounded flex flex-col gap-1.5 text-[11px]" style={{ background: C.panel, border: `1px solid ${C.borderSoft}` }}>
                  <div className="font-semibold" style={{ color: C.textMuted }}>YouTubeの投稿情報</div>
                  {[["title", "タイトル（本編）"], ["shortTitle", "タイトル（ショート）"]].map(([k, l]) => (
                    <div key={k} className="flex items-center gap-2">
                      <span className="w-28 shrink-0" style={{ color: C.textDim }}>{l}</span>
                      <input value={proj.youtube[k]} onChange={(e) => setProj((p) => ({ ...p, youtube: { ...p.youtube, [k]: e.target.value } }))} className="flex-1 px-1.5 py-0.5 rounded" style={inputStyle} />
                      <button onClick={() => copy(k, proj.youtube[k])} style={{ color: C.teal, background: "none", border: "none", cursor: "pointer" }}>{copied === k ? <Check size={12} /> : <Copy size={12} />}</button>
                    </div>
                  ))}
                  <textarea value={proj.youtube.description} onChange={(e) => setProj((p) => ({ ...p, youtube: { ...p.youtube, description: e.target.value } }))} rows={4} className="px-1.5 py-1 rounded" style={inputStyle} />
                  <input value={proj.youtube.tags.join(", ")} onChange={(e) => setProj((p) => ({ ...p, youtube: { ...p.youtube, tags: e.target.value.split(/[,、]\s*/).filter(Boolean) } }))} placeholder="タグ（カンマ区切り）" className="px-1.5 py-0.5 rounded" style={inputStyle} />
                </div>
              </div>
              {/* 右：場面と台本 */}
              <div>
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <button onClick={runAi} disabled={aiBusy} className="text-xs px-3 py-1 rounded flex items-center gap-1" style={{ ...btn("primary"), opacity: aiBusy ? 0.6 : 1 }}><Sparkles size={12} />{aiBusy ? "AIで台本を作成中…" : "AIで台本を作る（長尺・ショート）"}</button>
                  <button onClick={resetScript} className="text-xs px-2 py-1 rounded" style={btn()}>定型文に戻す</button>
                  <span className="text-[10px]" style={{ color: C.textDim }}>数字はダッシュボードのデータから入れます（AIは言い回しだけを作ります）</span>
                </div>
                {aiError && <div className="text-[11px] mb-2" style={{ color: C.amber }}>{aiError}</div>}
                <div className="flex flex-col gap-2" style={{ maxHeight: "calc(100vh - 170px)", overflowY: "auto" }}>
                  {proj[format].map((sc) => {
                    const idx = scenes.findIndex((x) => x.key === sc.key);
                    const active = idx >= 0 && idx === curIdx;
                    return (
                      <div key={sc.key} className="p-2 rounded" style={{ background: C.panel, border: `1px solid ${active ? C.teal : C.borderSoft}`, opacity: sc.enabled ? 1 : 0.5 }}>
                        <div className="flex items-center gap-2 mb-1">
                          <input type="checkbox" checked={sc.enabled} onChange={(e) => patchScene(sc.key, { enabled: e.target.checked })} title="この場面を使う" />
                          <input value={sc.heading} onChange={(e) => patchScene(sc.key, { heading: e.target.value })} className="flex-1 text-xs font-semibold px-1.5 py-0.5 rounded" style={inputStyle} />
                          {idx >= 0 && <span className="text-[10px]" style={{ color: C.textDim }}>{durs[idx].toFixed(1)}秒</span>}
                          {idx >= 0 && <button onClick={() => { stop(); jumpTo(idx); }} className="text-[10px] px-1.5 py-0.5 rounded" style={btn()}>表示</button>}
                        </div>
                        <textarea value={sc.narration} onChange={(e) => patchScene(sc.key, { narration: e.target.value.replace(/\n/g, ""), reading: "" })} rows={3} className="w-full text-[11px] px-1.5 py-1 rounded" style={inputStyle} />
                        <button onClick={() => setOpenReading((m) => ({ ...m, [sc.key]: !m[sc.key] }))} className="text-[10px] flex items-center gap-0.5 mt-0.5" style={{ color: sc.reading ? C.textDim : C.amber, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                          読み上げ文{sc.reading ? "" : "（なし：ナレーションをそのまま読みます）"}<ChevronRight size={10} style={{ transform: openReading[sc.key] ? "rotate(90deg)" : "none" }} />
                        </button>
                        {openReading[sc.key] && (
                          <textarea value={sc.reading} onChange={(e) => patchScene(sc.key, { reading: e.target.value.replace(/\n/g, "") })} rows={3} placeholder="ひらがなの読み上げ文（空ならナレーションをそのまま読みます）" className="w-full text-[11px] px-1.5 py-1 rounded mt-1" style={inputStyle} />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
