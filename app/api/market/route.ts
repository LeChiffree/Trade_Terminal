import { fetchBinanceMarket, normalizeMarketQuery } from "@/lib/binance";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const { symbol, interval } = normalizeMarketQuery(url.searchParams.get("symbol"), url.searchParams.get("interval"));
  const market = await fetchBinanceMarket(symbol, interval);
  return Response.json(market, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
