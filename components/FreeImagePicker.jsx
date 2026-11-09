"use client";

// [フリー素材を検索] 検索結果を大きな画面で見比べて選ぶ（日本文化動画アプリの KeywordResultsModal・MediaGrid・
// Lightbox と同じ使い勝手）。サムネイルも tts-server 経由（/api/free-image-proxy）で読み込む
// （外部サイトの直リンクだと表示されない画像があるため）。🔍で全画面に拡大、← → で前後、Enterで採用。
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Search, X, ExternalLink, ChevronLeft, ChevronRight, Check } from "lucide-react";
import { proxiedUrl } from "@/lib/explainer/freeImageClient";

const C = {
  bg: "#0A0F1C", panel: "#111A2C", panel2: "#0D1424", border: "#22304C", borderSoft: "#1A2540",
  text: "#E7ECF3", textMuted: "#8592AC", textDim: "#56637F", teal: "#45C4B0", amber: "#D9A24B",
};
const ghost = { background: "transparent", color: C.teal, border: `1px solid ${C.teal}66`, cursor: "pointer" };
const primary = { background: C.teal, color: C.bg, fontWeight: 700, border: "none", cursor: "pointer" };

function Thumb({ c }) {
  const [src, setSrc] = useState(() => proxiedUrl(c.thumbnailUrl || c.url, c.id));
  const [failed, setFailed] = useState(false);
  useEffect(() => { setSrc(proxiedUrl(c.thumbnailUrl || c.url, c.id)); setFailed(false); }, [c.id, c.thumbnailUrl, c.url]);
  // サムネイルが取れない作品（サイズ指定の違い等）は、本体の画像で表示し直す。それも駄目なら「表示できません」
  const onError = () => {
    const full = proxiedUrl(c.url, c.id);
    if (src !== full) setSrc(full); else setFailed(true);
  };
  return failed ? (
    <div className="flex items-center justify-center text-[11px]" style={{ width: "100%", height: "100%", color: C.textDim }}>プレビューを表示できません</div>
  ) : (
    <img src={src} alt={c.caption || ""} loading="lazy" onError={onError} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
  );
}

function Lightbox({ items, index, onClose, onAdopt, busyId }) {
  const [i, setI] = useState(index);
  const [loaded, setLoaded] = useState(false);
  const m = items[i];
  useEffect(() => { setLoaded(false); }, [m?.id]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
      if (e.key === "ArrowRight") setI((x) => Math.min(items.length - 1, x + 1));
      if (e.key === "ArrowLeft") setI((x) => Math.max(0, x - 1));
      if (e.key === "Enter" && m && !busyId) onAdopt(m);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [items.length, m, onAdopt, onClose, busyId]);
  if (!m || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 flex flex-col" style={{ zIndex: 1100, background: "rgba(0,0,0,.95)" }} onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div className="flex items-center gap-3 px-5 py-3" onClick={(e) => e.stopPropagation()}>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm" style={{ color: C.amber }}>{m.source}{m.width && m.height ? ` ・ ${m.width}×${m.height}` : ""}</div>
          <div className="truncate text-xs" style={{ color: "#cfd6e3" }}>{m.caption || "—"}{m.credit ? ` ／ ${m.credit}` : ""}</div>
        </div>
        {m.pageUrl && <a href={m.pageUrl} target="_blank" rel="noreferrer" className="text-xs flex items-center gap-1" style={{ color: C.textMuted }}>元のページ（ライセンス確認）<ExternalLink size={12} /></a>}
        <span className="text-xs" style={{ color: C.textMuted }}>{i + 1} / {items.length}（← → で切り替え・Enterで採用）</span>
        <button className="text-sm px-3 py-1.5 rounded flex items-center gap-1" style={{ ...primary, opacity: busyId ? 0.5 : 1 }} disabled={!!busyId} onClick={() => onAdopt(m)}><Check size={14} />{busyId === m.id ? "取り込み中…" : "この画像を使う"}</button>
        <button className="text-sm px-3 py-1.5 rounded" style={ghost} onClick={onClose}>閉じる</button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-16 pb-6" onClick={(e) => e.stopPropagation()}>
        {i > 0 && <button className="absolute left-4 rounded-full px-3 py-3" style={{ background: "rgba(255,255,255,.1)", color: "#fff", border: "none", cursor: "pointer" }} onClick={() => setI(i - 1)}><ChevronLeft size={28} /></button>}
        {!loaded && <div className="absolute text-sm" style={{ color: C.textMuted }}>読み込み中…</div>}
        <img key={m.id} src={proxiedUrl(m.url, m.id)} alt={m.caption || ""} onLoad={() => setLoaded(true)} onError={() => setLoaded(true)} style={{ maxHeight: "100%", maxWidth: "100%", objectFit: "contain", borderRadius: 4, opacity: loaded ? 1 : 0 }} />
        {i < items.length - 1 && <button className="absolute right-4 rounded-full px-3 py-3" style={{ background: "rgba(255,255,255,.1)", color: "#fff", border: "none", cursor: "pointer" }} onClick={() => setI(i + 1)}><ChevronRight size={28} /></button>}
      </div>
    </div>,
    document.body,
  );
}

