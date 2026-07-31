import {
  getScannerStatus,
  type ScannerEnv,
} from "@/lib/background-scanner";

export const dynamic = "force-dynamic";

export async function GET() {
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
