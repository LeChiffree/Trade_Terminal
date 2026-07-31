import {
  runScannerTick,
  type ScannerEnv,
} from "@/lib/background-scanner";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function secureMatch(received: string, expected: string) {
  const encoder = new TextEncoder();
  const [receivedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(received)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(receivedHash);
  const right = new Uint8Array(expectedHash);
  let difference = left.length ^ right.length;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

export async function POST(request: Request) {
  const received = String(request.headers.get("X-QuantScope-Trigger") ?? "");
  if (!received) {
    return Response.json(
      { error: "Yetkisiz tarayıcı tetikleme isteği." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const cloudflare = await import("cloudflare:workers");
  const env = cloudflare.env as unknown as ScannerEnv;
  const expected = String(env.SCANNER_TRIGGER_KEY ?? "");

  if (!expected) {
    return Response.json(
      { error: "Tarayıcı tetikleme anahtarı yapılandırılmadı." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!(await secureMatch(received, expected))) {
    return Response.json(
      { error: "Yetkisiz tarayıcı tetikleme isteği." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    return Response.json(await runScannerTick(env, Date.now()), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message.slice(0, 300) : "Tarama turu başarısız.";
    return Response.json(
      { error: message },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
