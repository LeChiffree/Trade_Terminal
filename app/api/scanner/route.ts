import {
  getScannerStatus,
  type ScannerEnv,
} from "@/lib/background-scanner";
import { fetchStateUpstream } from "@/lib/state-upstream";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const upstream = await fetchStateUpstream(
      "SCANNER_STATUS_UPSTREAM_URL",
      "/api/scanner",
    );
    if (upstream) return upstream;
  } catch (error) {
    console.error(
      "Scanner state upstream failed",
      error instanceof Error ? error.message : "unknown error",
    );
    return Response.json(
      {
        configured: false,
        error: "Uzak tarayıcı durumu şu anda okunamadı.",
        intervals: [],
        leaders: [],
        alerts: [],
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  const cloudflare = await import("cloudflare:workers");
  const database = (cloudflare.env as unknown as ScannerEnv).DB;
  if (!database) {
    return Response.json(
      {
        configured: false,
        error: "Arka plan tarayıcı veritabanı yapılandırılmadı.",
        intervals: [],
        leaders: [],
        alerts: [],
      },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  try {
    return Response.json(await getScannerStatus(database), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      {
        configured: false,
        error: "Arka plan tarayıcı durumu şu anda okunamadı.",
        intervals: [],
        leaders: [],
        alerts: [],
      },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
