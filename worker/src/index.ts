// GET /api/stock-prices
// 当日のVOO・QQQの終値をTwelve Data APIから取得して返す。
// （Stooqはサーバーサイドfetchに対するBot対策のJS認証チャレンジを導入したため利用不可）
// S&P500指数そのもの（SPXシンボル）はTwelve Data無料プランでは利用不可（403）のため取得しない。
// S&P500はダッシュボード側で既存のStooq CSV取り込み・直接入力を使い続ける運用とする。
// 応答: { date: "YYYY-MM-DD", voo: number, qqq: number }
// 失敗時: 502 + { error: "データ取得失敗。稼働時間外の可能性があります" }
//
// 事前準備: Twelve Data (https://twelvedata.com/) でAPIキーを取得し、
//   npx wrangler secret put TWELVE_DATA_API_KEY
// で登録してください（無料プランで動作しますが、レート制限にご注意ください）。

import Anthropic from "@anthropic-ai/sdk";
import { extractHoldings, type ExtractImage } from "./extractHoldings";

export interface Env {
  TWELVE_DATA_API_KEY: string;
  ANTHROPIC_API_KEY: string;
  SYNC_TOKEN: string;
  DD_SYNC_KV: KVNamespace;
}

const SYMBOLS = { voo: "VOO", qqq: "QQQ" } as const;

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
        return { close, date: q?.datetime };
      };

      const voo = get("voo");
      const qqq = get("qqq");
      if ([voo, qqq].some((q) => !q.date || Number.isNaN(q.close))) {
        throw new Error("incomplete quote data");
      }

      return jsonResponse({ date: voo.date, voo: voo.close, qqq: qqq.close });
    } catch (e) {
      return jsonResponse({ error: "データ取得失敗。稼働時間外の可能性があります" }, 502);
    }
  },
};
