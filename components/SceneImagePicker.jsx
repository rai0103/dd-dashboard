"use client";

// [ライブラリから選ぶ（場面の画像）] 画像ライブラリを大きな画面で見比べて選ぶ（フリー素材の検索と同じ使い勝手）。
// クリックで採用、🔍で全画面に拡大（← → で前後・Enterで採用）、名前・説明での絞り込み、PCのファイルからの追加もここでできる。
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X, Check, ChevronLeft, ChevronRight, Search, Upload } from "lucide-react";

const C = {
  panel: "#111A2C", panel2: "#0D1424", border: "#22304C", borderSoft: "#1A2540",
  text: "#E7ECF3", textMuted: "#8592AC", textDim: "#56637F", teal: "#45C4B0", amber: "#D9A24B", bg: "#0A0F1C",
};
const ghost = { background: "transparent", color: C.teal, border: `1px solid ${C.teal}66`, cursor: "pointer" };
const primary = { background: C.teal, color: C.bg, fontWeight: 700, border: "none", cursor: "pointer" };
const fmtDate = (t) => { if (!t) return ""; const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const labelOf = (im) => im.caption || im.name || "";

function Lightbox({ items, index, srcOf, onClose, onAdopt }) {
  const [i, setI] = useState(index);
  const m = items[i];
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
      if (e.key === "ArrowRight") setI((x) => Math.min(items.length - 1, x + 1));
      if (e.key === "ArrowLeft") setI((x) => Math.max(0, x - 1));
      if (e.key === "Enter" && m) onAdopt(m);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [items.length, m, onAdopt, onClose]);
  if (!m) return null;
  const el = srcOf(m.id);
  return createPortal(
    <div className="fixed inset-0 flex flex-col" style={{ zIndex: 1100, background: "rgba(0,0,0,.95)" }} onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div className="flex items-center gap-3 px-5 py-3" onClick={(e) => e.stopPropagation()}>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm" style={{ color: C.amber }}>{labelOf(m)}{el?.naturalWidth ? ` ・ ${el.naturalWidth}×${el.naturalHeight}` : ""}</div>
          <div className="truncate text-xs" style={{ color: "#cfd6e3" }}>{m.credit ? `${m.credit.source}${m.credit.credit ? ` ／ ${m.credit.credit}` : ""}` : m.name}{m.createdAt ? `（${fmtDate(m.createdAt)}）` : ""}</div>
        </div>
        <span className="text-xs" style={{ color: C.textMuted }}>{i + 1} / {items.length}（← → で切り替え・Enterで採用）</span>
        <button className="text-sm px-3 py-1.5 rounded flex items-center gap-1" style={primary} onClick={() => onAdopt(m)}><Check size={14} />この画像を使う</button>
        <button className="text-sm px-3 py-1.5 rounded" style={ghost} onClick={onClose}>閉じる</button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-16 pb-6" onClick={(e) => e.stopPropagation()}>
        {i > 0 && <button className="absolute left-4 rounded-full px-3 py-3" style={{ background: "rgba(255,255,255,.1)", color: "#fff", border: "none", cursor: "pointer" }} onClick={() => setI(i - 1)}><ChevronLeft size={28} /></button>}
        {el && <img src={el.src} alt="" style={{ maxHeight: "100%", maxWidth: "100%", objectFit: "contain", borderRadius: 4 }} />}
        {i < items.length - 1 && <button className="absolute right-4 rounded-full px-3 py-3" style={{ background: "rgba(255,255,255,.1)", color: "#fff", border: "none", cursor: "pointer" }} onClick={() => setI(i + 1)}><ChevronRight size={28} /></button>}
      </div>
    </div>,
    document.body,
  );
}

/**
 * props: title（場面の見出し）, images（画像ライブラリ）, imageEls（id→読み込み済みの<img>）, usedIds（他の場面で使用中のid）,
 * onPick(id), onUpload(file), onClose()
 */
