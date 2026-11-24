"use client";

// [Web画像検索 → スクショ] 撮影した画面（またはクリップボードの画像）から、使う範囲をドラッグで選んで切り抜く。
// onDone(blob) に切り抜いた画像（PNG）を返す。範囲を選ばなければ全体を使う。
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Check, Crop } from "lucide-react";
import { regionFromDrag } from "@/lib/explainer/blur";

const C = {
  bg: "#0A0F1C", panel: "#111A2C", panel2: "#0D1424", border: "#22304C", borderSoft: "#1A2540",
  text: "#E7ECF3", textMuted: "#8592AC", textDim: "#56637F", teal: "#45C4B0", amber: "#D9A24B",
};
const ghost = { background: "transparent", color: C.teal, border: `1px solid ${C.teal}66`, cursor: "pointer" };
const primary = { background: C.teal, color: C.bg, fontWeight: 700, border: "none", cursor: "pointer" };

/** 画像の範囲（0〜1の割合）を切り抜いてPNGにする */
export async function cropBlob(blob, r) {
  const bmp = await createImageBitmap(blob);
  const sx = Math.round((r?.x ?? 0) * bmp.width), sy = Math.round((r?.y ?? 0) * bmp.height);
  const sw = Math.max(1, Math.round((r?.w ?? 1) * bmp.width)), sh = Math.max(1, Math.round((r?.h ?? 1) * bmp.height));
  const cv = document.createElement("canvas");
  cv.width = sw; cv.height = sh;
  cv.getContext("2d").drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh);
  bmp.close?.();
  return await new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error("切り抜けませんでした"))), "image/png"));
}

export default function ScreenCaptureCrop({ image, onDone, onRetake, onClose }) {
  const [url, setUrl] = useState("");
  const [sel, setSel] = useState(null); // {x,y,w,h}（0〜1）
  const [drag, setDrag] = useState(null); // {x0,y0,x1,y1}
  const [busy, setBusy] = useState(false);
  const boxRef = useRef(null);
  useEffect(() => { const u = URL.createObjectURL(image); setUrl(u); return () => URL.revokeObjectURL(u); }, [image]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const rel = (e) => {
    const b = boxRef.current.getBoundingClientRect();
    return { x: (e.clientX - b.left) / b.width, y: (e.clientY - b.top) / b.height };
  };
  const down = (e) => { e.preventDefault(); const p = rel(e); setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }); };
  const move = (e) => { if (!drag) return; const p = rel(e); setDrag((d) => ({ ...d, x1: p.x, y1: p.y })); };
  const up = () => { if (!drag) return; const r = regionFromDrag(drag.x0, drag.y0, drag.x1, drag.y1); setSel(r); setDrag(null); };
  const shown = drag ? regionFromDrag(drag.x0, drag.y0, drag.x1, drag.y1) : sel;
  const finish = async (useSel) => {
    setBusy(true);
    try { onDone(await cropBlob(image, useSel ? sel : null)); } finally { setBusy(false); }
  };
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 flex items-center justify-center p-3" style={{ zIndex: 1000, background: "rgba(0,0,0,.85)" }} onClick={onClose}>
      <div className="flex w-full flex-col overflow-hidden rounded-lg" style={{ maxHeight: "96vh", maxWidth: 1500, background: C.panel, border: `1px solid ${C.border}` }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 p-3 flex-wrap" style={{ borderBottom: `1px solid ${C.border}` }}>
          <div className="mr-auto">
            <div className="text-lg" style={{ color: C.text }}>使う範囲を選ぶ</div>
            <div className="text-xs" style={{ color: C.textMuted }}>画像の上をドラッグして、使う部分を囲んでください（囲まなければ全体を使います）。次に加工（ポリゴン風／ボカシ）の画面へ進みます。</div>
          </div>
          {onRetake && <button className="text-sm px-3 py-1.5 rounded" style={ghost} onClick={onRetake}>撮り直す</button>}
          <button className="text-sm px-3 py-1.5 rounded flex items-center gap-1" style={{ ...primary, opacity: busy ? 0.5 : 1 }} disabled={busy} onClick={() => finish(!!sel)}>{sel ? <><Crop size={14} />この範囲で加工へ</> : <><Check size={14} />全体で加工へ</>}</button>
          <button className="text-sm px-3 py-1.5 rounded flex items-center gap-1" style={ghost} onClick={onClose}><X size={14} />閉じる</button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-3 flex items-start justify-center" style={{ background: "#000" }}>
          <div ref={boxRef} className="relative select-none" style={{ cursor: "crosshair", lineHeight: 0 }} onMouseDown={down} onMouseMove={move} onMouseUp={up} onMouseLeave={up}>
            {url && <img src={url} alt="" draggable={false} style={{ maxWidth: "100%", maxHeight: "80vh", display: "block" }} />}
            {shown && (
              <div className="absolute pointer-events-none" style={{ left: `${shown.x * 100}%`, top: `${shown.y * 100}%`, width: `${shown.w * 100}%`, height: `${shown.h * 100}%`, border: `2px solid ${C.teal}`, boxShadow: "0 0 0 9999px rgba(0,0,0,.55)" }} />
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
