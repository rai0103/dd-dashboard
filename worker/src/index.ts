// GET /api/stock-prices
// 当日のSPY・VOOの終値をTwelve Data APIから取得して返す。
// （Stooqはサーバーサイドfetchに対するBot対策のJS認証チャレンジを導入したため利用不可）
// S&P500指数そのもの（SPXシンボル）はTwelve Data無料プランでは利用不可（403）のため取得しない。
// S&P500はダッシュボード側で既存のStooq CSV取り込み・直接入力を使い続ける運用とする。
// 応答: { date: "YYYY-MM-DD", spy: number, voo: number }
// 失敗時: 502 + { error: "データ取得失敗。稼働時間外の可能性があります" }
//
// 事前準備: Twelve Data (https://twelvedata.com/) でAPIキーを取得し、
//   npx wrangler secret put TWELVE_DATA_API_KEY
// で登録してください（無料プランで動作しますが、レート制限にご注意ください）。

export interface Env {
  TWELVE_DATA_API_KEY: string;
}

const SYMBOLS = { spy: "SPY", voo: "VOO" } as const;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
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

      const spy = get("spy");
      const voo = get("voo");
      if ([spy, voo].some((q) => !q.date || Number.isNaN(q.close))) {
        throw new Error("incomplete quote data");
      }

      return jsonResponse({ date: spy.date, spy: spy.close, voo: voo.close });
    } catch (e) {
      return jsonResponse({ error: "データ取得失敗。稼働時間外の可能性があります" }, 502);
    }
  },
};
