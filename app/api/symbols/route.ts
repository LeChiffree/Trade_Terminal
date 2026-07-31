import { NextResponse } from "next/server";
import { fetchTopBinanceSymbols } from "@/lib/binance";

export const runtime = "edge";

export async function GET() {
  const directory = await fetchTopBinanceSymbols(50);
  return NextResponse.json(directory, {
    headers: {
      "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
    },
  });
}
