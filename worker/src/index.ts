// GET /api/stock-prices
// 当日のVOO・QQQの終値をTwelve Data APIから取得して返す。
// （Stooqはサーバーサイドfetchに対するBot対策のJS認証チャレンジを導入したため利用不可）
// S&P500指数そのもの（SPXシンボル）はTwelve Data無料プランでは利用不可（403）のため取得しない。
// S&P500はダッシュボード側で既存のStooq CSV取り込み・直接入力を使い続ける運用とする。
// 応答: { date: "YYYY-MM-DD", voo: number, qqq: number, gold?: number, goldDate?: "YYYY-MM-DD" }
//   gold はゴールド（XAU/USD、Twelve Data無料プランで取得可）の最新値。取得できなかった場合は省略し、VOO/QQQだけ返す。
//   Twelve Dataの日足には土日の日付（金曜値の据え置き）が混じることがあるため、goldDateが土日の場合も省略する。
// 失敗時: 502 + { error: "データ取得失敗。稼働時間外の可能性があります" }
//
// 事前準備: Twelve Data (https://twelvedata.com/) でAPIキーを取得し、
//   npx wrangler secret put TWELVE_DATA_API_KEY
// で登録してください（無料プランで動作しますが、レート制限にご注意ください）。

import Anthropic from "@anthropic-ai/sdk";
import { extractHoldings, type ExtractImage } from "./extractHoldings";
import { computeChanges, fetchDailyCloses, shiftMonths, type Close } from "./marketSummary";

export interface Env {
  TWELVE_DATA_API_KEY: string;
  ANTHROPIC_API_KEY: string;
  SYNC_TOKEN: string;
  DD_SYNC_KV: KVNamespace;
}

const SYMBOLS = { voo: "VOO", qqq: "QQQ", gold: "XAU/USD" } as const;
// GET /api/gold-history の1回あたりの最大取得件数（Twelve Data time_seriesの上限。日次で約20年分、1回=1クレジット）
const GOLD_HISTORY_MAX_POINTS = 5000;
// 土日（ゴールド市場の休場日）の日付か。Twelve Dataの日足に混じる金曜値の据え置きレコードを除くために使う。
function isWeekendDate(ymd: string): boolean { const w = new Date(ymd + "T00:00:00Z").getUTCDay(); return w === 0 || w === 6; }

const SYNC_KV_KEY = "dd-dashboard-data";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Sync-Token",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS },
  });
}

