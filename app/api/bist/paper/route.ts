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
  } catch (error) {
    console.error(
      "BIST paper state upstream failed",
      error instanceof Error ? error.message : "unknown error",
    );
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
  let algorithmExecutionEnabled = false;
  try {
    const cloudflare = await import("cloudflare:workers");
    const env = cloudflare.env as {
      DB?: D1Database;
      ALGORITHM_EXECUTION_ENABLED?: string;
    };
    database = env.DB;
    algorithmExecutionEnabled = ["1", "true", "yes", "on"].includes(
      String(env.ALGORITHM_EXECUTION_ENABLED ?? "").trim().toLowerCase(),
    );
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
    if (algorithmExecutionEnabled) {
      try {
        await runBistPaperTradingCycleIfDue(database, Date.now());
      } catch {
        // Status still exposes the persisted provider error and last good state.
      }
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
