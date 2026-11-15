"use client";

// [画像のサイズ・位置を調整] 場面に付けた画像を、スライドの枠にどう収めるか（全体表示／画面いっぱい・拡大率・位置・ゆっくり寄る動き）を決める。
// プレビューは動画の書き出しと同じ描き方（lib/explainer/visuals.ts の drawFittedImage）で描くので、見えたとおりに動画になる。
// 画像そのものは加工しない（場面の imageFit に見せ方だけを保存する）。
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Check, Maximize, Minimize, RotateCcw, Move } from "lucide-react";
import { drawFittedImage } from "@/lib/explainer/visuals";
import { VISUAL_SIZE } from "@/lib/explainer/renderer";

const C = {
  panel: "#111A2C", panel2: "#0D1424", border: "#22304C", borderSoft: "#1A2540",
  text: "#E7ECF3", textMuted: "#8592AC", textDim: "#56637F", teal: "#45C4B0", amber: "#D9A24B", bg: "#0A0F1C",
};
const ghost = { background: "transparent", color: C.teal, border: `1px solid ${C.teal}66`, cursor: "pointer" };
const primary = { background: C.teal, color: C.bg, fontWeight: 700, border: "none", cursor: "pointer" };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** 自動（imageFitなし）のときと同じ見え方の初期値 */
export function autoFitFor(img, W, H) {
  const iw = img?.naturalWidth || 1, ih = img?.naturalHeight || 1;
  const cover = Math.max(W / iw, H / ih), contain = Math.min(W / iw, H / ih);
  return cover > contain * 1.3 ? { mode: "contain", zoom: 1, x: 0, y: 0, motion: false } : { mode: "cover", zoom: 1, x: 0, y: 0, motion: true };
}