/**
 * props: title（場面の見出し）, query/setQuery, busy, items, terms, error, pickId（取り込み中の候補id）,
 * onSearch(), onPick(candidate), onClose()
 */
export default function FreeImagePicker({ title, query, setQuery, busy, items, terms, error, pickId, onSearch, onPick, onClose }) {
  const [zoom, setZoom] = useState(null);
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
            <div className="text-xs" style={{ color: C.textMuted }}>フリー素材を検索{title ? ` — ${title}` : ""}</div>
            <div className="truncate text-lg" style={{ color: C.text }}>{query ? `「${query}」の検索結果` : "キーワードを入れて検索"}</div>
          </div>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (query.trim()) onSearch(); }}>
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="別のキーワードで検索（日本語OK。例：日本銀行、原油、半導体）" className="text-sm px-2 py-1.5 rounded" style={{ width: 360, background: C.panel2, border: `1px solid ${C.borderSoft}`, color: C.text }} />
            <button type="submit" disabled={busy || !query.trim()} className="text-sm px-3 py-1.5 rounded flex items-center gap-1" style={{ ...primary, opacity: busy || !query.trim() ? 0.5 : 1 }}><Search size={14} />{busy ? "検索中…" : "検索"}</button>
          </form>
          <button className="text-sm px-3 py-1.5 rounded flex items-center gap-1" style={ghost} onClick={onClose}><X size={14} />閉じる</button>
        </div>
        <div className="px-4 pt-3 text-xs leading-relaxed" style={{ color: C.textMuted }}>
          {busy ? "検索中…" : `${items.length}件 — クリックで採用／🔍で拡大（← → で次の画像）`}
          {terms.length > 0 && <span>　英語でも検索：{terms.join(" / ")}</span>}
          <div style={{ color: C.textDim }}>美術館（CC0）・Wikimedia Commons・Wikipedia・Openverse など日本文化チャンネルと同じ検索先から、パブリックドメイン・CC0・商用可のCCライセンス・無料素材だけを表示します。出典は概要欄に自動で記載します。</div>
          {error && <div style={{ color: "#ff6b6b" }}>{error}</div>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gridAutoRows: "max-content" }}>
            {items.map((c, i) => (
              <div key={c.id} className="group relative overflow-hidden rounded-md" style={{ border: `1px solid ${pickId === c.id ? C.teal : C.borderSoft}`, background: C.panel2, opacity: pickId && pickId !== c.id ? 0.5 : 1 }}>
                <button className="block w-full text-left" disabled={!!pickId} onClick={() => onPick(c)} style={{ padding: 0, border: "none", background: "none", cursor: pickId ? "wait" : "pointer" }}>
                  <div style={{ aspectRatio: "16 / 9", background: "#000", position: "relative" }}>
                    <Thumb c={c} />
                    {pickId === c.id && <span className="text-xs" style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,.6)", color: "#fff" }}>取り込み中…</span>}
                  </div>
                  <div className="p-1.5" style={{ lineHeight: 1.35 }}>
                    <div className="truncate text-[10px] font-medium" style={{ color: C.amber }}>{c.source}</div>
                    <div className="text-[10px]" style={{ color: "#b9c2d3", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{c.caption || "—"}</div>
                  </div>
                </button>
                <button title="拡大して見る" onClick={(e) => { e.stopPropagation(); setZoom(i); }} className="absolute rounded px-1.5 py-0.5 text-xs opacity-0 group-hover:opacity-100" style={{ right: 6, top: 6, background: "rgba(0,0,0,.7)", color: "#fff", border: "none", cursor: "pointer", transition: "opacity .15s" }}>🔍</button>
              </div>
            ))}
          </div>
        </div>
      </div>
      {zoom !== null && <Lightbox items={items} index={zoom} busyId={pickId} onClose={() => setZoom(null)} onAdopt={(c) => onPick(c)} />}
    </div>,
    document.body,
  );
}
