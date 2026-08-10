import {
  ensureCatalogSchema,
  isCatalogSite,
  publicCatalogJob,
  secureMatch,
  type CatalogEnv,
  type CatalogJob,
} from "@/lib/catalog-jobs";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

async function runtimeEnv() {
  try {
    const cloudflare = await import("cloudflare:workers");
    return cloudflare.env as unknown as CatalogEnv;
  } catch {
    // Node-based artifact tests do not provide the Cloudflare runtime module.
    return {} as CatalogEnv;
  }
}

function ownerEmail(request: Request) {
  const authenticated = request.headers.get("oai-authenticated-user-email")?.trim();
  if (authenticated) return authenticated.toLowerCase().slice(0, 254);
  const host = new URL(request.url).hostname;
  return host === "localhost" || host === "127.0.0.1"
    ? "local@quantscope"
    : null;
}

async function requireWorker(request: Request, env: CatalogEnv) {
  const received = request.headers.get("X-QuantScope-Trigger") ?? "";
  const expected = String(env.SCANNER_TRIGGER_KEY ?? "");
  return Boolean(received && expected && await secureMatch(received, expected));
}

function json(payload: unknown, status = 200) {
  return Response.json(payload, { status, headers: NO_STORE });
}

export async function GET(request: Request) {
  const owner = ownerEmail(request);
  if (!owner) return json({ error: "Oturum gerekli." }, 401);
  const env = await runtimeEnv();
  if (!env.DB) return json({ error: "Katalog veritabanı bağlı değil." }, 503);
  await ensureCatalogSchema(env.DB);
  const url = new URL(request.url);
  const downloadId = url.searchParams.get("download");
  if (downloadId) {
    const job = await env.DB
      .prepare(
        `SELECT * FROM catalog_jobs
         WHERE id = ? AND owner_email = ? AND status = 'completed'`,
      )
      .bind(downloadId, owner)
      .first<CatalogJob>();
    if (!job?.object_key || !job.filename) return json({ error: "Dosya bulunamadı." }, 404);
    if (!env.FILES) return json({ error: "Dosya deposu bağlı değil." }, 503);
    const object = await env.FILES.get(job.object_key);
    if (!object) return json({ error: "Dosya bulunamadı." }, 404);
    const safeName = job.filename.replace(/[^A-Za-z0-9._-]/g, "_");
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    headers.set(
      "Content-Disposition",
      `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(job.filename)}`,
    );
    headers.set("Cache-Control", "private, no-store");
    headers.set("X-Content-Type-Options", "nosniff");
    return new Response(object.body, { headers });
  }

  const id = url.searchParams.get("id");
  if (id) {
    const job = await env.DB
      .prepare("SELECT * FROM catalog_jobs WHERE id = ? AND owner_email = ?")
      .bind(id, owner)
      .first<CatalogJob>();
    return job ? json({ job: publicCatalogJob(job) }) : json({ error: "İş bulunamadı." }, 404);
  }
  const result = await env.DB
    .prepare(
      `SELECT * FROM catalog_jobs
       WHERE owner_email = ? ORDER BY created_at DESC LIMIT 20`,
    )
    .bind(owner)
    .all<CatalogJob>();
  return json({ jobs: (result.results ?? []).map(publicCatalogJob) });
}

