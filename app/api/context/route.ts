import { NextResponse } from "next/server";
import { fetchMarketContext } from "@/lib/market-context";

export const runtime = "edge";

export async function GET() {
  const context = await fetchMarketContext();
  return NextResponse.json(context, {
    headers: {
      "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
    },
  });
}
