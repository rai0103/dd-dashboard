"use client";
// 自動ドラフト：毎朝の自動生成の設定（本数・時刻・予約テーマ）と、できたドラフトの取り込み
import { useEffect, useState } from "react";
import { THEME_GENRES } from "@/lib/explainer/autoDraftTheme";
import { getDraftState, importDraft, reopenImported, saveDraftSchedule, setHistorySequel, addDraftHistory, deleteHistory } from "@/lib/explainer/autoDraft";
import { canPickFolder, scanExportedVideos } from "@/lib/explainer/exportBundle";

const ymd = (t) => (t ? new Date(t).toLocaleDateString("ja-JP", { year: "numeric", month: "numeric", day: "numeric" }) : "—");
const SOURCE_LABEL = { auto: "自動", reserved: "予約", sequel: "続編", manual: "手動", past: "書き出し済み", entry: "手入力", backup: "控え" };
const MODE_LABEL = { news: "ニュース", keyword: "用語", weekly: "週次レポート", stock: "株式情報", sp500: "S&P500" };
const fmt = (t) => (t ? new Date(t).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

export default function DraftPanel({ C, disabled, minutes, onOpen, hasProject = false, onSaveProfile = null, onBackup = null, imageSettings = null }) {
  const [open, setOpen] = useState(false);
  const [sch, setSch] = useState(null);
  const [text, setText] = useState("");
  const [status, setStatus] = useState(null);
  const [drafts, setDrafts] = useState([]);
  const [recent, setRecent] = useState([]);
  const [serverOld, setServerOld] = useState(false);
  const [history, setHistory] = useState([]);
  const [histOpen, setHistOpen] = useState(false);
  const [histMsg, setHistMsg] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({ theme: "", title: "", date: "" });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const st = await getDraftState();
      setSch(st.schedule);
      setText(st.schedule.keywords.map((k) => `${k.mode === "keyword" ? `用語：${k.theme}` : k.theme}${k.note ? ` ｜ ${k.note}` : ""}`).join("\n"));
      setStatus(st.status);
      setDrafts(st.drafts || []);
      setRecent(Array.isArray(st.importedDrafts) ? st.importedDrafts : []);
      // 古いtts-server（起動し直す前）は「最近開いた台本」を返さない
      setServerOld(!Array.isArray(st.importedDrafts));
      setHistory(Array.isArray(st.history) ? st.history : []);
      if ((st.drafts || []).length) setOpen(true);
    } catch (e) {
      setMsg("自動ドラフトの情報を読み込めませんでした（tts-serverが起動しているか確認してください）");
    }
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    // 遠隔予約（「すぐ」）で付いた urgent の印は、同じテーマなら残す
    const urgentThemes = new Set((sch.keywords || []).filter((k) => k.urgent).map((k) => k.theme));
    // 「テーマ ｜ 説明」と書くと、説明は台本作成の追加の指示として渡す（テーマ欄は短い見出しのままにする）
    const keywords = text.split("\n").map((l) => l.trim()).filter(Boolean).map((line) => {
      const [l, ...rest] = line.split(/\s*[|｜]\s*/);
      const note = rest.join(" ").trim();
      const m = l.match(/^(用語|キーワード)[:：]\s*(.+)$/);
      const k = { ...(m ? { theme: m[2].trim(), mode: "keyword" } : { theme: l.trim(), mode: "news" }), ...(note ? { note } : {}) };
      return urgentThemes.has(k.theme) ? { ...k, urgent: true } : k;
    }).filter((k) => k.theme);
    try {
      // 自動生成のChromeは普段のブラウザと設定が別なので、今の設定（声・画像の割合など）も一緒に渡しておく
      if (onSaveProfile) await onSaveProfile().catch(() => {});
      // 画像の自動挿入の設定は、予約そのものにも保存する（設定の控えに頼らず、確実に夜間の生成で使う）
      const r = await saveDraftSchedule({ ...sch, keywords, minutes, ...(imageSettings ? { images: imageSettings } : {}) });
      setMsg(r?.task && r.task.ok === false ? `保存しました（タスクの登録に失敗：${r.task.error}）` : `保存しました${sch.enabled ? `（毎日${sch.time}に自動で作ります）` : "（自動生成はオフ）"}`);
      load();
    } catch (e) {
      setMsg(`保存できませんでした：${e.message}`);
    }
  };

  // 今の台本は、閉じる前に控えとしてPCのフォルダに残す（「最近開いた台本」からいつでも戻せる）。残せなかったときだけ確認する
  const keepCurrent = async () => {
    if (!hasProject) return true;
    try { if (onBackup) { await onBackup(); return true; } } catch (e) { /* 下で確認 */ }
    return confirm("今の台本の控えを残せませんでした。今の台本を閉じて開きますか？（残したい場合は、先に「台本を保存」を押してください）");
  };
  const openDraft = async (d, again = false) => {
    if (!(await keepCurrent())) return;
    setBusy(true); setMsg(again ? "台本を開いています…" : "ドラフトを取り込み中…");
    try {
      const p = again ? await reopenImported(d) : await importDraft(d);
      await onOpen(p, d);
      setMsg(hasProject ? "開きました（前の台本は「最近開いた台本」に控えを残しました）。" : "開きました。");
      load();
    } catch (e) {
      setMsg(`取り込めませんでした：${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  // 続編の印を付け外しする（次の自動生成で、そのテーマの続編を新しい情報で作る）
  const toggleSequel = async (h, on) => {
    // 付けるときはその行に、外すときは同じテーマ（シリーズ）の印をすべて外す
    const ids = on ? [h.id] : history.filter((x) => x.theme === h.theme && x.sequel).map((x) => x.id);
    setHistory((list) => list.map((x) => (ids.includes(x.id) ? { ...x, sequel: on || undefined } : x)));
    try { for (const id of ids) await setHistorySequel(id, on); } catch (e) { setMsg(`続編の設定を保存できませんでした：${e.message}`); load(); }
  };
  // これまでに書き出した動画（書き出し先フォルダの「〜_概要欄.txt」）を記録に取り込む。すでに同じタイトルがあるものは飛ばす
  const importExported = async () => {
    if (!canPickFolder()) { setHistMsg("このブラウザではフォルダを読めません（Chrome・Edgeで開いてください）"); return; }
    let dir;
    try { dir = await window.showDirectoryPicker({ id: "explainer-export", mode: "read", startIn: "videos" }); } catch { return; }
    setHistMsg("フォルダを読んでいます…");
    try {
      const vids = await scanExportedVideos(dir);
      const known = new Set([...history.map((h) => h.title), ...history.map((h) => h.theme)].filter(Boolean));
      const seen = new Set();
      const add = vids.filter((v) => { if (known.has(v.title) || seen.has(v.title)) return false; seen.add(v.title); return true; });
      if (add.length) await addDraftHistory(add.map((v) => ({ theme: v.title, title: v.title, createdAt: v.createdAt, mode: "news", part: 1, source: "past" })));
      setHistMsg(`「${dir.name}」から ${vids.length}本の動画が見つかり、${add.length}本を記録に追加しました${vids.length - add.length ? `（${vids.length - add.length}本は記録済み）` : ""}。`);
      setHistOpen(true);
      load();
    } catch (e) { setHistMsg(`読み込めませんでした：${e.message}`); }
  };
  // 手で1件追加する（このアプリ以外で作った動画など）
  const addManual = async () => {
    const theme = addForm.theme.trim();
    if (!theme) { setHistMsg("テーマを入力してください"); return; }
    const t = addForm.date ? new Date(`${addForm.date}T12:00:00`).getTime() : Date.now();
    try {
      await addDraftHistory([{ theme, title: addForm.title.trim(), createdAt: t, mode: /^用語[:：]/.test(theme) ? "keyword" : "news", part: 1, source: "entry" }]);
      setAddForm({ theme: "", title: "", date: "" }); setHistMsg("追加しました。"); load();
    } catch (e) { setHistMsg(`追加できませんでした：${e.message}`); }
  };
  const removeHistory = async (h) => {
    if (!confirm(`記録から削除しますか？\n${h.theme}${h.title ? `\n（${h.title}）` : ""}`)) return;
    setHistory((list) => list.filter((x) => x.id !== h.id));
    try { await deleteHistory(h.id); } catch (e) { setHistMsg(`削除できませんでした：${e.message}`); load(); }
  };
  // シリーズ（同じテーマ）ごとに、いちばん新しい回の行にだけ「続編」のチェックを出す
  const latestOfSeries = new Map();
  for (const h of history) { const c = latestOfSeries.get(h.theme); if (!c || (h.createdAt || 0) >= (c.createdAt || 0)) latestOfSeries.set(h.theme, h); }
  const seriesFlagged = (theme) => history.some((x) => x.theme === theme && x.sequel);
  const sortedHistory = history.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

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
          {drafts.length === 0 && (
            <div className="text-[11px]" style={{ color: C.textMuted }}>新しいドラフトはありません。一度開いたドラフト（今朝の分も）は、下の「最近開いた台本」からもう一度開けます。</div>
          )}
          {serverOld && (
            <div className="text-[11px]" style={{ color: C.amber }}>「最近開いた台本」を出すには、裏で動いているtts-serverを起動し直す必要があります。開いている黒い画面をすべて閉じてから、ショートカット（start-dd-dashboard）で起動し直してください。</div>
          )}
          {recent.length > 0 && (
            <div className="flex flex-col gap-1 pt-1" style={{ borderTop: `1px solid ${C.borderSoft ?? "#334155"}` }}>
              <div className="text-[11px] font-bold" style={{ color: C.teal }}>最近開いた台本（もう一度開く）</div>
              {recent.map((d) => (
                <div key={d.dir} className="flex items-center gap-2 text-xs">
                  <div className="flex-1 min-w-0">
                    <div className="truncate">{d.title}</div>
                    <div className="truncate text-[10px]" style={{ color: C.textMuted }}>{SOURCE_LABEL[d.source] || "自動"}・{MODE_LABEL[d.mode] || "ニュース"}「{d.theme}」・{d.scenes}場面・作成 {fmt(d.createdAt)}{d.source !== "backup" ? `・開いた日時 ${fmt(d.importedAt)}` : ""}</div>
                  </div>
                  <button onClick={() => openDraft(d, true)} disabled={disabled || busy} className="text-[11px] px-2 py-1 rounded" style={{ ...btn, opacity: disabled || busy ? 0.5 : 1 }}>もう一度開く</button>
                </div>
              ))}
            </div>
          )}
          {sch && (
            <div className="flex flex-col gap-2 pt-1" style={{ borderTop: `1px solid ${C.borderSoft ?? "#334155"}` }}>
              <div className="flex items-center gap-3 text-xs flex-wrap">
                <label className="flex items-center gap-1"><input type="checkbox" checked={sch.enabled} onChange={(e) => setSch({ ...sch, enabled: e.target.checked })} /> 毎朝自動で作る</label>
                <label className="flex items-center gap-1">本数 <input type="number" min={1} max={10} value={sch.count} onChange={(e) => setSch({ ...sch, count: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })} className="w-14 px-1 py-0.5 text-xs" style={field} /></label>
                <label className="flex items-center gap-1">開始時刻 <input type="time" value={sch.time} onChange={(e) => setSch({ ...sch, time: e.target.value })} className="px-1 py-0.5 text-xs" style={field} /></label>
              </div>
              <div className="flex items-center gap-x-3 gap-y-1 text-xs flex-wrap">
                <span className="text-[11px]" style={{ color: C.textMuted }}>自動で選ぶジャンル</span>
                {THEME_GENRES.map((g) => {
                  const on = (sch.genres || []).includes(g.key);
                  return (
                    <label key={g.key} className="flex items-center gap-1" title={g.hint}>
                      <input type="checkbox" checked={on} onChange={(e) => setSch({ ...sch, genres: e.target.checked ? [...(sch.genres || []), g.key] : (sch.genres || []).filter((k) => k !== g.key) })} />{g.label}
                    </label>
                  );
                })}
                <span className="text-[10px]" style={{ color: C.textDim ?? C.textMuted }}>{(sch.genres || []).length ? "選んだジャンルから1本ずつ、順番をシャッフルして選びます" : "未選択＝全ジャンルからシャッフルで選びます"}（予約テーマ・続編が先。変えたら「予約を保存」）</span>
              </div>
              <div className="text-[11px]" style={{ color: C.textMuted }}>予約テーマ（1行に1つ。先に使います。用語解説にしたいときは「用語：NISA」のように書きます。扱ってほしい点は「 ｜ 」の後ろに書けます）。足りない分は、前日の話題のニュースから自動で選びます。</div>
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} className="px-2 py-1 text-xs" style={field} placeholder={"例：日銀の金融政策決定会合\n用語：インフレ ｜ 物価と金利の関係を中心に"} />
              <div className="flex items-center gap-2">
                <button onClick={save} disabled={busy} className="text-[11px] px-3 py-1 rounded" style={btn}>予約を保存</button>
                <span className="text-[10px]" style={{ color: C.textMuted }}>
                  夜間の画像：{sch.images ? (sch.images.enabled ? `オン（スライドの${Math.round(sch.images.share * 100)}%・AI生成${Math.round(sch.images.aiShare * 100)}%）` : "オフ") : "未保存"}
                  {imageSettings && (!sch.images || sch.images.enabled !== imageSettings.enabled || sch.images.share !== imageSettings.share || sch.images.aiShare !== imageSettings.aiShare || (sch.images.style || "") !== (imageSettings.style || "")) ? "（今の画面の設定と違います。「予約を保存」で反映）" : ""}
                </span>
                {msg && <span className="text-[11px]" style={{ color: C.textMuted }}>{msg}</span>}
              </div>
            </div>
          )}
          {!sch && msg && <div className="text-[11px]" style={{ color: C.amber }}>{msg}</div>}
          {sch && (
            <div className="flex flex-col gap-1 pt-1" style={{ borderTop: `1px solid ${C.borderSoft ?? "#334155"}` }}>
              <button onClick={() => setHistOpen((v) => !v)} className="text-[11px] text-left" style={{ color: C.teal, background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>
                {histOpen ? "▾" : "▸"} これまでに作ったテーマ（{history.length}件）{history.some((x) => x.sequel) ? `・続編の予定 ${new Set(history.filter((x) => x.sequel).map((x) => x.theme)).size}件` : ""}
              </button>
              {histOpen && (
                <>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button onClick={importExported} className="text-[11px] px-2 py-0.5 rounded" style={btn} title="書き出し先のフォルダ（動画ごとのフォルダが並んでいるフォルダ）を選ぶと、中の「〜_概要欄.txt」からタイトルと作成日を読んで記録に加えます">書き出した動画のフォルダから取り込む</button>
                    <button onClick={() => setAddOpen((v) => !v)} className="text-[11px] px-2 py-0.5 rounded" style={btn}>手で追加</button>
                    {histMsg && <span className="text-[11px]" style={{ color: C.textMuted }}>{histMsg}</span>}
                  </div>
                  {addOpen && (
                    <div className="flex items-center gap-2 flex-wrap text-[11px]">
                      <input value={addForm.theme} onChange={(e) => setAddForm({ ...addForm, theme: e.target.value })} placeholder="テーマ（用語解説は「用語：NISA」）" className="px-1.5 py-0.5 flex-1 min-w-[200px]" style={field} />
                      <input value={addForm.title} onChange={(e) => setAddForm({ ...addForm, title: e.target.value })} placeholder="動画タイトル（任意）" className="px-1.5 py-0.5 flex-1 min-w-[200px]" style={field} />
                      <input type="date" value={addForm.date} onChange={(e) => setAddForm({ ...addForm, date: e.target.value })} className="px-1.5 py-0.5" style={field} title="作成日（空なら今日）" />
                      <button onClick={addManual} className="px-2 py-0.5 rounded" style={btn}>追加</button>
                    </div>
                  )}
                  <div className="text-[10px]" style={{ color: C.textMuted }}>夜間の自動生成は、ここにあるテーマ・タイトルと同じ話題を選びません。「続編」にチェックすると、次の自動生成で、前回の動画以降の新しい情報を使って続編を作ります（作り終えるとチェックは外れ、続編もここに記録されます）。</div>
                  <div className="overflow-y-auto" style={{ maxHeight: 260 }}>
                    <table className="w-full text-[11px]" style={{ borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ color: C.textMuted, textAlign: "left" }}>
                          <th className="py-1 pr-2 font-normal" style={{ width: 84 }}>作成日</th>
                          <th className="py-1 pr-2 font-normal">テーマ</th>
                          <th className="py-1 pr-2 font-normal">タイトル（サブタイトル）</th>
                          <th className="py-1 pr-2 font-normal" style={{ width: 44 }}>回</th>
                          <th className="py-1 font-normal" style={{ width: 44, textAlign: "center" }}>続編</th>
                          <th style={{ width: 24 }} />
                        </tr>
                      </thead>
                      <tbody>
                        {sortedHistory.map((h) => {
                          const isLatest = latestOfSeries.get(h.theme)?.id === h.id;
                          return (
                            <tr key={h.id} style={{ borderTop: `1px solid ${C.borderSoft ?? "#334155"}`, color: C.text }}>
                              <td className="py-1 pr-2" style={{ color: C.textMuted }}>{ymd(h.createdAt)}</td>
                              <td className="py-1 pr-2">{h.mode === "keyword" ? "用語：" : ""}{h.theme}<span className="text-[10px] ml-1" style={{ color: C.textDim ?? C.textMuted }}>{SOURCE_LABEL[h.source] || ""}</span></td>
                              <td className="py-1 pr-2" style={{ color: C.textMuted }}>{h.title || "—"}</td>
                              <td className="py-1 pr-2">{(h.part || 1) > 1 ? `第${h.part}弾` : "初回"}</td>
                              <td className="py-1" style={{ textAlign: "center" }}>
                                {isLatest && <input type="checkbox" checked={seriesFlagged(h.theme)} onChange={(e) => toggleSequel(h, e.target.checked)} title="次の自動生成で、このテーマの続編を新しい情報で作る" />}
                              </td>
                              <td className="py-1" style={{ textAlign: "center" }}>
                                <button onClick={() => removeHistory(h)} title="記録から削除" style={{ color: C.textMuted, background: "none", border: "none", cursor: "pointer" }}>×</button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
