import {
  getBistPaperTradingStatus,
  runBistPaperTradingCycleIfDue,
} from "@/lib/bist-paper-trading";
import { fetchStateUpstream } from "@/lib/state-upstream";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const upstream = await fetchStateUpstream(
      "BIST_PAPER_STATUS_UPSTREAM_URL",
      "/api/bist/paper",
    );
    if (upstream) return upstream;
  } catch {
    return Response.json(
      {
        configured: false,
        error: "Uzak BIST paper trade durumu şu anda okunamadı.",
        delayedMinutes: 15,
        openPositions: [],
        history: [],
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
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
    try {
      await runBistPaperTradingCycleIfDue(database, Date.now());
    } catch {
      // Status still exposes the persisted provider error and last good state.
    }
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
