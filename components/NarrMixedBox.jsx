"use client";
import { useEffect, useRef } from "react";
import { changedMask } from "@/lib/videoNarrText";

// 通常の文章の枠。表示文から変えた（ひらがなにした）箇所を緑の文字で示す
export default function NarrMixedBox({ value, base, onChange, onBlur, colors }) {
  const ta = useRef(null);
  const mir = useRef(null);
  useEffect(() => {
    if (ta.current) { ta.current.style.height = "auto"; ta.current.style.height = `${ta.current.scrollHeight + 2}px`; }
    if (mir.current) {
      const esc = (x) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const mask = changedMask(base, value);
      let o = "", run = "", on = false;
      const fl = () => { if (run) o += on ? `<span style="color:#2ee6b8;font-weight:600">${esc(run)}</span>` : esc(run); run = ""; };
      for (let i = 0; i < value.length; i++) { const m = !!mask[i]; if (m !== on) { fl(); on = m; } run += value[i]; }
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