type TwelveDataQuote = { symbol?: string; close?: string; datetime?: string; code?: number; message?: string };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

    const url = new URL(request.url);

    if (url.pathname === "/sync") {
      if (request.headers.get("X-Sync-Token") !== env.SYNC_TOKEN) {
        return jsonResponse({ error: "unauthorized" }, 401);
      }
      if (request.method === "GET") {
        const stored = await env.DD_SYNC_KV.get(SYNC_KV_KEY);
        return jsonResponse(stored ? JSON.parse(stored) : { updatedAt: null, data: {} });
      }
      if (request.method === "PUT") {
        let body: { data?: unknown };
        try {
          body = (await request.json()) as { data?: unknown };
        } catch {
          return jsonResponse({ error: "invalid JSON" }, 400);
        }
        const payload = { updatedAt: new Date().toISOString(), data: body?.data ?? {} };
        await env.DD_SYNC_KV.put(SYNC_KV_KEY, JSON.stringify(payload));
        return jsonResponse(payload);
      }
      return jsonResponse({ error: "method not allowed" }, 405);
    }

    // POST /api/extract-holdings
    // 証券会社アプリの保有銘柄スクリーンショットをClaude（Vision）で読み取り、銘柄ごとのデータを返す。
    // APIキーをクライアントに置かないためWorker経由で呼ぶ。/syncと同じX-Sync-Tokenで保護する（第三者による無断利用防止）。
    // 事前準備: npx wrangler secret put ANTHROPIC_API_KEY
    // リクエスト: { broker: "moomoo", images: [{ mediaType: "image/jpeg", data: "<base64>" }] }
    if (url.pathname === "/api/extract-holdings") {
      if (request.method !== "POST") return jsonResponse({ error: "method not allowed" }, 405);
      if (request.headers.get("X-Sync-Token") !== env.SYNC_TOKEN) return jsonResponse({ error: "unauthorized" }, 401);
      if (!env.ANTHROPIC_API_KEY) return jsonResponse({ error: "ANTHROPIC_API_KEY が未設定です" }, 500);
      let body: { broker?: string; images?: ExtractImage[] };
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return jsonResponse({ error: "invalid JSON" }, 400);
      }
      const images = (body.images ?? []).filter((i) => i && typeof i.data === "string" && /^image\/(jpeg|png|webp|gif)$/.test(i.mediaType));
      if (!images.length || images.length > 10) return jsonResponse({ error: "画像を1〜10枚指定してください" }, 400);
      try {
        const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
        const result = await extractHoldings(client, String(body.broker ?? ""), images);
        return jsonResponse(result);
      } catch (e) {
        if (e instanceof Anthropic.RateLimitError) return jsonResponse({ error: "混み合っています。少し待って再試行してください" }, 429);
        if (e instanceof Anthropic.AuthenticationError) return jsonResponse({ error: "ANTHROPIC_API_KEY が無効です" }, 500);
        if (e instanceof Anthropic.APIError) return jsonResponse({ error: `Claude API エラー（${e.status}）: ${e.message}` }, 502);
        return jsonResponse({ error: e instanceof Error ? e.message : "読み取りに失敗しました" }, 502);
      }
    }

    // GET /api/fx
    // 米ドル建ての保有額を円換算するためのUSD/JPYレート（Twelve Data exchange_rate）。
    // 応答: { rate: number, timestamp: number }
    if (url.pathname === "/api/fx") {
      try {
        const res = await fetch(`https://api.twelvedata.com/exchange_rate?symbol=${encodeURIComponent("USD/JPY")}&apikey=${env.TWELVE_DATA_API_KEY}`);
        if (!res.ok) throw new Error(`twelvedata responded ${res.status}`);
        const data = (await res.json()) as { rate?: number | string; timestamp?: number };
        const rate = typeof data.rate === "string" ? parseFloat(data.rate) : data.rate;
        if (!rate || Number.isNaN(rate)) throw new Error("no rate");
        return jsonResponse({ rate, timestamp: data.timestamp ?? null });
      } catch {
        return jsonResponse({ error: "為替レートの取得に失敗しました" }, 502);
      }
    }

    // GET /api/gold-history?start_date=YYYY-MM-DD
    // ゴールド（XAU/USD）の日次終値の履歴（Twelve Data time_series、日付昇順）。start_date省略時は直近最大5000日分（2008年〜）。
    // 土日の日付（金曜値の据え置き）は除き、同じ日付が重複した場合は後に来た値（最新）を採用する。
    // ダッシュボードは保存済みデータに抜けがあるときだけ呼ぶ（毎回は呼ばない）ため、レート制限への影響は小さい。
    // 応答: { values: [{ date: "YYYY-MM-DD", close: number }] }
    if (url.pathname === "/api/gold-history") {
      const startDate = url.searchParams.get("start_date");
      if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return jsonResponse({ error: "start_date は YYYY-MM-DD で指定してください" }, 400);
      try {
        const params = new URLSearchParams({ symbol: SYMBOLS.gold, interval: "1day", outputsize: String(GOLD_HISTORY_MAX_POINTS), order: "ASC", apikey: env.TWELVE_DATA_API_KEY });
        if (startDate) params.set("start_date", startDate);
        const res = await fetch(`https://api.twelvedata.com/time_series?${params}`);
        if (!res.ok) throw new Error(`twelvedata responded ${res.status}`);
        const data = (await res.json()) as { status?: string; message?: string; values?: { datetime: string; close: string }[] };
        if (data.status !== "ok" || !Array.isArray(data.values)) throw new Error(data.message ?? "no values");
        const byDate = new Map<string, number>();
        for (const v of data.values) {
          const date = v.datetime.slice(0, 10), close = parseFloat(v.close);
          if (/^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(close) && !isWeekendDate(date)) byDate.set(date, close);
        }
        const values = [...byDate].map(([date, close]) => ({ date, close })).sort((a, b) => a.date.localeCompare(b.date));
        return jsonResponse({ values });
      } catch {
        return jsonResponse({ error: "ゴールドの価格履歴の取得に失敗しました" }, 502);
      }
    }

    // GET /api/market-summary
    // VOO・QQQ・ゴールド（XAU/USD）の最新終値と、前日・前週・前月・前年比（%）を返す。
    // 1日1回の呼び出しを想定（Twelve Data time_series を3銘柄分呼ぶ＝約3クレジット）。
    // 応答: { date, voo: {close,d1,w1,m1,y1}, qqq: {...}, gold?: {...} }
    // 失敗時: 502 + { error }
    if (url.pathname === "/api/market-summary") {
      try {
        const today = new Date().toISOString().slice(0, 10);
        const start = shiftMonths(today, 13); // 前年比の基準日（1年前）を確実に含むよう13か月分取得
        const [voo, qqq, gold] = await Promise.all([
          fetchDailyCloses("VOO", env.TWELVE_DATA_API_KEY, start),
          fetchDailyCloses("QQQ", env.TWELVE_DATA_API_KEY, start),
          fetchDailyCloses("XAU/USD", env.TWELVE_DATA_API_KEY, start).catch(() => [] as Close[]),
        ]);
        const isWeekend = (ymd: string) => { const w = new Date(ymd + "T00:00:00Z").getUTCDay(); return w === 0 || w === 6; };
        const goldTrading = gold.filter((p) => !isWeekend(p.date));
        const v = computeChanges(voo), q = computeChanges(qqq);
        if (!v || !q) throw new Error("insufficient series");
        const g = computeChanges(goldTrading);
        const date = voo[voo.length - 1].date;
        return jsonResponse({
          date,
          voo: v,
          qqq: q,
          ...(g ? { gold: { ...g, date: goldTrading[goldTrading.length - 1].date } } : {}),
        });
      } catch (e) {
        return jsonResponse({ error: "市場データの取得に失敗しました" }, 502);
      }
    }

    if (url.pathname !== "/api/stock-prices") return jsonResponse({ error: "not found" }, 404);

    try {
      const symbolList = Object.values(SYMBOLS).join(",");
      const apiUrl = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbolList)}&apikey=${env.TWELVE_DATA_API_KEY}`;
      const res = await fetch(apiUrl);
      if (!res.ok) throw new Error(`twelvedata responded ${res.status}`);
      const data = (await res.json()) as Record<string, TwelveDataQuote> | TwelveDataQuote;

      // 単一銘柄しか返らなかった場合など、レスポンスがフラットな形の可能性にも備える。
      let bySymbol: Record<string, TwelveDataQuote>;
      if ("symbol" in data && data.symbol) {
        bySymbol = { [data.symbol as string]: data as TwelveDataQuote };
      } else {
        bySymbol = data as Record<string, TwelveDataQuote>;
      }

      const get = (key: keyof typeof SYMBOLS) => {
        const q = bySymbol[SYMBOLS[key]];
        const close = q?.close != null ? parseFloat(q.close) : NaN;
        return { close, date: q?.datetime?.slice(0, 10) };
      };

      const voo = get("voo");
      const qqq = get("qqq");
      if ([voo, qqq].some((q) => !q.date || Number.isNaN(q.close))) {
        throw new Error("incomplete quote data");
      }

      // ゴールドは取得できた場合のみ付ける（失敗してもVOO/QQQの取得は成功扱いにする）
      const gold = get("gold");
      const goldPart = gold.date && !Number.isNaN(gold.close) && !isWeekendDate(gold.date) ? { gold: gold.close, goldDate: gold.date } : {};
      return jsonResponse({ date: voo.date, voo: voo.close, qqq: qqq.close, ...goldPart });
    } catch (e) {
      return jsonResponse({ error: "データ取得失敗。稼働時間外の可能性があります" }, 502);
    }
  },
};
