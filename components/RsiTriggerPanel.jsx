"use client";

// VOO・QQQ専用「RSIトリガー＆撤退実日数管理」パネル（設定・現在の状態・バックテスト比較・全トレード履歴）。
// ロジックは lib/rsiTrigger.ts。設定（買いRSI・売りRSI・撤退実日数・保有ポジション・基準投入額）は DDDashboard が保存・同期する。
import { useMemo, useState } from "react";
import { backtestRsiTrigger, statusFor, calDays, ymd, MMF_RATE } from "@/lib/rsiTrigger";

const C = {
  bg: "#0A0F1C", panel: "#111A2C", panel2: "#0D1424", border: "#22304C", borderSoft: "#1A2540",
  text: "#E7ECF3", textMuted: "#8592AC", textDim: "#56637F",
  teal: "#45C4B0", amber: "#D9A24B", rust: "#C0654B", violet: "#8B7FC7", blue: "#5B90C7",
};
const INSTRUMENTS = [{ key: "voo", label: "VOO" }, { key: "qqq", label: "QQQ" }];
const man = (yen) => (yen == null ? "—" : `${(yen / 10000).toFixed(1)}万円`);
const pct = (v, digits = 1) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%`);
const todayUtc = () => { const d = new Date(); return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); };

/** ステータスのバッジ（ダッシュボードのステータス欄でも使う） */
export function rsiBadge(st, s) {
  if (!st) return { text: "データ未取り込み", short: "—", color: C.textDim, filled: false };
  switch (st.kind) {
    case "buy": return { text: "買いサイン点灯！", short: "買いサイン！", color: C.teal, filled: true };
    case "take": return { text: "利確サイン点灯！", short: "利確サイン！", color: C.rust, filled: true };
    case "timeout": return { text: "期限撤退サイン（タイムストップ）", short: "期限撤退！", color: C.amber, filled: true };
    case "hold": return { text: "保有中（カウントダウン）", short: `保有中 残り${st.remaining}日`, color: C.blue, filled: false };
    default: return { text: "待機中", short: `待機中（買い≦${s.buy}）`, color: C.textMuted, filled: false };
  }
}

function NumField({ label, value, onChange, step = 1, min, max, suffix }) {
  return (
    <label className="flex items-center justify-between gap-2 text-[12px]" style={{ color: C.textMuted }}>
      <span>{label}</span>
      <span className="flex items-center gap-1">
        <input type="number" value={value} step={step} min={min} max={max} onChange={(e) => { const v = Number(e.target.value); if (e.target.value !== "" && isFinite(v)) onChange(v); }}
          className="mono text-right rounded px-2 py-1" style={{ width: 80, background: C.panel2, border: `1px solid ${C.borderSoft}`, color: C.text }} />
        {suffix && <span className="text-[11px]" style={{ color: C.textDim, width: 28 }}>{suffix}</span>}
      </span>
    </label>
  );
}

function Card({ title, right, children, accent }) {
  return (
    <div className="rounded-lg p-3 flex flex-col gap-2" style={{ background: C.panel, border: `1px solid ${accent || C.border}` }}>
      {(title || right) && <div className="flex items-center justify-between gap-2"><div className="text-[12px] font-bold" style={{ color: C.text }}>{title}</div>{right}</div>}
      {children}
    </div>
  );
}

function StatusCard({ label, d, s, base, onSetPosition, autoPosition, today }) {
  const st = statusFor(d?.FULL, s, base, today);
  const b = rsiBadge(st, s);
  const last = d?.last;
  const [date, setDate] = useState(s.position?.date ?? (last ? ymd(last.date) : ""));
  const [price, setPrice] = useState(s.position?.price ?? (last ? Number(last.price.toFixed(2)) : ""));
  return (
    <Card title={`${label}　現在の状態`} accent={b.filled ? b.color : undefined}
      right={<span className="text-[12px] font-bold px-2 py-0.5 rounded" style={{ color: b.filled ? C.bg : b.color, background: b.filled ? b.color : "transparent", border: `1px solid ${b.color}` }}>{b.text}</span>}>
      {!st ? <div className="text-[12px]" style={{ color: C.textDim }}>{label}のトラックレコードが未取り込みです。</div> : (<>
        <div className="mono text-[13px] flex flex-wrap gap-x-4 gap-y-1" style={{ color: C.text }}>
          <span>終値 <b>${last.price.toFixed(2)}</b>（{ymd(last.date)}）</span>
          <span>14日RSI <b style={{ color: st.rsi != null && st.rsi <= s.buy ? C.teal : st.rsi != null && st.rsi >= s.sell ? C.rust : C.violet }}>{st.rsi != null ? st.rsi.toFixed(1) : "—"}</b></span>
        </div>
        {st.kind === "wait" && <div className="text-[12px]" style={{ color: C.textMuted }}>次の買付目標：RSI ≦ <b style={{ color: C.teal }}>{s.buy}</b>（あと {st.toBuy?.toFixed(1)} ポイント）</div>}
        {st.kind === "buy" && <div className="text-[12px]" style={{ color: C.teal }}>14日RSIが買いトリガー（≦{s.buy}）に達しています。買付したら下で買付日・買付価格を登録してください。</div>}
        {(st.kind === "hold" || st.kind === "take" || st.kind === "timeout") && (<>
          <div className="mono text-[12px] flex flex-wrap gap-x-4 gap-y-1" style={{ color: C.textMuted }}>
            <span>買付 {s.position.date}・${s.position.price.toFixed(2)}</span>
            <span>経過 <b style={{ color: C.text }}>{st.elapsed}日</b> ／ 撤退 {s.exitDays}日</span>
            <span>撤退期限 <b style={{ color: C.text }}>{ymd(st.deadline)}</b>（残り <b style={{ color: st.remaining <= 14 ? C.amber : C.text }}>{Math.max(0, st.remaining)}日</b>）</span>
          </div>
          <div className="rounded-full overflow-hidden" style={{ height: 8, background: C.panel2, border: `1px solid ${C.borderSoft}` }}>
            <div style={{ width: `${Math.round(st.progress * 100)}%`, height: "100%", background: st.kind === "timeout" ? C.amber : st.progress > 0.85 ? C.amber : C.blue }} />
          </div>
          <div className="mono text-[13px]" style={{ color: C.text }}>
            含み損益 <b style={{ color: st.pnlYen >= 0 ? C.teal : C.rust }}>{st.pnlYen >= 0 ? "+" : ""}{Math.round(st.pnlYen).toLocaleString()}円（{pct(st.pnlPct)}）</b>
            <span className="text-[11px] ml-2" style={{ color: C.textDim }}>評価額 {man(st.value)}（基準投入額 {base}万円）</span>
          </div>
          {st.kind === "take" && <div className="text-[12px] font-bold" style={{ color: C.rust }}>14日RSIが売りトリガー（≧{s.sell}）に達しました。利確を検討してください。</div>}
          {st.kind === "timeout" && <div className="text-[12px] font-bold" style={{ color: C.amber }}>買付から{st.elapsed}日経過し、撤退ライン（{s.exitDays}日）に達しました。期限撤退を検討してください。</div>}
        </>)}
        <div className="flex flex-wrap items-center gap-2 pt-1" style={{ borderTop: `1px dashed ${C.borderSoft}` }}>
          <span className="text-[11px]" style={{ color: C.textDim }}>保有ポジション</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mono text-[12px] rounded px-1.5 py-0.5" style={{ background: C.panel2, border: `1px solid ${C.borderSoft}`, color: C.text, colorScheme: "dark" }} />
          <span className="text-[11px]" style={{ color: C.textDim }}>$</span>
          <input type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} className="mono text-[12px] text-right rounded px-1.5 py-0.5" style={{ width: 86, background: C.panel2, border: `1px solid ${C.borderSoft}`, color: C.text }} />
          <button onClick={() => { const p = Number(price); if (/^\d{4}-\d{2}-\d{2}$/.test(date) && p > 0) onSetPosition({ date, price: p }); }} className="text-[11px] px-2 py-0.5 rounded" style={{ background: C.teal, color: C.bg, fontWeight: 700, border: "none", cursor: "pointer" }}>{s.position ? "更新" : "買付を登録"}</button>
          {autoPosition && <button onClick={() => { setDate(ymd(autoPosition.buyDate)); setPrice(Number(autoPosition.buyPrice.toFixed(2))); onSetPosition({ date: ymd(autoPosition.buyDate), price: Number(autoPosition.buyPrice.toFixed(2)) }); }} title="バックテスト上の保有中ポジション（最後の買いサインの日の終値）を登録します" className="text-[11px] px-2 py-0.5 rounded" style={{ background: "transparent", color: C.teal, border: `1px solid ${C.teal}66`, cursor: "pointer" }}>データから自動判定（{ymd(autoPosition.buyDate)}）</button>}
          {s.position && <button onClick={() => onSetPosition(null)} className="text-[11px] px-2 py-0.5 rounded" style={{ background: "transparent", color: C.textMuted, border: `1px solid ${C.borderSoft}`, cursor: "pointer" }}>売却済み（登録を解除）</button>}
        </div>
      </>)}
    </Card>
  );
}

export default function RsiTriggerPanel({ settings, onChange, dVoo, dQqq }) {
  const [histTab, setHistTab] = useState("voo");
  const today = todayUtc();
  const ds = { voo: dVoo, qqq: dQqq };
  const setInst = (key, patch) => onChange({ ...settings, [key]: { ...settings[key], ...patch } });
  const bt = useMemo(() => {
    const out = {};
    for (const { key } of INSTRUMENTS) {
      const d = ds[key], s = settings[key];
      out[key] = d?.FULL?.length ? backtestRsiTrigger(d.FULL, { buy: s.buy, sell: s.sell, exitDays: s.exitDays, base: settings.base * 10000, mmfRate: MMF_RATE }) : null;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dVoo, dQqq, settings.base, settings.voo.buy, settings.voo.sell, settings.voo.exitDays, settings.qqq.buy, settings.qqq.sell, settings.qqq.exitDays]);

  const rows = [
    ["検証期間", (r) => (r?.summary.from ? `${ymd(r.summary.from)}〜${ymd(r.summary.to)}` : "—")],
    ["決済回数", (r) => (r ? `${r.summary.closed}回` : "—")],
    ["勝率", (r) => (r?.summary.winRate == null ? "—" : `${r.summary.winRate.toFixed(1)}%`)],
    ["平均保有実日数", (r) => (r?.summary.avgDays == null ? "—" : `${r.summary.avgDays.toFixed(0)}日`)],
    ["1回あたり平均評価額", (r) => man(r?.summary.avgValue)],
    ["最低評価額（売却時）", (r) => man(r?.summary.minValue)],
    ["IRR（年率）", (r) => pct(r?.summary.irr)],
    ["保有期間中の年率（複利）", (r) => pct(r?.summary.heldCagr)],
    [`通算年率（待機中はMMF年${(MMF_RATE * 100).toFixed(1)}%）`, (r) => pct(r?.summary.cagrWithMmf)],
    ["参考：ずっと保有した場合の年率", (r) => pct(r?.summary.buyHoldCagr)],
    ["現在のポジション（バックテスト上）", (r) => (r?.summary.open ? `保有中（${ymd(r.summary.open.buyDate)}〜・${pct(r.summary.open.ret)}）` : "待機中")],
  ];
  const hist = (bt[histTab]?.trades || []).slice().reverse();

  return (
    <div className="flex flex-col gap-3 text-[12px]" style={{ color: C.text }}>
      {/* 1. 設定 */}
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
        <Card title="共通設定">
          <NumField label="1回あたりの基準投入額" value={settings.base} min={1} step={10} suffix="万円" onChange={(v) => onChange({ ...settings, base: Math.max(1, v) })} />
          <div className="text-[11px] leading-relaxed" style={{ color: C.textDim }}>待機期間はMMF（年利{(MMF_RATE * 100).toFixed(1)}%）で運用したとみなして通算年率を計算します。数値を変えるとバックテストをすぐ再計算します。</div>
        </Card>
        {INSTRUMENTS.map(({ key, label }) => (
          <Card key={key} title={`${label} 設定`}>
            <NumField label="買いトリガー（14日RSI 以下）" value={settings[key].buy} min={1} max={99} onChange={(v) => setInst(key, { buy: v })} />
            <NumField label="売り利確トリガー（14日RSI 以上）" value={settings[key].sell} min={1} max={99} onChange={(v) => setInst(key, { sell: v })} />
            <NumField label="撤退ライン（実日数・暦日）" value={settings[key].exitDays} min={1} step={5} suffix="日" onChange={(v) => setInst(key, { exitDays: Math.max(1, Math.round(v)) })} />
          </Card>
        ))}
      </div>

      {/* 2. 現在の状態 */}
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))" }}>
        {INSTRUMENTS.map(({ key, label }) => (
          <StatusCard key={key} label={label} d={ds[key]} s={settings[key]} base={settings.base} today={today}
            autoPosition={bt[key]?.summary.open ?? null} onSetPosition={(position) => setInst(key, { position })} />
        ))}
      </div>

      {/* 3. バックテスト比較 */}
      <Card title="バックテスト比較（VOO / QQQ）">
        <table className="mono w-full text-[12px]" style={{ borderCollapse: "collapse" }}>
          <thead><tr style={{ color: C.textDim }}><th className="text-left font-normal py-1">指標</th>{INSTRUMENTS.map(({ key, label }) => <th key={key} className="text-right font-normal py-1">{label}（買い≦{settings[key].buy}・売り≧{settings[key].sell}・{settings[key].exitDays}日）</th>)}</tr></thead>
          <tbody>
            {rows.map(([name, f]) => (
              <tr key={name} style={{ borderTop: `1px solid ${C.borderSoft}`, color: C.text }}>
                <td className="py-1" style={{ color: C.textMuted }}>{name}</td>
                {INSTRUMENTS.map(({ key }) => <td key={key} className="py-1 text-right">{f(bt[key])}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="text-[10px] leading-relaxed" style={{ color: C.textDim }}>
          RSIトリガーに達した日の終値で売買した場合の検証です（1銘柄につき1ポジション・同じ日の買い直しなし）。評価額は1回あたり基準投入額{settings.base}万円を投じた場合。
          IRRは決済したトレードの買付・売却の金額（日付付き）から計算した内部収益率です（検証期間が長いと古いトレードの比重が大きくなります）。保有期間中の年率は、各トレードの騰落を複利でつなぎ保有実日数の合計で年率にした値、通算年率は資金をまとめて回し、待機中はMMFで運用した場合の年率です。過去のデータ（VOO・QQQの上場前は指数を換算した値）にもとづく参考値で、将来を保証するものではありません。
        </div>
      </Card>

      {/* 4. 全ターム履歴 */}
      <Card title="全ターム履歴" right={<div className="flex gap-0.5">{INSTRUMENTS.map(({ key, label }) => (<button key={key} onClick={() => setHistTab(key)} className="text-[11px] px-2 py-0.5 rounded" style={{ color: histTab === key ? C.bg : C.textMuted, background: histTab === key ? C.violet : "transparent", fontWeight: histTab === key ? 700 : 400, border: `1px solid ${histTab === key ? C.violet : C.borderSoft}`, cursor: "pointer" }}>{label}（{bt[key]?.trades.length ?? 0}）</button>))}</div>}>
        <div style={{ maxHeight: 360, overflowY: "auto" }}>
          <table className="mono w-full text-[12px]" style={{ borderCollapse: "collapse" }}>
            <thead style={{ position: "sticky", top: 0, background: C.panel }}><tr style={{ color: C.textDim }}>
              {["買付日", "売却日", "保有実日数", "売却理由", "売却時評価額", "騰落率"].map((h) => <th key={h} className="font-normal py-1 text-right first:text-left">{h}</th>)}
            </tr></thead>
            <tbody>
              {hist.map((t, i) => (
                <tr key={i} style={{ borderTop: `1px solid ${C.borderSoft}`, color: C.text }}>
                  <td className="py-1">{ymd(t.buyDate)}</td>
                  <td className="py-1 text-right" style={{ color: t.sellDate ? C.text : C.blue }}>{t.sellDate ? ymd(t.sellDate) : "保有中"}</td>
                  <td className="py-1 text-right">{t.days}日</td>
                  <td className="py-1 text-right" style={{ color: t.reason === "RSI利確" ? C.teal : t.reason === "期限撤退" ? C.amber : C.blue }}>{t.reason}</td>
                  <td className="py-1 text-right">{man(t.value)}</td>
                  <td className="py-1 text-right" style={{ color: t.ret >= 0 ? C.teal : C.rust }}>{pct(t.ret)}</td>
                </tr>
              ))}
              {!hist.length && <tr><td colSpan={6} className="py-3 text-center" style={{ color: C.textDim }}>この設定ではトレードがありません。</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
