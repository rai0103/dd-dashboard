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
import { periodPath, periodSpanDays, PERIOD_OPTIONS, csvRowsToStockDataPoints, buildChartStudioCatalog } from "@/lib/chartSeries";
import { catalogKeyOptions } from "@/lib/videoCustomScene";
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
// 縦軸・横軸の目盛り値のフォントサイズを上下ボタンで調整する（0＝非表示）。プレビュー（左のcanvas）は
// useEffectの依存配列にyTickSize/xTickSizeが入っているため、ボタンを押すたびに即座に再描画される。
const AXIS_TICK_MIN = 0, AXIS_TICK_MAX = 48, AXIS_TICK_STEP = 2;
function AxisSizeStepper({ label, value, onChange }) {
  const dec = () => onChange(Math.max(AXIS_TICK_MIN, value - AXIS_TICK_STEP));
  const inc = () => onChange(Math.min(AXIS_TICK_MAX, value + AXIS_TICK_STEP));
  const stepBtnStyle = (disabled) => ({ ...btn(false), width: 22, height: 22, opacity: disabled ? 0.35 : 1, cursor: disabled ? "default" : "pointer", fontWeight: 700, lineHeight: 1 });
  return (
    <div className="flex items-center gap-1.5 text-[11px]">
      <span style={{ color: C.textMuted }}>{label}</span>
      <button type="button" onClick={dec} disabled={value <= AXIS_TICK_MIN} className="rounded flex items-center justify-center" style={stepBtnStyle(value <= AXIS_TICK_MIN)}>−</button>
      <span className="mono text-center" style={{ width: 46, color: C.text }}>{value <= AXIS_TICK_MIN ? "非表示" : `${value}px`}</span>
      <button type="button" onClick={inc} disabled={value >= AXIS_TICK_MAX} className="rounded flex items-center justify-center" style={stepBtnStyle(value >= AXIS_TICK_MAX)}>＋</button>
    </div>
  );
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
  // Stooqのファイル名（例："soxl_us_d.csv"・"nvda.us.txt"）は先頭が銘柄のティッカーなので、
  // "."または"_"区切りの最初のトークンを取り出して大文字化する（名称入力を省略できるようにする）。
  const tickerFromFileName = (fileName) => {
    const base = String(fileName).replace(/\.[^.]+$/, "");
    const first = base.split(/[._]/)[0];
    return first ? first.toUpperCase() : "";
  };
  // 複数ファイルを一度に選択できる。手入力の銘柄名は「1ファイルだけ選んだ場合」のみ優先し、
  // 複数選択時や未入力時はファイル名から自動で銘柄名を付ける。
  const handleCsvFiles = async (fileList) => {
    setCsvError("");
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const manualName = csvNameDraft.trim();
    const added = [];
    const errors = [];
    for (const file of files) {
      try {
        const text = await file.text();
        const rows = parseStooqCSV(text);
        if (!rows.length) { errors.push(`${file.name}：Date/Close列が見つかりませんでした`); continue; }
        const points = csvRowsToStockDataPoints(rows);
        const name = (files.length === 1 && manualName) ? manualName : (tickerFromFileName(file.name) || file.name);
        added.push({ id: uid(), name, points });
      } catch (e) { errors.push(`${file.name}：読み込みに失敗しました`); }
    }
    if (added.length) setCsvTickers((list) => [...list, ...added]);
    setCsvError(errors.join(" / "));
    setCsvNameDraft("");
    if (csvFileRef.current) csvFileRef.current.value = "";
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
    return buildChartStudioCatalog(src.points, curYear, asOfDate);
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
    const catalogEntry = draft.mode === "yearset" ? draftCatalog[draft.yearSetKey] : null;
    const isMulti = !!catalogEntry?.linePaths?.length; // 複数年を薄い白線で重ね描きする系列（「全○本」の選択肢）
    const color = isMulti ? "#FFFFFF" : PALETTE[addedSeries.length % PALETTE.length];
    const autoLabel = draft.mode === "period"
      ? `${src.label}（${PERIOD_OPTIONS.find((p) => p.key === draft.periodKey)?.label ?? draft.periodKey}）`
      : `${src.label}（${catalogEntry?.label ?? draft.yearSetKey}）`;
    setAddedSeries((list) => [...list, {
      id: uid(), sourceKey: draft.sourceKey, mode: draft.mode,
      periodKey: draft.periodKey, yearSetKey: draft.yearSetKey, label: autoLabel, color,
    }]);
  };
  const removeSeries = (id) => setAddedSeries((list) => list.filter((s) => s.id !== id));
  const updateSeriesLabel = (id, label) => setAddedSeries((list) => list.map((s) => (s.id === id ? { ...s, label } : s)));

  // 追加済みの各系列を実際の{t,v}パスに解決する（データ更新・追加のたびに作り直す）。
  // xAxisKind：横軸ラベルの組み立て方を区別するための印。
  // - "calendar"：複数年セット（年ごとの推移を1年のグリッドに正規化）＝tがそのまま年内の経過（1/1〜12/31）
  // - "elapsed"：期間指定（1週間〜最長）＝spanDaysに実際の経過日数を添えて、日/週/ヶ月/年の単位で表示する
  const resolvedSeries = useMemo(() => addedSeries.map((s) => {
    const src = sourceByKey(s.sourceKey);
    if (!src || !src.points.length) return { ...s, pts: [] };
    if (s.mode === "period") {
      return { ...s, pts: periodPath(src.points, s.periodKey), xAxisKind: "elapsed", spanDays: periodSpanDays(src.points, s.periodKey) };
    }
    const asOfDate = src.points[src.points.length - 1].date;
    const curYear = parseInt(asOfDate.slice(0, 4), 10);
    const catalog = buildChartStudioCatalog(src.points, curYear, asOfDate);
    const entry = catalog[s.yearSetKey];
    return { ...s, pts: entry?.pts ?? [], linePaths: entry?.linePaths, xAxisKind: "calendar" };
  }), [addedSeries, allSources]);

  // チャート全体の横軸の種類・基準期間：有効な系列のうち最初のもの（通常は同種の系列を重ねて使うため、
  // これで事実上チャート全体の横軸を代表できる）から決める。系列が無ければ従来の0%〜100%表示にフォールバック。
  const xAxisInfo = useMemo(() => {
    const valid = resolvedSeries.find((s) => (s.pts && s.pts.length > 1) || (s.linePaths && s.linePaths.length));
    if (!valid) return { kind: "percent" };
    if (valid.xAxisKind === "calendar") return { kind: "calendar" };
    if (valid.xAxisKind === "elapsed" && valid.spanDays) return { kind: "elapsed", spanDays: valid.spanDays };
    return { kind: "percent" };
  }, [resolvedSeries]);

  // ---------------- 出力サイズ・描画 ----------------
  const [format, setFormat] = useState("long"); // long=16:9（1920x1080）、short=9:16（1080x1920）
  const [chartTitle, setChartTitle] = useState("");
  const [yTickSize, setYTickSize] = useState(22); // 縦軸の目盛り値のフォントサイズ（px）。0＝非表示
  const [xTickSize, setXTickSize] = useState(22); // 横軸の目盛り値のフォントサイズ（px）。0＝非表示
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { w: W, h: H } = RENDER_SIZE[format];
    canvas.width = W; canvas.height = H;
    drawChart(canvas.getContext("2d"), W, H, resolvedSeries, chartTitle, format, yTickSize, xTickSize, xAxisInfo);
  }, [resolvedSeries, format, chartTitle, yTickSize, xTickSize, xAxisInfo]);

  // ---------------- スクリーンショット保存（解説動画作成と共通の画像ライブラリへ） ----------------
  const [shotBusy, setShotBusy] = useState(false);
  const [shotNote, setShotNote] = useState("");
  const takeScreenshot = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !resolvedSeries.some((s) => s.pts.length > 1 || (s.linePaths && s.linePaths.length))) { setShotNote("系列を1つ以上追加してください。"); return; }
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
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-2">
              <AxisSizeStepper label="縦軸の目盛り" value={yTickSize} onChange={setYTickSize} />
              <AxisSizeStepper label="横軸の目盛り" value={xTickSize} onChange={setXTickSize} />
            </div>
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
                value={csvNameDraft} onChange={(e) => setCsvNameDraft(e.target.value)} placeholder="銘柄名（任意・1件選択時のみ有効。複数選択時やファイル名を使う場合は空欄でOK）"
                className="w-full text-xs rounded px-2 py-1 mb-1" style={{ background: C.panel2, border: `1px solid ${C.borderSoft}`, color: C.text }}
              />
              <label className="text-[11px] px-2 py-1 rounded flex items-center gap-1 w-fit cursor-pointer" style={btn(false)}>
                <Upload size={11} /> Stooq形式CSVを選ぶ（複数選択可）
                <input ref={csvFileRef} type="file" accept=".csv,text/csv" multiple className="hidden" onChange={(e) => e.target.files?.length && handleCsvFiles(e.target.files)} />
              </label>
              <div className="text-[10px] mt-0.5" style={{ color: C.textDim }}>銘柄名は、Stooqのファイル名（例：soxl_us_d.csv → SOXL）から自動で付けます。</div>
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