export async function POST(request: Request) {
  const env = await runtimeEnv();
  if (!env.DB) return json({ error: "Katalog veritabanı bağlı değil." }, 503);
  await ensureCatalogSchema(env.DB);
  let payload: Record<string, unknown>;
  try {
    payload = await request.json() as Record<string, unknown>;
  } catch {
    return json({ error: "Geçersiz istek." }, 400);
  }

  const action = String(payload.action ?? "create");
  if (action === "claim") {
    if (!(await requireWorker(request, env))) return json({ error: "Yetkisiz worker." }, 401);
    const now = Date.now();
    await env.DB
      .prepare(
        `UPDATE catalog_jobs
         SET status = 'queued', progress = 0,
             message = 'Worker yeniden bağlandı; iş sıraya alındı.', updated_at = ?
         WHERE status = 'running' AND updated_at < ?`,
      )
      .bind(now, now - 2 * 60 * 60 * 1000)
      .run();
    const candidate = await env.DB
      .prepare("SELECT * FROM catalog_jobs WHERE status = 'queued' ORDER BY created_at LIMIT 1")
      .first<CatalogJob>();
    if (!candidate) return json({ job: null });
    const claimed = await env.DB
      .prepare(
        `UPDATE catalog_jobs
         SET status = 'running', progress = 1,
             message = 'Scraper sunucusu işe başladı.', started_at = ?, updated_at = ?
         WHERE id = ? AND status = 'queued'`,
      )
      .bind(now, now, candidate.id)
      .run();
    if (!claimed.meta.changes) return json({ job: null });
    return json({
      job: {
        id: candidate.id,
        site: candidate.site,
        ownerEmail: candidate.owner_email,
      },
    });
  }

  if (action === "progress") {
    if (!(await requireWorker(request, env))) return json({ error: "Yetkisiz worker." }, 401);
    const id = String(payload.id ?? "");
    const status = payload.status === "failed" ? "failed" : "running";
    const progress = Math.max(1, Math.min(99, Math.round(Number(payload.progress) || 1)));
    const message = String(payload.message ?? "Ürünler çekiliyor.").slice(0, 300);
    const error = status === "failed" ? String(payload.error ?? "Bilinmeyen hata").slice(0, 1000) : null;
    const now = Date.now();
    const result = await env.DB
      .prepare(
        `UPDATE catalog_jobs
         SET status = ?, progress = ?, message = ?, error = ?,
             finished_at = CASE WHEN ? = 'failed' THEN ? ELSE finished_at END,
             updated_at = ?
         WHERE id = ? AND status = 'running'`,
      )
      .bind(status, progress, message, error, status, now, now, id)
      .run();
    return json({ ok: result.meta.changes === 1 });
  }

  const owner = ownerEmail(request);
  if (!owner) return json({ error: "Oturum gerekli." }, 401);
  const site = payload.site;
  if (!isCatalogSite(site)) return json({ error: "Geçersiz mağaza." }, 400);
  const active = await env.DB
    .prepare(
      `SELECT * FROM catalog_jobs
       WHERE owner_email = ? AND site = ? AND status IN ('queued', 'running')
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(owner, site)
    .first<CatalogJob>();
  if (active) return json({ job: publicCatalogJob(active), existing: true });
  const now = Date.now();
  const id = crypto.randomUUID().replace(/-/g, "");
  await env.DB
    .prepare(
      `INSERT INTO catalog_jobs
       (id, owner_email, site, status, progress, message, created_at, updated_at)
       VALUES (?, ?, ?, 'queued', 0, 'Tarama sırasına eklendi.', ?, ?)`,
    )
    .bind(id, owner, site, now, now)
    .run();
  const job = await env.DB
    .prepare("SELECT * FROM catalog_jobs WHERE id = ?")
    .bind(id)
    .first<CatalogJob>();
  return json({ job: job ? publicCatalogJob(job) : null }, 202);
}

export async function PUT(request: Request) {
  const env = await runtimeEnv();
  if (!env.DB || !env.FILES) return json({ error: "Katalog depoları bağlı değil." }, 503);
  if (!(await requireWorker(request, env))) return json({ error: "Yetkisiz worker." }, 401);
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_UPLOAD_BYTES) return json({ error: "Excel dosyası çok büyük." }, 413);
  if (!request.body) return json({ error: "Dosya gövdesi boş." }, 400);
  await ensureCatalogSchema(env.DB);
  const id = String(request.headers.get("X-Catalog-Job") ?? "");
  const requestedName = String(request.headers.get("X-Catalog-Filename") ?? "catalog.xlsx");
  const filename = requestedName.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 160);
  if (!/^[a-f0-9]{32}$/.test(id) || !filename.endsWith(".xlsx")) {
    return json({ error: "Geçersiz dosya bilgisi." }, 400);
  }
  const job = await env.DB
    .prepare("SELECT * FROM catalog_jobs WHERE id = ? AND status = 'running'")
    .bind(id)
    .first<CatalogJob>();
  if (!job) return json({ error: "Çalışan iş bulunamadı." }, 404);
  const objectKey = `catalog-jobs/${id}/${filename}`;
  await env.FILES.put(objectKey, request.body, {
    httpMetadata: {
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      contentDisposition: `attachment; filename="${filename}"`,
    },
    customMetadata: { site: job.site, owner: job.owner_email },
  });
  const now = Date.now();
  await env.DB
    .prepare(
      `UPDATE catalog_jobs
       SET status = 'completed', progress = 100,
           message = 'Excel dosyası indirilmeye hazır.', error = NULL,
           object_key = ?, filename = ?, finished_at = ?, updated_at = ?
       WHERE id = ? AND status = 'running'`,
    )
    .bind(objectKey, filename, now, now, id)
    .run();
  return json({ ok: true });
}
