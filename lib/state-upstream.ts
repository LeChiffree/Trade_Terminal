const UPSTREAM_TIMEOUT_MS = 12_000;

function configuredUpstream(name: string, expectedPath: string) {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  const url = new URL(raw);
  const privateScanner =
    url.protocol === "http:" &&
    url.hostname === "scanner" &&
    url.port === "8791";
  if (
    (url.protocol !== "https:" && !privateScanner) ||
    url.username ||
    url.password ||
    url.pathname !== expectedPath ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${name} güvenli bir ${expectedPath} adresi olmalıdır.`);
  }
  return { url, privateScanner };
}

export async function fetchStateUpstream(
  environmentName: string,
  expectedPath: string,
) {
  const upstream = configuredUpstream(environmentName, expectedPath);
  if (!upstream) return null;
  const bearer = process.env.SITES_SYNC_BEARER_TOKEN?.trim();
  if (!upstream.privateScanner && !bearer) {
    throw new Error("Sites durum okuma anahtarı yapılandırılmadı.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  let response: Response;
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (!upstream.privateScanner) {
      headers["OAI-Sites-Authorization"] = `Bearer ${bearer}`;
    }
    response = await fetch(upstream.url.toString(), {
      method: "GET",
      headers,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  if (response.redirected) {
    throw new Error("Sites durum isteği beklenmeyen biçimde yönlendirildi.");
  }
  const body = await response.arrayBuffer();
  return new Response(body, {
    status: response.status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": response.headers.get("Content-Type") ?? "application/json",
    },
  });
}