export default function SceneImagePicker({ title, images, imageEls, usedIds, onPick, onUpload, onClose }) {
  const [q, setQ] = useState("");
  const [zoom, setZoom] = useState(null);
  const list = useMemo(() => {
    const all = images.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const k = q.trim().toLowerCase();
    return k ? all.filter((im) => `${labelOf(im)} ${im.name || ""} ${im.credit?.source || ""} ${im.credit?.caption || ""}`.toLowerCase().includes(k)) : all;
  }, [images, q]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && zoom === null) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom, onClose]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 flex items-center justify-center p-3" style={{ zIndex: 1000, background: "rgba(0,0,0,.8)" }} onClick={onClose}>
      <div className="flex w-full flex-col overflow-hidden rounded-lg" style={{ height: "96vh", maxWidth: 1800, background: C.panel, border: `1px solid ${C.border}` }} onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-wrap items-center gap-3 p-4" style={{ borderBottom: `1px solid ${C.border}` }}>
          <div className="mr-auto min-w-0">
            <div className="text-xs" style={{ color: C.textMuted }}>画像ライブラリから選ぶ{title ? ` — ${title}` : ""}</div>
            <div className="truncate text-lg" style={{ color: C.text }}>{images.length}枚の画像{q.trim() ? `（「${q.trim()}」で絞り込み：${list.length}枚）` : ""}</div>
          </div>
          <label className="flex items-center gap-1 text-sm px-2 py-1.5 rounded" style={{ background: C.panel2, border: `1px solid ${C.borderSoft}` }}>
            <Search size={14} style={{ color: C.textMuted }} />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="名前・説明で絞り込み" style={{ width: 260, background: "transparent", border: "none", outline: "none", color: C.text }} />
          </label>
          <label className="text-sm px-3 py-1.5 rounded flex items-center gap-1 cursor-pointer" style={ghost}><Upload size={14} />PCのファイルを選ぶ
            <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onUpload(f); }} />
          </label>
          <button className="text-sm px-3 py-1.5 rounded flex items-center gap-1" style={ghost} onClick={onClose}><X size={14} />閉じる</button>
        </div>
        <div className="px-4 pt-3 text-xs" style={{ color: C.textMuted }}>クリックで採用／🔍で拡大（← → で次の画像）。新しく保存した画像ほど先頭に並びます。</div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {list.length ? (
            <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gridAutoRows: "max-content" }}>
              {list.map((im, i) => (
                <div key={im.id} className="group relative overflow-hidden rounded-md" style={{ border: `1px solid ${C.borderSoft}`, background: C.panel2 }}>
                  <button className="block w-full text-left" onClick={() => onPick(im.id)} style={{ padding: 0, border: "none", background: "none", cursor: "pointer" }}>
                    <div style={{ aspectRatio: "16 / 9", background: "#000" }}>
                      {imageEls[im.id] && <img src={imageEls[im.id].src} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
                    </div>
                    <div className="p-1.5" style={{ lineHeight: 1.35 }}>
                      <div className="text-[11px]" style={{ color: "#cfd6e3", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{labelOf(im) || "—"}</div>
                      <div className="flex items-center gap-1 text-[10px]" style={{ color: C.textDim }}>
                        <span className="truncate">{im.credit ? im.credit.source : "自分の画像・AI生成"}</span>
                        <span className="ml-auto shrink-0">{fmtDate(im.createdAt)}</span>
                      </div>
                    </div>
                  </button>
                  {usedIds?.has(im.id) && <span className="absolute text-[10px] px-1.5 py-0.5 rounded" style={{ left: 6, top: 6, background: "rgba(0,0,0,.7)", color: C.amber }}>使用中</span>}
                  <button title="拡大して見る" onClick={(e) => { e.stopPropagation(); setZoom(i); }} className="absolute rounded px-1.5 py-0.5 text-xs opacity-0 group-hover:opacity-100" style={{ right: 6, top: 6, background: "rgba(0,0,0,.7)", color: "#fff", border: "none", cursor: "pointer", transition: "opacity .15s" }}>🔍</button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm py-10 text-center" style={{ color: C.textDim }}>{images.length ? "絞り込みに合う画像がありません。" : "まだ画像ライブラリに何もありません。「PCのファイルを選ぶ」から追加できます。"}</div>
          )}
        </div>
      </div>
      {zoom !== null && <Lightbox items={list} index={zoom} srcOf={(id) => imageEls[id]} onClose={() => setZoom(null)} onAdopt={(im) => onPick(im.id)} />}
    </div>,
    document.body,
  );
}
