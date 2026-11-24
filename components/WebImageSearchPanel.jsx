"use client";

// [Web画像検索] スライドに人物・建物・地名などが出てくるとき、通常の画像検索（Google・Bing。著作権フリーに限らない）を
// 別のタブで開き、見つけた画像を「画面を撮影」または「貼り付け（Win+Shift+S で切り取った画像）」で取り込む。
// 取り込んだ画像はそのまま加工（ポリゴン風／ボカシ）の画面へ進む（呼び出し側の onImage）。
// ネット上の画像は著作権・肖像権があるため、加工しないまま使うと注意を表示する（呼び出し側）。
import { useEffect, useRef, useState } from "react";
import { Search, X, ExternalLink, Camera, ClipboardPaste, AlertTriangle } from "lucide-react";
import ScreenCaptureCrop from "@/components/ScreenCaptureCrop";

const C = {
  bg: "#0A0F1C", panel: "#111A2C", panel2: "#0D1424", border: "#22304C", borderSoft: "#1A2540",
  text: "#E7ECF3", textMuted: "#8592AC", textDim: "#56637F", teal: "#45C4B0", amber: "#D9A24B",
};
const ghost = { background: "transparent", color: C.teal, border: `1px solid ${C.teal}66`, cursor: "pointer" };
const primary = { background: C.teal, color: C.bg, fontWeight: 700, border: "none", cursor: "pointer" };
const inputStyle = { background: C.panel2, border: `1px solid ${C.borderSoft}`, color: C.text };

const KIND = { person: "人物", building: "建物", place: "地名", org: "組織", other: "" };
export const searchUrl = (engine, q) => engine === "bing"
  ? `https://www.bing.com/images/search?q=${encodeURIComponent(q)}`
  : `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(q)}`;

/** 画面（ブラウザのタブ・ウィンドウ）を1枚撮影してPNGにする */
async function captureScreen() {
  if (!navigator.mediaDevices?.getDisplayMedia) throw new Error("このブラウザは画面の撮影に対応していません。Win+Shift+S で切り取って「貼り付け」を使ってください。");
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: "browser" }, audio: false, selfBrowserSurface: "exclude", preferCurrentTab: false });
  try {
    const v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.srcObject = stream;
    await v.play();
    // 共有を始めた直後は画面が描かれていないことがあるため、少し待ってから撮る
    await new Promise((r) => setTimeout(r, 450));
    const cv = document.createElement("canvas");
    cv.width = v.videoWidth; cv.height = v.videoHeight;
    cv.getContext("2d").drawImage(v, 0, 0);
    return await new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error("撮影できませんでした"))), "image/png"));
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}

/** クリップボードの画像を読む（Win+Shift+S で切り取った画像など） */
async function readClipboardImage() {
  if (!navigator.clipboard?.read) throw new Error("このブラウザはクリップボードの読み取りに対応していません。この画面で Ctrl+V を押してください。");
  const items = await navigator.clipboard.read();
  for (const it of items) {
    const t = it.types.find((x) => x.startsWith("image/"));
    if (t) return await it.getType(t);
  }
  throw new Error("クリップボードに画像がありません。Win+Shift+S で画像の部分を切り取ってから押してください。");
}

