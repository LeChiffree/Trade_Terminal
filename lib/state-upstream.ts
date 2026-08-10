const UPSTREAM_TIMEOUT_MS = 12_000;

function configuredUpstream(name: string, expectedPath: string) {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== expectedPath ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${name} güvenli bir ${expectedPath} adresi olmalıdır.`);
  }
  return url;
}

export async function fetchStateUpstream(
  environmentName: string,
  expectedPath: string,
) {
  const url = configuredUpstream(environmentName, expectedPath);
  if (!url) return null;
  const bearer = process.env.SITES_SYNC_BEARER_TOKEN?.trim();
  if (!bearer) {
    throw new Error("Sites durum okuma anahtarı yapılandırılmadı.");
  }

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "OAI-Sites-Authorization": `Bearer ${bearer}`,
    },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  const body = await response.arrayBuffer();
  return new Response(body, {
    status: response.status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": response.headers.get("Content-Type") ?? "application/json",
    },
  });
}
