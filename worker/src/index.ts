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

export interface Env {
  TWELVE_DATA_API_KEY: string;
  SYNC_TOKEN: string;
  DD_SYNC_KV: KVNamespace;
}

const SYMBOLS = { voo: "VOO", qqq: "QQQ" } as const;

const SYNC_KV_KEY = "dd-dashboard-data";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
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
