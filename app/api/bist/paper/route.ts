import {
  getBistPaperTradingStatus,
} from "@/lib/bist-paper-trading";

export const dynamic = "force-dynamic";

export async function GET() {
  let database: D1Database | undefined;
  try {
    const cloudflare = await import("cloudflare:workers");
    database = (cloudflare.env as { DB?: D1Database }).DB;
  } catch {
    database = undefined;
  }
  if (!database) {
    return Response.json(
      {
        configured: false,
        error: "BIST paper trade veritabanı yapılandırılmadı.",
        delayedMinutes: 15,
        openPositions: [],
        history: [],
      },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
  try {
    return Response.json(await getBistPaperTradingStatus(database), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      {
        configured: false,
        error: "BIST paper trade durumu şu anda okunamadı.",
        delayedMinutes: 15,
        openPositions: [],
        history: [],
      },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
