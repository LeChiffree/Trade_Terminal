import {
  fetchTopBistSymbols,
  normalizeBistQuery,
} from "@/lib/bist";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const { interval } = normalizeBistQuery(
    null,
    url.searchParams.get("interval"),
  );
  const directory = await fetchTopBistSymbols(interval, 80);
  return Response.json(directory, {
    headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=30" },
  });
}
