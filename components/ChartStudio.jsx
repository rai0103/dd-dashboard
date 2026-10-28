"use client";
// グラフ作成ページ（/chart-studio/）：ダッシュボードが持つVOO(S&P500)・QQQ(NQ100)・SOXL（SOXX合成込み）・GOLDの
// 生の日次終値（lib/storage.ts、price-series:*）と、Stooq形式CSVでアップロードした任意銘柄を、
// 期間指定（1週間〜最長）または複数年セット（中間選挙年の平均・直近10年平均等、lib/videoCustomScene.tsの
// buildSeriesCatalogを再利用）で自由に組み合わせて重ね描きし、解説動画作成（ExplainerStudio）の動画解像度で
// スクリーンショットを撮れるツール。
// 撮ったスクリーンショットは解説動画作成と共通の画像ライブラリ（lib/explainer/imageStore.ts）に保存するため、
// 解説動画作成側の各場面「画像を追加」から選べるようになる（別途「ライブラリから選ぶ」ピッカーを追加予定）。
// 通常のスクショ添付（解説動画作成の参考情報パネル「スクショを追加」）はこれとは別に、これまで通り利用できる。
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Plus, X, Camera, Upload, RefreshCw, Check, AlertTriangle } from "lucide-react";
import { storage } from "@/lib/storage";
import { parseStooqCSV } from "@/lib/csvPrice";
import { periodPath, PERIOD_OPTIONS, csvRowsToStockDataPoints } from "@/lib/chartSeries";
import { buildSeriesCatalog, catalogKeyOptions } from "@/lib/videoCustomScene";
import { saveImage } from "@/lib/explainer/imageStore";
import { RENDER_SIZE } from "@/lib/explainer/renderer";

const C = {
  bg: "#0A0F1C", panel: "#111A2C", panel2: "#0D1424",
  border: "#22304C", borderSoft: "#1A2540",
  text: "#E7ECF3", textMuted: "#8592AC", textDim: "#56637F",
  teal: "#45C4B0", amber: "#D9A24B", rust: "#C0654B", blue: "#5B90C7",
};
const PALETTE = [C.teal, C.amber, C.blue, C.rust, "#BACAE1", "#BA68FF", "#7CD992", "#FF8A5B"];

const BUILTIN_SOURCES = [
  { key: "VOO", storageKey: "price-series:VOO", fallbackLabel: "S&P500(VOO)" },
  { key: "QQQ", storageKey: "price-series:QQQ", fallbackLabel: "NQ100(QQQ)" },
  { key: "SOXL", storageKey: "price-series:SOXL", fallbackLabel: "SOXL" },
  { key: "GOLD", storageKey: "price-series:GOLD", fallbackLabel: "GOLD" },
];