export default function WebImageSearchPanel({ texts, defaultQuery = "", extractNames, onImage, onClose }) {
  const [names, setNames] = useState([]);
  const [namesBusy, setNamesBusy] = useState(false);
  const [query, setQuery] = useState(defaultQuery);
  const [source, setSource] = useState("");
  const [shot, setShot] = useState(null); // 撮影・貼り付けた画像（切り抜き前）
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const touched = useRef(false);

  // 開いたときに、スライドの文から人物・建物・地名を取り出して検索語の候補にする
  useEffect(() => {
    let live = true;
    if (!extractNames) return;
    setNamesBusy(true);
    extractNames(texts).then((list) => {
      if (!live) return;
      setNames(list);
      if (list[0] && !touched.current) setQuery(list[0].query);
    }).catch(() => {}).finally(() => { if (live) setNamesBusy(false); });
    return () => { live = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // この画面を開いているあいだは Ctrl+V で画像を貼り付けられる
  useEffect(() => {
    const onPaste = (e) => {
      if (shot) return;
      const f = Array.from(e.clipboardData?.items || []).find((x) => x.type.startsWith("image/"))?.getAsFile();
      if (f) { e.preventDefault(); setError(""); setShot(f); }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [shot]);

  const open = (engine) => { if (query.trim()) window.open(searchUrl(engine, query.trim()), "_blank", "noopener"); };
  const doCapture = async () => {
    setError(""); setBusy("撮影する画面（画像検索のタブ）を選んでください…");
    try { setShot(await captureScreen()); }
    catch (e) { if (e?.name !== "NotAllowedError") setError(e?.message || String(e)); }
    finally { setBusy(""); }
  };
  const doPaste = async () => {
    setError("");
    try { setShot(await readClipboardImage()); }
    catch (e) { setError(e?.name === "NotAllowedError" ? "クリップボードの読み取りが許可されませんでした。この画面で Ctrl+V を押してください。" : (e?.message || String(e))); }
  };
  const done = (blob) => {
    const src = source.trim();
    let pageUrl, siteName = src;
    if (/^https?:\/\//i.test(src)) { pageUrl = src; try { siteName = new URL(src).hostname.replace(/^www\./, ""); } catch (e) { /* ignore */ } }
    const credit = { source: siteName || "Web上の画像", caption: query.trim() || undefined, ...(pageUrl ? { pageUrl } : {}), web: true };
    const file = new File([blob], `web-${Date.now()}.png`, { type: "image/png" });
    setShot(null);
    onImage(file, credit);
  };

  return (
    <div className="mt-1 p-2 rounded flex flex-col gap-1.5 text-[11px]" style={{ background: C.panel, border: `1px solid ${C.borderSoft}`, color: C.text }}>
      <div className="flex items-center gap-2">
        <Search size={12} style={{ color: C.teal }} />
        <b>Web画像検索（著作権フリーに限らない通常の画像検索）</b>
        <button onClick={onClose} className="ml-auto" style={{ color: C.textDim, background: "none", border: "none", cursor: "pointer" }}><X size={12} /></button>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <span style={{ color: C.textDim }}>スライドの人物・建物・地名：</span>
        {namesBusy && <span style={{ color: C.textDim }}>確認中…</span>}
        {!namesBusy && !names.length && <span style={{ color: C.textDim }}>見つかりませんでした（検索語を入力してください）</span>}
        {names.map((n) => (
          <button key={`${n.name}-${n.query}`} onClick={() => { touched.current = true; setQuery(n.query); }} className="px-1.5 py-0.5 rounded" style={{ ...ghost, color: query === n.query ? C.bg : C.teal, background: query === n.query ? C.teal : "transparent" }} title={`検索語：${n.query}`}>
            {n.name}{KIND[n.kind] ? `（${KIND[n.kind]}）` : ""}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <span style={{ color: C.textMuted }}>①</span>
        <input value={query} onChange={(e) => { touched.current = true; setQuery(e.target.value); }} onKeyDown={(e) => { if (e.key === "Enter") open("google"); }} placeholder="検索語" className="px-1.5 py-0.5 rounded w-56" style={inputStyle} />
        <button onClick={() => open("google")} disabled={!query.trim()} className="px-2 py-0.5 rounded flex items-center gap-1" style={{ ...primary, opacity: query.trim() ? 1 : 0.5 }}><ExternalLink size={11} />Googleで画像検索</button>
        <button onClick={() => open("bing")} disabled={!query.trim()} className="px-2 py-0.5 rounded flex items-center gap-1" style={ghost}><ExternalLink size={11} />Bing</button>
        <span style={{ color: C.textDim }}>別のタブで開きます。使いたい画像を大きく表示してから、このタブに戻ってください。</span>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <span style={{ color: C.textMuted }}>②</span>
        <button onClick={doCapture} disabled={!!busy} className="px-2 py-0.5 rounded flex items-center gap-1" style={{ ...primary, opacity: busy ? 0.5 : 1 }} title="画像検索のタブを選んで1枚撮影し、使う範囲を選んでから加工の画面へ進みます"><Camera size={11} />画面を撮影して取り込む</button>
        <button onClick={doPaste} className="px-2 py-0.5 rounded flex items-center gap-1" style={ghost} title="Win+Shift+S で切り取った画像を貼り付けます（この画面で Ctrl+V でも可）"><ClipboardPaste size={11} />貼り付け（Win+Shift+S）</button>
        <span style={{ color: C.textDim }}>{busy || "取り込んだら、そのまま「ポリゴン風／ボカシ」の加工へ進みます。"}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <span style={{ color: C.textMuted }}>出典</span>
        <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="画像を載せているサイト名またはURL（概要欄とスライドに表示）" className="px-1.5 py-0.5 rounded flex-1 min-w-[220px]" style={inputStyle} />
      </div>
      <div className="flex items-start gap-1 leading-snug" style={{ color: C.amber }}>
        <AlertTriangle size={11} className="shrink-0 mt-0.5" />
        <span>検索で見つかる画像の多くは著作権があり、人物の写真には肖像権もあります。ポリゴン風やボカシに加工しても権利がなくなるわけではありません。報道・論評に必要な範囲で使い、出典を書き、利用条件が示されているサイトはそれに従ってください。</span>
      </div>
      {error && <div style={{ color: "#ff6b6b" }}>{error}</div>}
      {shot && <ScreenCaptureCrop image={shot} onDone={done} onRetake={() => { setShot(null); doCapture(); }} onClose={() => setShot(null)} />}
    </div>
  );
}
