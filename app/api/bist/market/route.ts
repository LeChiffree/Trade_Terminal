import {
  fetchBistMarket,
  normalizeBistQuery,
} from "@/lib/bist";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const { symbol, interval } = normalizeBistQuery(
    url.searchParams.get("symbol"),
    url.searchParams.get("interval"),
  );
  try {
    const market = await fetchBistMarket(symbol, interval);
    return Response.json(market, {
      headers: { "Cache-Control": "public, max-age=20, stale-while-revalidate=20" },
    });
  } catch {
    return Response.json(
      {
        error: "BIST gecikmeli mum verisi şu anda alınamıyor.",
        symbol,
        interval,
      },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
