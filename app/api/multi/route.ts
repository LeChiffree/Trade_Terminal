import { fetchBinanceCandles, normalizeMarketQuery } from "@/lib/binance";

export const dynamic = "force-dynamic";

const intervals = ["5m", "15m", "1h", "4h", "1d", "1w"];

export async function GET(request: Request) {
  const url = new URL(request.url);
  const { symbol } = normalizeMarketQuery(url.searchParams.get("symbol"), "15m");
  const results = await Promise.all(intervals.map(async (interval) => {
    const result = await fetchBinanceCandles(symbol, interval, 260);
    return [interval, result] as const;
  }));
  return Response.json({ symbol, intervals: Object.fromEntries(results), fetchedAt: Date.now() }, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