export default function ImageFitModal({ img, fit, heading = "", portrait = false, onApply, onClose }) {
  const { W, H } = portrait ? VISUAL_SIZE.short : VISUAL_SIZE.long;
  const [f, setF] = useState(() => (fit ? { ...fit } : autoFitFor(img, W, H)));
  const [isAuto, setIsAuto] = useState(!fit);
  const [p, setP] = useState(0); // プレビューする時点（0＝場面の始め、1＝終わり）
  const cvRef = useRef(null);
  const drag = useRef(null);
  const set = (patch) => { setIsAuto(false); setF((o) => ({ ...o, ...patch })); };

  useEffect(() => {
    const cv = cvRef.current; if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = W * dpr; cv.height = H * dpr;
    const c = cv.getContext("2d");
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = "#000"; c.fillRect(0, 0, W, H);
    c.save();
    drawFittedImage(c, img, W, H, isAuto ? undefined : f, p, "preview");
    // 動画と同じく、下側を少し暗くして見出しを重ねる
    const g = c.createLinearGradient(0, H * 0.45, 0, H);
    g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,0.75)");
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    c.restore();
    if (heading) { c.font = "bold 22px sans-serif"; c.fillStyle = "#fff"; c.shadowColor = "rgba(0,0,0,.6)"; c.shadowBlur = 6; c.fillText(heading, 20, 36, W - 40); c.shadowBlur = 0; }
  }, [img, f, isAuto, p, W, H, heading]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // ドラッグで位置を動かす（画面上の移動量を、枠の幅・高さの半分＝1 に換算）
  const onDown = (e) => { e.currentTarget.setPointerCapture(e.pointerId); const r = e.currentTarget.getBoundingClientRect(); drag.current = { sx: e.clientX, sy: e.clientY, x: f.x, y: f.y, w: r.width, h: r.height }; };
  const onMove = (e) => { const d = drag.current; if (!d) return; set({ x: clamp(d.x + ((e.clientX - d.sx) / d.w) * 2, -2, 2), y: clamp(d.y + ((e.clientY - d.sy) / d.h) * 2, -2, 2) }); };
  const onUp = () => { drag.current = null; };
  const onWheel = (e) => { set({ zoom: clamp(Math.round((f.zoom * (e.deltaY < 0 ? 1.06 : 1 / 1.06)) * 100) / 100, 0.3, 4) }); };

  if (typeof document === "undefined") return null;
  const modeBtn = (active) => ({ ...(active ? primary : ghost), padding: "6px 12px", borderRadius: 6 });
  return createPortal(
    <div className="fixed inset-0 flex items-center justify-center p-3" style={{ zIndex: 1000, background: "rgba(0,0,0,.8)" }} onClick={onClose}>
      <div className="flex w-full flex-col overflow-hidden rounded-lg" style={{ maxHeight: "96vh", maxWidth: 1200, background: C.panel, border: `1px solid ${C.border}` }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 p-4" style={{ borderBottom: `1px solid ${C.border}` }}>
          <div className="mr-auto text-lg" style={{ color: C.text }}>画像のサイズ・位置を調整</div>
          <button className="text-sm px-3 py-1.5 rounded flex items-center gap-1" style={primary} onClick={() => onApply(isAuto ? undefined : f)}><Check size={14} />この見せ方にする</button>
          <button className="text-sm px-3 py-1.5 rounded flex items-center gap-1" style={ghost} onClick={onClose}><X size={14} />閉じる</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button style={modeBtn(!isAuto && f.mode === "contain")} className="flex items-center gap-1" onClick={() => set({ mode: "contain", zoom: 1, x: 0, y: 0, motion: false })} title="画像全体がスライドに収まるように縮める（余白はぼかした画像で埋めます）"><Minimize size={13} />全体を表示</button>
            <button style={modeBtn(!isAuto && f.mode === "cover")} className="flex items-center gap-1" onClick={() => set({ mode: "cover", zoom: 1, x: 0, y: 0 })} title="スライドいっぱいに広げる（はみ出た端は切れます）"><Maximize size={13} />画面いっぱい</button>
            <button style={modeBtn(isAuto)} className="flex items-center gap-1" onClick={() => { setIsAuto(true); setF(autoFitFor(img, W, H)); }} title="これまでどおり自動で決める（縦横比が大きく違えば全体表示、それ以外は画面いっぱいでゆっくり寄る）"><RotateCcw size={13} />自動</button>
            <label className="flex items-center gap-2 ml-3" style={{ color: C.textMuted }}>大きさ
              <input type="range" min={0.3} max={4} step={0.01} value={f.zoom} onChange={(e) => set({ zoom: Number(e.target.value) })} style={{ width: 220 }} />
              <b style={{ color: C.text, width: 48 }}>{Math.round(f.zoom * 100)}%</b>
            </label>
            <button style={{ ...ghost, padding: "4px 10px", borderRadius: 6 }} onClick={() => set({ x: 0, y: 0 })}>中央に戻す</button>
            <label className="flex items-center gap-1.5 ml-3" style={{ color: C.textMuted }}>
              <input type="checkbox" checked={!!f.motion} onChange={(e) => set({ motion: e.target.checked })} />ゆっくり寄る動き
            </label>
          </div>
          <div className="flex justify-center">
            <canvas ref={cvRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel}
              style={{ width: portrait ? Math.min(420, W * 1.2) : "min(100%, 960px)", aspectRatio: `${W} / ${H}`, borderRadius: 12, border: `1px solid ${C.borderSoft}`, cursor: "grab", touchAction: "none", background: "#000" }} />
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs" style={{ color: C.textMuted }}>
            <span className="flex items-center gap-1"><Move size={12} />画像をドラッグで移動、マウスホイールで拡大・縮小できます。</span>
            {f.motion && !isAuto && (
              <label className="flex items-center gap-2">動きの確認（場面の始め→終わり）
                <input type="range" min={0} max={1} step={0.01} value={p} onChange={(e) => setP(Number(e.target.value))} style={{ width: 160 }} />
              </label>
            )}
            <span style={{ color: C.textDim }}>枠は動画のスライド部分と同じ比率です。画像からはみ出た部分は、ぼかした画像で埋まります。</span>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** 場面一覧のサムネイル：動画と同じ見せ方（imageFit）で画像を小さく描く */
export function FitThumb({ img, fit, portrait = false }) {
  const ref = useRef(null);
  const { W, H } = portrait ? VISUAL_SIZE.short : VISUAL_SIZE.long;
  useEffect(() => {
    const cv = ref.current; if (!cv || !img) return;
    const k = 0.5;
    cv.width = Math.round(W * k); cv.height = Math.round(H * k);
    const c = cv.getContext("2d");
    c.setTransform(k, 0, 0, k, 0, 0);
    c.fillStyle = "#000"; c.fillRect(0, 0, W, H);
    drawFittedImage(c, img, W, H, fit, 0, "thumb");
  }, [img, fit, W, H]);
  return <canvas ref={ref} style={{ width: "100%", height: "100%", objectFit: "contain", display: "block", background: "#000" }} />;
}
