"use client";

// [ポリゴン風に加工] 場面の画像を、三角形の面で塗り分けたポリゴン（ローポリ）風の絵にする。
// ①ブラウザ内の加工（無料・すぐ・細かさを調整できる）と、②AI（Gemini）で描き直す加工（1回ごとに課金）の2通り。
// 元の画像は画像ライブラリに残し、加工した画像を新しく保存して場面に付け替える（呼び出し側の onApply）。
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Check, Sparkles, AlertTriangle } from "lucide-react";
import { lowPolyImage, AI_LOWPOLY_PROMPT } from "@/lib/explainer/lowPoly";
import { generateImage } from "@/lib/explainer/imageClient";

const C = {
  panel: "#111A2C", panel2: "#0D1424", border: "#22304C", borderSoft: "#1A2540",
  text: "#E7ECF3", textMuted: "#8592AC", textDim: "#56637F", teal: "#45C4B0", amber: "#D9A24B", bg: "#0A0F1C",
};
const ghost = { background: "transparent", color: C.teal, border: `1px solid ${C.teal}66`, cursor: "pointer" };
const primary = { background: C.teal, color: C.bg, fontWeight: 700, border: "none", cursor: "pointer" };

/** AIに渡す元画像（長辺1536pxまでのJPEG・base64） */
async function toJpegBase64(blob) {
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, 1536 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement("canvas");
  cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
  cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
  const url = cv.toDataURL("image/jpeg", 0.9);
  return { mimeType: "image/jpeg", data: url.split(",")[1] };
}