const uid = () => `s-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

function btn(active) {
  return {
    color: active ? C.bg : C.textMuted,
    background: active ? C.teal : C.panel,
    border: `1px solid ${active ? C.teal : C.borderSoft}`,
  };
}

export default function ChartStudio() {
  // ---------------- データソース（ダッシュボードが書き出した生の日次終値） ----------------
  const [sources, setSources] = useState({}); // { VOO: {label, points}, ... }（未取込のキーは無い）
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const refreshSources = async () => {
    setSourcesLoading(true);
    const next = {};
    for (const s of BUILTIN_SOURCES) {
      try {
        const res = await storage.get(s.storageKey);
        if (res?.value) next[s.key] = JSON.parse(res.value);
      } catch (e) { /* 読めなければ未取込扱い */ }
    }
    setSources(next);
    setSourcesLoading(false);
  };
  useEffect(() => { refreshSources(); }, []);

  // ---------------- CSVアップロード銘柄（このページ内だけの一時データ・ダッシュボードには保存しない） ----------------
  const [csvTickers, setCsvTickers] = useState([]); // [{id, name, points}]
  const [csvError, setCsvError] = useState("");
  const [csvNameDraft, setCsvNameDraft] = useState("");
  const csvFileRef = useRef(null);
  const handleCsvFile = async (file) => {
    setCsvError("");
    const name = csvNameDraft.trim();
    if (!name) { setCsvError("先に銘柄名・企業名を入力してください。"); return; }
    try {
      const text = await file.text();
      const rows = parseStooqCSV(text);
      if (!rows.length) { setCsvError("Date/Close列が見つかりませんでした（Stooq形式のCSVをお使いください）。"); return; }
      const points = csvRowsToStockDataPoints(rows);
      setCsvTickers((list) => [...list, { id: uid(), name, points }]);
      setCsvNameDraft("");
      if (csvFileRef.current) csvFileRef.current.value = "";
    } catch (e) { setCsvError("CSVの読み込みに失敗しました。"); }
  };
  const removeCsvTicker = (id) => {
    setCsvTickers((list) => list.filter((c) => c.id !== id));
    setAddedSeries((list) => list.filter((s) => s.sourceKey !== `csv:${id}`));
  };

  // 選択可能な全ソース一覧（ビルトイン4種＋CSVアップロード分。未取込のビルトインはpointsが空のまま一覧には出す）
  const allSources = useMemo(() => {
    const builtin = BUILTIN_SOURCES.map((s) => ({ key: s.key, label: sources[s.key]?.label ?? s.fallbackLabel, points: sources[s.key]?.points ?? [] }));
    const csv = csvTickers.map((c) => ({ key: `csv:${c.id}`, label: c.name, points: c.points }));
    return [...builtin, ...csv];
  }, [sources, csvTickers]);
  const sourceByKey = (key) => allSources.find((s) => s.key === key);

  // ---------------- 追加する系列の下書き ----------------
  const [addedSeries, setAddedSeries] = useState([]); // [{id, sourceKey, mode:'period'|'yearset', periodKey, yearSetKey, label, color}]
  const [draft, setDraft] = useState({ sourceKey: "VOO", mode: "period", periodKey: "1y", yearSetKey: "" });

  const draftCatalog = useMemo(() => {
    const src = sourceByKey(draft.sourceKey);
    if (!src || !src.points.length) return {};
    const asOfDate = src.points[src.points.length - 1].date;
    const curYear = parseInt(asOfDate.slice(0, 4), 10);
    return buildSeriesCatalog(src.points, curYear, asOfDate);
  }, [draft.sourceKey, allSources]);
  const draftCatalogOptions = useMemo(() => catalogKeyOptions(draftCatalog), [draftCatalog]);

  // 複数年セットのドロップダウンは、ソース切替時に候補の先頭を自動選択する（候補が無くなったら空に戻す）
  useEffect(() => {
    if (draft.mode !== "yearset") return;
    if (draftCatalogOptions.some((o) => o.key === draft.yearSetKey)) return;
    setDraft((d) => ({ ...d, yearSetKey: draftCatalogOptions[0]?.key ?? "" }));
  }, [draft.mode, draftCatalogOptions]);

  const addSeries = () => {
    const src = sourceByKey(draft.sourceKey);
    if (!src || !src.points.length) return;
    if (draft.mode === "yearset" && !draft.yearSetKey) return;
    const color = PALETTE[addedSeries.length % PALETTE.length];
    const autoLabel = draft.mode === "period"
      ? `${src.label}（${PERIOD_OPTIONS.find((p) => p.key === draft.periodKey)?.label ?? draft.periodKey}）`
      : `${src.label}（${draftCatalog[draft.yearSetKey]?.label ?? draft.yearSetKey}）`;
    setAddedSeries((list) => [...list, {
      id: uid(), sourceKey: draft.sourceKey, mode: draft.mode,
      periodKey: draft.periodKey, yearSetKey: draft.yearSetKey, label: autoLabel, color,
    }]);
  };
  const removeSeries = (id) => setAddedSeries((list) => list.filter((s) => s.id !== id));
  const updateSeriesLabel = (id, label) => setAddedSeries((list) => list.map((s) => (s.id === id ? { ...s, label } : s)));

  // 追加済みの各系列を実際の{t,v}パスに解決する（データ更新・追加のたびに作り直す）
  const resolvedSeries = useMemo(() => addedSeries.map((s) => {
    const src = sourceByKey(s.sourceKey);
    if (!src || !src.points.length) return { ...s, pts: [] };
    if (s.mode === "period") return { ...s, pts: periodPath(src.points, s.periodKey) };
    const asOfDate = src.points[src.points.length - 1].date;
    const curYear = parseInt(asOfDate.slice(0, 4), 10);
    const catalog = buildSeriesCatalog(src.points, curYear, asOfDate);
    return { ...s, pts: catalog[s.yearSetKey]?.pts ?? [] };
  }), [addedSeries, allSources]);

  // ---------------- 出力サイズ・描画 ----------------
  const [format, setFormat] = useState("long"); // long=16:9（1920x1080）、short=9:16（1080x1920）
  const [chartTitle, setChartTitle] = useState("");
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { w: W, h: H } = RENDER_SIZE[format];
    canvas.width = W; canvas.height = H;
    drawChart(canvas.getContext("2d"), W, H, resolvedSeries, chartTitle, format);
  }, [resolvedSeries, format, chartTitle]);

  // ---------------- スクリーンショット保存（解説動画作成と共通の画像ライブラリへ） ----------------
  const [shotBusy, setShotBusy] = useState(false);
  const [shotNote, setShotNote] = useState("");
  const takeScreenshot = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !resolvedSeries.some((s) => s.pts.length > 1)) { setShotNote("系列を1つ以上追加してください。"); return; }
    setShotBusy(true); setShotNote("");
    try {
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("画像の生成に失敗しました");
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const file = new File([blob], `chart-${stamp}.png`, { type: "image/png" });
      await saveImage(file);
      setShotNote("保存しました。解説動画作成の各場面「画像を追加」→「ライブラリから選ぶ」で使えます。");
    } catch (e) {
      setShotNote("保存に失敗しました。もう一度お試しください。");
    } finally {
      setShotBusy(false);
    }
  };

  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
  const label = (t) => <span className="text-[11px]" style={{ color: C.textMuted }}>{t}</span>;

  return (
    <div className="min-h-screen" style={{ background: C.bg, color: C.text }}>
      <div className="max-w-[1200px] mx-auto px-4 py-4">
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <h1 className="text-sm font-bold">グラフ作成（動画用）</h1>
          <a href={`${basePath}/`} target="_blank" rel="noopener noreferrer" title="別タブで開きます" className="text-[11px] flex items-center gap-1" style={{ color: C.textMuted, textDecoration: "none" }}>
            <ArrowLeft size={12} /> ダッシュボード
          </a>
          <a href={`${basePath}/explainer/`} target="_blank" rel="noopener noreferrer" title="別タブで開きます" className="text-[11px] flex items-center gap-1" style={{ color: C.textMuted, textDecoration: "none" }}>
            解説動画作成
          </a>
          <div className="flex-1" />
          <button onClick={refreshSources} className="text-[11px] flex items-center gap-1 px-2 py-1 rounded" style={btn(false)}>
            <RefreshCw size={11} className={sourcesLoading ? "animate-spin" : ""} /> ダッシュボードのデータを再取得
          </button>
        </div>

        <div className="grid gap-4" style={{ gridTemplateColumns: "minmax(0,1fr) 360px" }}>
          {/* プレビュー列 */}
          <div className="rounded-lg p-3" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
            <div className="flex items-center gap-2 mb-2">
              {[["long", "長尺（16:9）"], ["short", "ショート（9:16）"]].map(([k, l]) => (
                <button key={k} onClick={() => setFormat(k)} className="text-[11px] px-2.5 py-1 rounded-full" style={btn(format === k)}>{l}</button>
              ))}
            </div>
            <input
              value={chartTitle} onChange={(e) => setChartTitle(e.target.value)} placeholder="チャートのタイトル（任意）"
              className="w-full text-xs rounded px-2 py-1.5 mb-2" style={{ background: C.panel2, border: `1px solid ${C.borderSoft}`, color: C.text }}
            />
            <div className="mx-auto" style={{ aspectRatio: format === "long" ? "16/9" : "9/16", maxWidth: format === "long" ? 680 : 360 }}>
              <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block", borderRadius: 8, border: `1px solid ${C.border}` }} />
            </div>
            <div className="flex items-center gap-2 mt-3">
              <button onClick={takeScreenshot} disabled={shotBusy} className="text-xs flex items-center gap-1.5 px-3 py-1.5 rounded font-bold" style={btn(true)}>
                <Camera size={13} /> {shotBusy ? "保存中…" : "スクリーンショットを保存"}
              </button>
              {shotNote && (
                <span className="text-[11px] flex items-center gap-1" style={{ color: shotNote.startsWith("保存しました") ? C.teal : C.rust }}>
                  {shotNote.startsWith("保存しました") ? <Check size={12} /> : <AlertTriangle size={12} />} {shotNote}
                </span>
              )}
            </div>
          </div>

          {/* 操作列 */}
          <div className="flex flex-col gap-3">
            {/* データソース状況 */}
            <div className="rounded-lg p-3 text-xs" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
              <div className="font-bold mb-1.5">データソース</div>
              {BUILTIN_SOURCES.map((s) => {
                const got = sources[s.key];
                return (
                  <div key={s.key} className="flex items-center justify-between py-0.5">
                    <span>{s.fallbackLabel}</span>
                    {got?.points?.length
                      ? <span style={{ color: C.textDim }}>{got.points[got.points.length - 1].date}時点・{got.points.length.toLocaleString()}件</span>
                      : <span style={{ color: C.rust }}>未取込（ダッシュボードを開いてください）</span>}
                  </div>
                );
              })}
              <div className="my-2" style={{ borderTop: `1px solid ${C.borderSoft}` }} />
              <div className="font-bold mb-1">CSVアップロード（その他の銘柄）</div>
              <input
                value={csvNameDraft} onChange={(e) => setCsvNameDraft(e.target.value)} placeholder="銘柄名・企業名（例：NVDA）"
                className="w-full text-xs rounded px-2 py-1 mb-1" style={{ background: C.panel2, border: `1px solid ${C.borderSoft}`, color: C.text }}
              />
              <label className="text-[11px] px-2 py-1 rounded flex items-center gap-1 w-fit cursor-pointer" style={btn(false)}>
                <Upload size={11} /> Stooq形式CSVを選ぶ
                <input ref={csvFileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && handleCsvFile(e.target.files[0])} />
              </label>
              {csvError && <div className="text-[11px] mt-1" style={{ color: C.rust }}>{csvError}</div>}
              {csvTickers.map((c) => (
                <div key={c.id} className="flex items-center justify-between mt-1">
                  <span>{c.name}（{c.points.length.toLocaleString()}件）</span>
                  <button onClick={() => removeCsvTicker(c.id)} style={{ color: C.textDim, background: "none", border: "none", cursor: "pointer" }}><X size={12} /></button>
                </div>
              ))}
            </div>

            {/* 系列を追加 */}
            <div className="rounded-lg p-3 text-xs" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
              <div className="font-bold mb-1.5">系列を追加</div>
              <select value={draft.sourceKey} onChange={(e) => setDraft((d) => ({ ...d, sourceKey: e.target.value }))} className="w-full text-xs rounded px-2 py-1 mb-1.5" style={{ background: C.panel2, border: `1px solid ${C.borderSoft}`, color: C.text }}>
                {allSources.map((s) => <option key={s.key} value={s.key}>{s.label}{s.points.length ? "" : "（未取込）"}</option>)}
              </select>
              <div className="flex items-center gap-2 mb-1.5">
                {[["period", "期間指定"], ["yearset", "複数年セット"]].map(([k, l]) => (
                  <button key={k} onClick={() => setDraft((d) => ({ ...d, mode: k }))} className="text-[11px] px-2 py-1 rounded-full" style={btn(draft.mode === k)}>{l}</button>
                ))}
              </div>
              {draft.mode === "period" ? (
                <select value={draft.periodKey} onChange={(e) => setDraft((d) => ({ ...d, periodKey: e.target.value }))} className="w-full text-xs rounded px-2 py-1 mb-1.5" style={{ background: C.panel2, border: `1px solid ${C.borderSoft}`, color: C.text }}>
                  {PERIOD_OPTIONS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                </select>
              ) : (
                <select value={draft.yearSetKey} onChange={(e) => setDraft((d) => ({ ...d, yearSetKey: e.target.value }))} className="w-full text-xs rounded px-2 py-1 mb-1.5" style={{ background: C.panel2, border: `1px solid ${C.borderSoft}`, color: C.text }}>
                  {draftCatalogOptions.length ? draftCatalogOptions.map((o) => <option key={o.key} value={o.key}>{o.label}</option>) : <option value="">（データなし）</option>}
                </select>
              )}
              <button onClick={addSeries} className="text-[11px] flex items-center gap-1 px-2.5 py-1 rounded-full font-bold" style={btn(true)}>
                <Plus size={12} /> チャートに追加
              </button>
            </div>

            {/* 追加済み系列一覧 */}
            <div className="rounded-lg p-3 text-xs" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
              <div className="font-bold mb-1.5">追加済みの系列（{addedSeries.length}）</div>
              {!addedSeries.length && label("まだありません。上で系列を追加してください。")}
              {addedSeries.map((s) => (
                <div key={s.id} className="flex items-center gap-1.5 mb-1.5">
                  <span className="shrink-0 rounded-sm" style={{ width: 10, height: 10, background: s.color }} />
                  <input
                    value={s.label} onChange={(e) => updateSeriesLabel(s.id, e.target.value)}
                    className="flex-1 min-w-0 text-[11px] rounded px-1.5 py-1" style={{ background: C.panel2, border: `1px solid ${C.borderSoft}`, color: C.text }}
                  />
                  <button onClick={() => removeSeries(s.id)} style={{ color: C.textDim, background: "none", border: "none", cursor: "pointer" }}><X size={13} /></button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// チャート本体の描画（静止画・アニメーション無し＝スクリーンショット用）。
// series は {label, color, pts:{t,v}[]}[]（pts は addSeries 時点で既に解決済み）。
function drawChart(ctx, W, H, series, title, format) {
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  const valid = series.filter((s) => s.pts.length > 1);
  const titleSize = format === "long" ? 44 : 50;
  const bodySize = format === "long" ? 24 : 28;
  const legendLineH = format === "long" ? 42 : 56;
  const legendTop = format === "long" ? 60 : 70;
  const padTop = (title ? titleSize + 50 : 50) + 20;
  const padBottom = legendTop + Math.max(1, valid.length) * legendLineH + 20;
  const pad = { l: format === "long" ? 110 : 90, r: format === "long" ? 60 : 50, t: padTop, b: padBottom };
  const plot = { x: pad.l, y: pad.t, w: W - pad.l - pad.r, h: Math.max(60, H - pad.t - pad.b) };

  if (title) {
    ctx.fillStyle = C.text;
    ctx.font = `bold ${titleSize}px sans-serif`;
    ctx.textAlign = "left"; ctx.textBaseline = "top";
    ctx.fillText(title, pad.l, format === "long" ? 36 : 40);
  }

  if (!valid.length) {
    ctx.fillStyle = C.textDim;
    ctx.font = `${bodySize + 4}px sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("系列を追加してください", W / 2, H / 2);
    return;
  }

  let vMin = Infinity, vMax = -Infinity;
  valid.forEach((s) => s.pts.forEach((p) => { if (p.v < vMin) vMin = p.v; if (p.v > vMax) vMax = p.v; }));
  if (!isFinite(vMin) || !isFinite(vMax) || vMin === vMax) { vMin = (vMin || 100) - 10; vMax = (vMax || 100) + 10; }
  const spread = vMax - vMin;
  vMin -= spread * 0.08; vMax += spread * 0.08;
  const yOf = (v) => plot.y + plot.h * (1 - (v - vMin) / (vMax - vMin));
  const xOf = (t) => plot.x + plot.w * t;

  // グリッド＋y軸ラベル（5分割）
  ctx.strokeStyle = C.borderSoft; ctx.lineWidth = 1.5;
  ctx.fillStyle = C.textDim; ctx.font = `${bodySize - 2}px sans-serif`; ctx.textAlign = "right"; ctx.textBaseline = "middle";
  for (let i = 0; i <= 4; i++) {
    const v = vMin + ((vMax - vMin) * i) / 4;
    const y = yOf(v);
    ctx.beginPath(); ctx.moveTo(plot.x, y); ctx.lineTo(plot.x + plot.w, y); ctx.stroke();
    ctx.fillText(v.toFixed(0), plot.x - 16, y);
  }

  // 基準線（期間開始時点＝100）
  if (vMin < 100 && vMax > 100) {
    ctx.save(); ctx.setLineDash([8, 10]); ctx.strokeStyle = C.textMuted; ctx.lineWidth = 2;
    const y100 = yOf(100);
    ctx.beginPath(); ctx.moveTo(plot.x, y100); ctx.lineTo(plot.x + plot.w, y100); ctx.stroke();
    ctx.restore();
  }

  // 各系列の折れ線＋終点ドット
  valid.forEach((s) => {
    ctx.strokeStyle = s.color; ctx.lineWidth = format === "long" ? 5 : 6; ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.beginPath();
    s.pts.forEach((p, i) => { const x = xOf(p.t), y = yOf(p.v); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
    ctx.stroke();
    const last = s.pts[s.pts.length - 1];
    ctx.fillStyle = s.color;
    ctx.beginPath(); ctx.arc(xOf(last.t), yOf(last.v), format === "long" ? 7 : 8, 0, Math.PI * 2); ctx.fill();
  });

  // 凡例（系列名＋期間終端時点の騰落率）
  const legendY0 = plot.y + plot.h + legendTop;
  ctx.font = `${bodySize}px sans-serif`; ctx.textAlign = "left"; ctx.textBaseline = "middle";
  valid.forEach((s, i) => {
    const y = legendY0 + i * legendLineH;
    ctx.fillStyle = s.color;
    ctx.fillRect(plot.x, y - bodySize * 0.35, bodySize * 0.9, bodySize * 0.7);
    ctx.fillStyle = C.text;
    const last = s.pts[s.pts.length - 1];
    const diff = last.v - 100;
    const sign = diff >= 0 ? "+" : "";
    ctx.fillText(`${s.label}（${sign}${diff.toFixed(1)}%）`, plot.x + bodySize * 1.3, y);
  });
}