// 横軸の目盛り位置・ラベルを決める。xAxis.kind:
// - "calendar"：複数年セット（年ごとの推移を1年グリッドに正規化）＝tがそのまま年内の経過（1/1〜12/31）なので、
//   月名（1月・4月・7月・10月・12月）で表示する。
// - "elapsed"：期間指定（1週間〜最長）＝xAxis.spanDaysの実経過日数を、規模に応じて日/週/ヶ月/年の「きりのいい」
//   間隔を選んで「期間の経過」として表示する（目盛り位置自体も単位に揃える。0%〜100%の固定割合ではない）。
// - それ以外（系列が無い等）：従来通り0%〜100%表示にフォールバックする。
function buildXAxisTicks(xAxis) {
  const percentFallback = () => [0, 0.25, 0.5, 0.75, 1].map((t) => ({ t, label: `${Math.round(t * 100)}%` }));
  if (!xAxis) return percentFallback();
  if (xAxis.kind === "calendar") {
    // t=0が1/1、t=1が12/31相当（lib/videoLongBasis.tsのyearPathの正規化に合わせる）。
    return [0, 0.25, 0.5, 0.75, 1].map((t) => ({ t, label: `${Math.min(11, Math.floor(t * 12)) + 1}月` }));
  }
  if (xAxis.kind === "elapsed" && xAxis.spanDays > 0) {
    const spanDays = xAxis.spanDays;
    let unitDays, unitLabel;
    if (spanDays <= 10) { unitDays = 1; unitLabel = "日"; }
    else if (spanDays <= 60) { unitDays = 7; unitLabel = "週"; }
    else if (spanDays <= 450) { unitDays = 30.44; unitLabel = "ヶ月"; }
    else { unitDays = 365.25; unitLabel = "年"; }
    const totalUnits = spanDays / unitDays;
    const roughStep = totalUnits / 5;
    const pow = Math.pow(10, Math.floor(Math.log10(roughStep || 1)));
    const frac = roughStep / pow;
    const niceFrac = frac < 1.5 ? 1 : frac < 3 ? 2 : frac < 7 ? 5 : 10;
    const step = Math.max(niceFrac * pow, unitLabel === "年" ? 0.5 : 1);
    const decimals = unitLabel === "年" && step < 1 ? 1 : 0;
    const ticks = [];
    for (let u = 0; u <= totalUnits + 1e-6; u += step) {
      ticks.push({ t: Math.min(1, u / totalUnits), label: `${u.toFixed(decimals)}${unitLabel}` });
    }
    if (!ticks.length || ticks[ticks.length - 1].t < 0.999) {
      ticks.push({ t: 1, label: `${totalUnits.toFixed(decimals)}${unitLabel}` });
    }
    return ticks;
  }
  return percentFallback();
}

