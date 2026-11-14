"use client";
// 自動ドラフト：毎朝の自動生成の設定（本数・時刻・予約テーマ）と、できたドラフトの取り込み
import { useEffect, useState } from "react";
import { getDraftState, importDraft, saveDraftSchedule } from "@/lib/explainer/autoDraft";

const fmt = (t) => (t ? new Date(t).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

export default function DraftPanel({ C, disabled, minutes, onOpen, hasProject = false, onSaveProfile = null }) {
  const [open, setOpen] = useState(false);
  const [sch, setSch] = useState(null);
  const [text, setText] = useState("");
  const [status, setStatus] = useState(null);
  const [drafts, setDrafts] = useState([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const st = await getDraftState();
      setSch(st.schedule);
      setText(st.schedule.keywords.map((k) => (k.mode === "keyword" ? `用語：${k.theme}` : k.theme)).join("\n"));
      setStatus(st.status);
      setDrafts(st.drafts || []);
      if ((st.drafts || []).length) setOpen(true);
    } catch (e) {
      setMsg("自動ドラフトの情報を読み込めませんでした（tts-serverが起動しているか確認してください）");
    }
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    // 遠隔予約（「すぐ」）で付いた urgent の印は、同じテーマなら残す
    const urgentThemes = new Set((sch.keywords || []).filter((k) => k.urgent).map((k) => k.theme));
    const keywords = text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
      const m = l.match(/^(用語|キーワード)[:：]\s*(.+)$/);
      const k = m ? { theme: m[2].trim(), mode: "keyword" } : { theme: l, mode: "news" };
      return urgentThemes.has(k.theme) ? { ...k, urgent: true } : k;
    });
    try {
      // 自動生成のChromeは普段のブラウザと設定が別なので、今の設定（声・画像の割合など）も一緒に渡しておく
      if (onSaveProfile) await onSaveProfile().catch(() => {});
      const r = await saveDraftSchedule({ ...sch, keywords, minutes });
      setMsg(r?.task && r.task.ok === false ? `保存しました（タスクの登録に失敗：${r.task.error}）` : `保存しました${sch.enabled ? `（毎日${sch.time}に自動で作ります）` : "（自動生成はオフ）"}`);
      load();
    } catch (e) {
      setMsg(`保存できませんでした：${e.message}`);
    }
  };

  const openDraft = async (d) => {
    // 取り込むとドラフトは「取り込み済み」に移るので、確認は取り込む前に行う
    if (hasProject && !confirm("今の台本を閉じて、ドラフトを開きます。よろしいですか？（今の台本を残したい場合は、先に「台本を保存」を押してください）")) return;
    setBusy(true); setMsg("ドラフトを取り込み中…");
    try {
      const p = await importDraft(d);
      await onOpen(p, d);
      setMsg("取り込みました。");
      load();
    } catch (e) {
      setMsg(`取り込めませんでした：${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const box = { background: C.panel ?? "#111827", border: `1px solid ${C.borderSoft ?? "#334155"}`, borderRadius: 8 };
  const btn = { border: `1px solid ${C.borderSoft ?? "#334155"}`, color: C.text, background: "transparent", cursor: "pointer" };
  const field = { background: C.bg, color: C.text, border: `1px solid ${C.borderSoft ?? "#334155"}`, borderRadius: 4 };
  const ok = status?.results?.filter((r) => r.ok).length ?? 0;
  const ng = status?.results?.filter((r) => !r.ok).length ?? 0;

  return (
    <section className="px-3 py-2 flex flex-col gap-2" style={box}>
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => setOpen((v) => !v)} className="text-sm font-bold" style={{ color: C.teal, background: "transparent", border: "none", cursor: "pointer" }}>{open ? "▾" : "▸"} 自動ドラフト</button>
        <span className="text-[11px]" style={{ color: C.textMuted }}>毎朝、台本と画像まで作って保存</span>
        {drafts.length > 0 && <span className="text-[11px] px-2 rounded" style={{ background: C.amber + "33", color: C.amber }}>できているドラフト {drafts.length}件</span>}
        {status && status.state !== "idle" && (
          <span className="text-[11px] ml-auto" style={{ color: status.state === "error" || ng ? C.amber : C.textMuted }}>
            前回：{fmt(status.startedAt)} {status.state === "running" ? "実行中…" : status.state === "error" ? `エラー：${status.message || ""}` : `成功${ok}件${ng ? `／失敗${ng}件` : ""}`}
          </span>
        )}
      </div>
      {open && (
        <>
          {drafts.map((d) => (
            <div key={d.id} className="flex items-center gap-2 text-xs">
              <div className="flex-1 min-w-0">
                <div className="truncate">{d.title}</div>
                <div className="truncate text-[10px]" style={{ color: C.textMuted }}>{d.mode === "keyword" ? "用語" : "ニュース"}「{d.theme}」・{d.scenes}場面・{fmt(d.createdAt)}{d.source === "reserved" ? "・予約" : ""}</div>
              </div>
              <button onClick={() => openDraft(d)} disabled={disabled || busy} className="text-[11px] px-2 py-1 rounded" style={{ ...btn, opacity: disabled || busy ? 0.5 : 1 }}>開く</button>
            </div>
          ))}
          {sch && (
            <div className="flex flex-col gap-2 pt-1" style={{ borderTop: `1px solid ${C.borderSoft ?? "#334155"}` }}>
              <div className="flex items-center gap-3 text-xs flex-wrap">
                <label className="flex items-center gap-1"><input type="checkbox" checked={sch.enabled} onChange={(e) => setSch({ ...sch, enabled: e.target.checked })} /> 毎朝自動で作る</label>
                <label className="flex items-center gap-1">本数 <input type="number" min={1} max={10} value={sch.count} onChange={(e) => setSch({ ...sch, count: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })} className="w-14 px-1 py-0.5 text-xs" style={field} /></label>
                <label className="flex items-center gap-1">開始時刻 <input type="time" value={sch.time} onChange={(e) => setSch({ ...sch, time: e.target.value })} className="px-1 py-0.5 text-xs" style={field} /></label>
              </div>
              <div className="text-[11px]" style={{ color: C.textMuted }}>予約テーマ（1行に1つ。先に使います。用語解説にしたいときは「用語：NISA」のように書きます）。足りない分は、前日の話題のニュースから自動で選びます。</div>
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} className="px-2 py-1 text-xs" style={field} placeholder={"例：日銀の金融政策決定会合\n用語：インフレ"} />
              <div className="flex items-center gap-2">
                <button onClick={save} disabled={busy} className="text-[11px] px-3 py-1 rounded" style={btn}>予約を保存</button>
                {msg && <span className="text-[11px]" style={{ color: C.textMuted }}>{msg}</span>}
              </div>
            </div>
          )}
          {!sch && msg && <div className="text-[11px]" style={{ color: C.amber }}>{msg}</div>}
        </>
      )}
    </section>
  );
}