export default function LowPolyModal({ image, credit, aspect = "16:9", onApply, onClose }) {
  const [detail, setDetail] = useState(500); // 既定は顔の細部が分からない程度の粗さ
  const [edgeWeight, setEdgeWeight] = useState(0.75);
  const [mode, setMode] = useState("local"); // local | ai
  const [result, setResult] = useState(null); // {blob, url}
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [srcUrl, setSrcUrl] = useState("");
  const aiResultRef = useRef(null);
  const noDerivs = credit && /\bND\b|NoDerivs|改変禁止/i.test(`${credit.source || ""} ${credit.credit || ""}`);

  useEffect(() => { const u = URL.createObjectURL(image); setSrcUrl(u); return () => URL.revokeObjectURL(u); }, [image]);
  const show = (blob) => setResult((old) => { if (old?.url) URL.revokeObjectURL(old.url); return blob ? { blob, url: URL.createObjectURL(blob) } : null; });
  useEffect(() => () => { if (result?.url) URL.revokeObjectURL(result.url); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ブラウザ内の加工：設定を変えるたびに作り直す（少し待ってから）
  useEffect(() => {
    if (mode !== "local" || noDerivs) return;
    let live = true;
    setBusy("加工中…"); setError("");
    const t = setTimeout(async () => {
      try { const b = await lowPolyImage(image, { detail, edgeWeight }); if (live) show(b); }
      catch (e) { if (live) setError(e?.message || String(e)); }
      finally { if (live) setBusy(""); }
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [image, detail, edgeWeight, mode, noDerivs]);

  const runAi = async () => {
    setMode("ai"); setBusy("AIで加工中…（20秒ほど）"); setError("");
    try {
      const src = await toJpegBase64(image);
      const b = await generateImage(AI_LOWPOLY_PROMPT, aspect, undefined, src);
      aiResultRef.current = b; show(b);
    } catch (e) {
      setError(e?.message || String(e));
    } finally { setBusy(""); }
  };

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 flex items-center justify-center p-3" style={{ zIndex: 1000, background: "rgba(0,0,0,.8)" }} onClick={onClose}>
      <div className="flex w-full flex-col overflow-hidden rounded-lg" style={{ maxHeight: "96vh", maxWidth: 1500, background: C.panel, border: `1px solid ${C.border}` }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 p-4" style={{ borderBottom: `1px solid ${C.border}` }}>
          <div className="mr-auto text-lg" style={{ color: C.text }}>ポリゴン風に加工</div>
          <button className="text-sm px-3 py-1.5 rounded flex items-center gap-1" style={{ ...primary, opacity: !result || busy || noDerivs ? 0.5 : 1 }} disabled={!result || !!busy || noDerivs} onClick={() => onApply(result.blob, mode)}><Check size={14} />この画像を使う</button>
          <button className="text-sm px-3 py-1.5 rounded flex items-center gap-1" style={ghost} onClick={onClose}><X size={14} />閉じる</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 flex flex-col gap-3">
          {noDerivs ? (
            <div className="text-sm flex items-center gap-2" style={{ color: C.amber }}><AlertTriangle size={16} />この画像は「改変禁止（ND）」のライセンスのため、加工できません。別の画像を使ってください。</div>
          ) : (
            <div className="flex flex-wrap items-center gap-4 text-xs" style={{ color: C.textMuted }}>
              <label className="flex items-center gap-2">細かさ
                <input type="range" min={150} max={4000} step={50} value={detail} onChange={(e) => { setMode("local"); setDetail(Number(e.target.value)); }} style={{ width: 200 }} />
                <b style={{ color: C.text, width: 64 }}>{detail}点</b>
              </label>
              <label className="flex items-center gap-2">輪郭に沿わせる
                <input type="range" min={0.3} max={0.95} step={0.05} value={edgeWeight} onChange={(e) => { setMode("local"); setEdgeWeight(Number(e.target.value)); }} style={{ width: 140 }} />
                <b style={{ color: C.text }}>{Math.round(edgeWeight * 100)}%</b>
              </label>
              <button className="px-2.5 py-1 rounded flex items-center gap-1" style={{ ...ghost, opacity: busy ? 0.5 : 1 }} disabled={!!busy} onClick={runAi} title="Google Gemini で画像をポリゴン風に描き直します（1回ごとに課金）"><Sparkles size={12} />AIで加工（Gemini）</button>
              {mode === "ai" && aiResultRef.current && <button className="px-2.5 py-1 rounded" style={{ ...ghost, color: C.textMuted, borderColor: C.borderSoft }} onClick={() => setMode("local")}>ブラウザ内の加工に戻す</button>}
              <span style={{ color: C.textDim }}>{busy || (mode === "ai" ? "AIで加工した画像" : "ブラウザ内で加工（無料）。点を少なくするほど大きな三角形になり、顔などの細部が分からなくなります。")}</span>
            </div>
          )}
          {error && <div className="text-xs" style={{ color: "#ff6b6b" }}>{error}</div>}
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
            <figure className="flex flex-col gap-1">
              <div className="rounded overflow-hidden flex items-center justify-center" style={{ background: "#000", aspectRatio: "16 / 10" }}>{srcUrl && <img src={srcUrl} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />}</div>
              <figcaption className="text-[11px]" style={{ color: C.textDim }}>元の画像（画像ライブラリに残ります）</figcaption>
            </figure>
            <figure className="flex flex-col gap-1">
              <div className="rounded overflow-hidden flex items-center justify-center" style={{ background: "#000", aspectRatio: "16 / 10", opacity: busy ? 0.6 : 1 }}>{result && <img src={result.url} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />}</div>
              <figcaption className="text-[11px]" style={{ color: C.textDim }}>加工後{mode === "ai" ? "（AI）" : ""}</figcaption>
            </figure>
          </div>
          <div className="text-[11px] leading-relaxed p-2 rounded" style={{ color: C.textMuted, background: C.panel2, border: `1px solid ${C.borderSoft}` }}>
            <b style={{ color: C.amber }}>肖像権について：</b>ポリゴン風にしても、誰だか分かる絵であれば肖像権・パブリシティ権の問題が無くなるとは限りません。
            人物の顔が分からない程度まで粗くする（点を少なくする）、ニュースの論評に必要な範囲で使う、私人や子どもの顔は使わない、といった配慮をしてください。
            また元の写真のライセンスは加工後も引き継がれます（CC BY・CC BY-SA は作者の表示が必要で、CC BY-SA は加工した画像も同じライセンスになります。概要欄には「ポリゴン風に加工」と自動で記載します）。
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