// チャート本体の描画（静止画・アニメーション無し＝スクリーンショット用）。
// series は {label, color, pts:{t,v}[], linePaths?:{t,v}[][]}[]（pts・linePathsは addSeries 時点で既に解決済み）。
// linePathsがある系列（「全○本」の複数年重ね描き）は、ptsは使わず個々の年の推移を薄い白線で全て描く。
// yTickSize・xTickSizeは縦軸・横軸の目盛り値のフォントサイズ（px）。0を指定するとその軸の目盛り値を非表示にする
// （グリッド線・刻みの位置自体は0でも変わらず、目盛りの文字だけを省く）。xAxisは横軸ラベルの種類（上記参照）。
function drawChart(ctx, W, H, series, title, format, yTickSize = 22, xTickSize = 22, xAxis = null) {
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  const valid = series.filter((s) => (s.pts && s.pts.length > 1) || (s.linePaths && s.linePaths.length));
  const titleSize = format === "long" ? 44 : 50;
  const bodySize = format === "long" ? 24 : 28;
  const legendLineH = format === "long" ? 42 : 56;
  const legendTop = format === "long" ? 60 : 70;
  const titleX = format === "long" ? 110 : 90; // タイトルの左位置は固定（縦軸の余白は目盛りサイズで変わるため連動させない）

  if (title) {
    ctx.fillStyle = C.text;
    ctx.font = `bold ${titleSize}px sans-serif`;
    ctx.textAlign = "left"; ctx.textBaseline = "top";
    ctx.fillText(title, titleX, format === "long" ? 36 : 40);
  }

  if (!valid.length) {
    ctx.fillStyle = C.textDim;
    ctx.font = `${bodySize + 4}px sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("系列を追加してください", W / 2, H / 2);
    return;
  }

  // 値の範囲（y軸）：通常の系列はpts、複数年重ね描きの系列はlinePathsの全点から求める。
  let vMin = Infinity, vMax = -Infinity;
  valid.forEach((s) => {
    const pointsList = s.linePaths?.length ? s.linePaths : [s.pts];
    pointsList.forEach((pts) => pts.forEach((p) => { if (p.v < vMin) vMin = p.v; if (p.v > vMax) vMax = p.v; }));
  });
  if (!isFinite(vMin) || !isFinite(vMax) || vMin === vMax) { vMin = (vMin || 100) - 10; vMax = (vMax || 100) + 10; }
  const spread = vMax - vMin;
  vMin -= spread * 0.08; vMax += spread * 0.08;
  const yTicks = [0, 1, 2, 3, 4].map((i) => vMin + ((vMax - vMin) * i) / 4);

  // 左余白：縦軸の目盛りラベルの実際の幅から決める（非表示なら最小限の余白にする）。
  let maxYLabelW = 0;
  if (yTickSize > 0) {
    ctx.font = `${yTickSize}px sans-serif`;
    yTicks.forEach((v) => { maxYLabelW = Math.max(maxYLabelW, ctx.measureText(v.toFixed(0)).width); });
  }
  const xAxisH = xTickSize > 0 ? xTickSize + 20 : 0; // 横軸の目盛り行の高さ（非表示なら0＝その分プロット領域が広がる）
  const padTop = (title ? titleSize + 50 : 50) + 20;
  const padBottom = xAxisH + legendTop + Math.max(1, valid.length) * legendLineH + 20;
  const pad = { l: yTickSize > 0 ? maxYLabelW + 30 : 20, r: format === "long" ? 60 : 50, t: padTop, b: padBottom };
  const plot = { x: pad.l, y: pad.t, w: W - pad.l - pad.r, h: Math.max(60, H - pad.t - pad.b) };
  const yOf = (v) => plot.y + plot.h * (1 - (v - vMin) / (vMax - vMin));
  const xOf = (t) => plot.x + plot.w * t;

  // グリッド＋縦軸の目盛り値（5分割）。グリッド線自体は目盛りサイズに関わらず常に描く。
  ctx.strokeStyle = C.borderSoft; ctx.lineWidth = 1.5;
  if (yTickSize > 0) { ctx.fillStyle = C.textDim; ctx.font = `${yTickSize}px sans-serif`; ctx.textAlign = "right"; ctx.textBaseline = "middle"; }
  yTicks.forEach((v) => {
    const y = yOf(v);
    ctx.beginPath(); ctx.moveTo(plot.x, y); ctx.lineTo(plot.x + plot.w, y); ctx.stroke();
    if (yTickSize > 0) ctx.fillText(v.toFixed(0), plot.x - 16, y);
  });

  // 横軸の目盛り値（期間の進捗％、5分割の目印＋文字）。複数の期間・年セットを重ねられるツールのため、
  // 実際の日付ではなく期間に対する進捗（0%〜100%）で統一して表示する。非表示（xTickSize=0）なら何も描かない。
  if (xTickSize > 0) {
    ctx.strokeStyle = C.borderSoft; ctx.lineWidth = 1.5;
    ctx.fillStyle = C.textDim; ctx.font = `${xTickSize}px sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "top";
    buildXAxisTicks(xAxis).forEach(({ t, label }) => {
      const x = xOf(t), tickY = plot.y + plot.h;
      ctx.beginPath(); ctx.moveTo(x, tickY); ctx.lineTo(x, tickY + 8); ctx.stroke();
      ctx.fillText(label, x, tickY + 14);
    });
  }

  // 基準線（期間開始時点＝100）
  if (vMin < 100 && vMax > 100) {
    ctx.save(); ctx.setLineDash([8, 10]); ctx.strokeStyle = C.textMuted; ctx.lineWidth = 2;
    const y100 = yOf(100);
    ctx.beginPath(); ctx.moveTo(plot.x, y100); ctx.lineTo(plot.x + plot.w, y100); ctx.stroke();
    ctx.restore();
  }

  // 各系列の折れ線。linePathsがある系列（複数年の重ね描き）は、個々の年の推移を薄い白線で全て描く
  // （終点が年ごとにバラバラになるため、終点ドットは描かない）。
  valid.forEach((s) => {
    if (s.linePaths?.length) {
      ctx.strokeStyle = "rgba(255,255,255,0.3)"; ctx.lineWidth = format === "long" ? 1.5 : 2; ctx.lineJoin = "round"; ctx.lineCap = "round";
      s.linePaths.forEach((pts) => {
        ctx.beginPath();
        pts.forEach((p, i) => { const x = xOf(p.t), y = yOf(p.v); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
        ctx.stroke();
      });
      return;
    }
    ctx.strokeStyle = s.color; ctx.lineWidth = format === "long" ? 5 : 6; ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.beginPath();
    s.pts.forEach((p, i) => { const x = xOf(p.t), y = yOf(p.v); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
    ctx.stroke();
    const last = s.pts[s.pts.length - 1];
    ctx.fillStyle = s.color;
    ctx.beginPath(); ctx.arc(xOf(last.t), yOf(last.v), format === "long" ? 7 : 8, 0, Math.PI * 2); ctx.fill();
  });

  // 凡例（系列名＋期間終端時点の騰落率）。重ね描き系列は終点が複数あり％では語れないため、本数を添える。
  const legendY0 = plot.y + plot.h + xAxisH + legendTop;
  ctx.font = `${bodySize}px sans-serif`; ctx.textAlign = "left"; ctx.textBaseline = "middle";
  valid.forEach((s, i) => {
    const y = legendY0 + i * legendLineH;
    ctx.fillStyle = s.linePaths?.length ? "rgba(255,255,255,0.65)" : s.color;
    ctx.fillRect(plot.x, y - bodySize * 0.35, bodySize * 0.9, bodySize * 0.7);
    ctx.fillStyle = C.text;
    if (s.linePaths?.length) {
      ctx.fillText(`${s.label}（${s.linePaths.length}本）`, plot.x + bodySize * 1.3, y);
    } else {
      const last = s.pts[s.pts.length - 1];
      const diff = last.v - 100;
      const sign = diff >= 0 ? "+" : "";
      ctx.fillText(`${s.label}（${sign}${diff.toFixed(1)}%）`, plot.x + bodySize * 1.3, y);
    }
  });
}
