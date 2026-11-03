"use client";
// Stage F-5：平日朝の自動配信（タスクスケジューラ）の設定パネル（最小構成）。
// dd-dashboardは当面「株式情報・当日」の1ジョブのみを想定しているため、investment-shortsの
// components/AutoPanel.tsx（複数ジョブ・複数銘柄・複数メニュー対応）とは異なり、1ジョブ固定の
// 最小UIにする（investment-shorts本体のコードはコピーしていない、新規実装）。
// lib/autoJob.tsのAutoConfig.jobsは配列のままなので、将来ジョブを増やす場合もこの型・サーバー側
// （tts-server/server.jsのhandlePostAutoSchedule）は変更不要（このUIを拡張するだけで済む）。
import { useEffect, useState } from "react";
import { getTtsBaseUrl } from "@/lib/videoAudioMixer";
import { defaultConfig, DAY_NAMES, SEASON_LABEL, MODE_LABEL, newId } from "@/lib/autoJob";

// colors・btnは呼び出し元（ExplainerStudio.jsx）の色トークン・ボタンスタイルをそのまま使う
// （NarrMixedBox.jsxのcolors propと同じ考え方。このファイル単体では色を持たない）。
export default function AutoScheduleStudio({ colors: C, btn }) {
  const [cfg, setCfg] = useState(null); // null＝読み込み中
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [tasks, setTasks] = useState(null);

  useEffect(() => {
    fetch(`${getTtsBaseUrl()}/api/auto-schedule`)
      .then((r) => r.json())
      .then((c) => setCfg(c && Array.isArray(c.jobs) && c.jobs[0] ? c : defaultConfig()))
      .catch(() => setCfg(defaultConfig()));
  }, []);

  const job = cfg?.jobs?.[0];
  const patchJob = (patch) => setCfg((c) => ({ ...c, jobs: [{ ...c.jobs[0], ...patch }] }));
  const toggleDay = (d) => patchJob({ days: job.days.includes(d) ? job.days.filter((x) => x !== d) : [...job.days, d].sort((a, b) => a - b) });
  const patchTime = (id, patch) => patchJob({ times: job.times.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
  const addTime = () => patchJob({ times: [...job.times, { id: newId(), time: "06:15", season: "all" }] });
  const removeTime = (id) => patchJob({ times: job.times.filter((t) => t.id !== id) });

  const save = async (extra = {}) => {
    setBusy("保存しています…"); setNote("");
    try {
      const r = await fetch(`${getTtsBaseUrl()}/api/auto-schedule`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config: cfg, ...extra }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.ok === false) throw new Error((j.errors || []).join("、") || j.error || `HTTP ${r.status}`);
      setNote(extra.register ? `Windowsのタスクスケジューラに登録しました（${j.created ?? 0}件）` : extra.unregister ? "登録をすべて解除しました（設定は残っています）" : "設定を保存しました");
    } catch (e) {
      setNote(`⚠ 失敗しました：${e?.message ?? e}（ローカルサーバー tts-server が起動しているかご確認ください。Windowsのタスクスケジューラへの登録はWindows上でのみ行えます）`);
    } finally {
      setBusy("");
    }
  };

  const checkTasks = async () => {
    setBusy("確認しています…"); setNote(""); setTasks(null);
    try {
      const r = await fetch(`${getTtsBaseUrl()}/api/auto-schedule?tasks=1`);
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      setTasks(j.tasks || []);
    } catch (e) {
      setNote(`⚠ 確認できませんでした：${e?.message ?? e}`);
    } finally {
      setBusy("");
    }
  };

  // この画面（通常のブラウザ）でautorunの流れだけをその場で試す簡易テスト。タスクスケジューラ・
  // 専用の自動運転プロファイルは使わない（それらを含めた本番同等のテストは、ユーザー自身の環境で
  // 「node scripts/auto-run.mjs --job <id> --time <id>」を手動実行して確認する）。
  const tryNow = () => {
    if (!confirm("この画面でそのまま「株式情報」の自動実行を試します（テーマ・参考情報・台本は今の内容から消えて作り直されます）。よろしいですか？")) return;
    const url = new URL(window.location.href);
    url.searchParams.set("autorun", "1");
    url.searchParams.set("mode", job?.mode || "preview");
    url.searchParams.set("run", `test-${Date.now()}`);
    window.location.href = url.toString();
  };

  if (!cfg || !job) return <div className="text-[11px]" style={{ color: C.textDim }}>読み込み中…（ローカルサーバー tts-server が起動しているかご確認ください）</div>;

  return (
    <div className="space-y-2">
      <div className="text-[10px] leading-relaxed" style={{ color: C.textDim }}>
        平日朝に「株式情報」動画をWindowsのタスクスケジューラから自動実行します（専用の別Chromeプロファイルを使うため、通常お使いのブラウザには影響しません）。
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[11px]" style={{ color: C.textMuted }}>曜日：</span>
        {DAY_NAMES.map((n, d) => (
          <button key={d} type="button" onClick={() => toggleDay(d)} className="text-[11px] px-1.5 py-0.5 rounded" style={{ color: job.days.includes(d) ? C.bg : C.textMuted, background: job.days.includes(d) ? C.teal : "transparent", border: `1px solid ${C.borderSoft}`, cursor: "pointer" }}>
            {n}
          </button>
        ))}
      </div>
      <div className="space-y-1">
        {job.times.map((t) => (
          <div key={t.id} className="flex items-center gap-1.5">
            <input type="time" value={t.time} onChange={(e) => patchTime(t.id, { time: e.target.value })} className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: C.panel2, border: `1px solid ${C.borderSoft}`, color: C.text }} />
            <select value={t.season} onChange={(e) => patchTime(t.id, { season: e.target.value })} className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: C.panel2, border: `1px solid ${C.borderSoft}`, color: C.text }}>
              {Object.entries(SEASON_LABEL).map(([k, l]) => (
                <option key={k} value={k}>{l}</option>
              ))}
            </select>
            <button type="button" onClick={() => removeTime(t.id)} className="text-[10px] px-1.5 py-0.5 rounded" style={btn()}>削除</button>
          </div>
        ))}
        <button type="button" onClick={addTime} className="text-[10px] px-1.5 py-0.5 rounded" style={btn()}>＋時刻を追加</button>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[11px]" style={{ color: C.textMuted }}>実行モード：</span>
        {Object.entries(MODE_LABEL).map(([k, l]) => (
          <button key={k} type="button" onClick={() => patchJob({ mode: k })} className="text-[11px] px-2 py-0.5 rounded" style={{ color: job.mode === k ? C.bg : C.textMuted, background: job.mode === k ? C.teal : "transparent", border: `1px solid ${C.borderSoft}`, cursor: "pointer" }}>
            {l}
          </button>
        ))}
      </div>
      {job.mode === "video" && (
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] whitespace-nowrap" style={{ color: C.textMuted }}>保存先フォルダ：</span>
          <input
            type="text"
            value={cfg.outDir || ""}
            onChange={(e) => setCfg((c) => ({ ...c, outDir: e.target.value }))}
            placeholder={"C:\\Users\\...\\Videos\\dd-dashboard-auto"}
            className="text-[11px] px-1.5 py-0.5 rounded flex-1 min-w-0"
            style={{ background: C.panel2, border: `1px solid ${C.borderSoft}`, color: C.text }}
          />
        </div>
      )}
      <div className="flex items-center gap-1.5 flex-wrap pt-1">
        <button type="button" onClick={() => save({ register: true })} disabled={!!busy} className="text-[11px] px-2.5 py-1 rounded" style={{ ...btn("primary"), opacity: busy ? 0.6 : 1 }}>保存してWindowsに登録</button>
        <button type="button" onClick={() => save({})} disabled={!!busy} className="text-[11px] px-2 py-1 rounded" style={{ ...btn(), opacity: busy ? 0.6 : 1 }}>設定だけ保存</button>
        <button type="button" onClick={checkTasks} disabled={!!busy} className="text-[11px] px-2 py-1 rounded" style={{ ...btn(), opacity: busy ? 0.6 : 1 }}>登録状況を確認</button>
        <button type="button" onClick={() => save({ unregister: true })} disabled={!!busy} className="text-[11px] px-2 py-1 rounded" style={{ ...btn(), opacity: busy ? 0.6 : 1 }}>登録をすべて解除</button>
        <button type="button" onClick={tryNow} disabled={!!busy} className="text-[11px] px-2 py-1 rounded" style={{ ...btn("amber"), opacity: busy ? 0.6 : 1 }}>今すぐ試す（この画面で）</button>
      </div>
      {busy && <div className="text-[10px]" style={{ color: C.textDim }}>{busy}</div>}
      {note && <div className="text-[10px]" style={{ color: note.startsWith("⚠") ? C.rust : C.teal }}>{note}</div>}
      {tasks && (
        <div className="text-[10px] leading-relaxed" style={{ color: C.textDim }}>
          {tasks.length ? tasks.map((t, i) => <div key={i}>{t.name}：次回{t.next || "-"}／状態{t.status || "-"}</div>) : "登録されたタスクはありません"}
        </div>
      )}
    </div>
  );
}
