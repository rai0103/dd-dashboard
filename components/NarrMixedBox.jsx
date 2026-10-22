"use client";
import { useEffect, useRef } from "react";
import { changedMask } from "@/lib/videoNarrText";

// 通常の文章の枠。表示文から変えた（ひらがなにした）箇所を緑の文字で示す
// readUpTo（文字数。null/undefinedなら無効）を渡すと、そこまでを「読み上げ済み」として背景をハイライトし、まだの部分は少し薄く表示する（再生に合わせて文字を追えるように）
export default function NarrMixedBox({ value, base, onChange, onBlur, colors, readUpTo = null }) {
  const ta = useRef(null);
  const mir = useRef(null);
  useEffect(() => {
    if (ta.current) { ta.current.style.height = "auto"; ta.current.style.height = `${ta.current.scrollHeight + 2}px`; }
    if (mir.current) {
      const esc = (x) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const mask = changedMask(base, value);
      let o = "", run = "", on = false, onRead = false;
      const fl = () => {
        if (!run) return;
        const st = [];
        if (on) st.push("color:#2ee6b8", "font-weight:600");
        if (readUpTo != null) { if (onRead) st.push("background:rgba(46,230,184,0.25)", "border-radius:2px"); else st.push("opacity:0.5"); }
        o += st.length ? `<span style="${st.join(";")}">${esc(run)}</span>` : esc(run);
        run = "";
      };
      for (let i = 0; i < value.length; i++) {
        const m = !!mask[i];
        const r = readUpTo != null && i < readUpTo;
        if (m !== on || r !== onRead) { fl(); on = m; onRead = r; }
        run += value[i];
      }
      fl();
      mir.current.innerHTML = o + " ";
    }
  });
  const pad = { padding: "6px", fontSize: 11, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "inherit" };
  return (
    <div style={{ position: "relative" }}>
      <div ref={mir} aria-hidden style={{ ...pad, position: "absolute", inset: 0, overflow: "hidden", color: colors.text, border: "1px solid transparent", pointerEvents: "none" }} />
      <textarea
        ref={ta}
        value={value}
        spellCheck={false}
        rows={2}
        onChange={(e) => onChange(e.target.value.replace(/\n/g, ""))}
        onBlur={onBlur}
        style={{ ...pad, position: "relative", display: "block", width: "100%", background: "transparent", border: `1px solid ${colors.border}`, borderRadius: 4, color: "transparent", caretColor: colors.text, resize: "none", overflow: "hidden", minHeight: 44 }}
      />
    </div>
  );
}
