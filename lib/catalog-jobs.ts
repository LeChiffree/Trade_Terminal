export const CATALOG_SITES = ["gratis", "watsons", "eveshop", "rossmann"] as const;
export type CatalogSite = (typeof CATALOG_SITES)[number];
export type CatalogJobStatus = "queued" | "running" | "completed" | "failed";

export type CatalogJob = {
  id: string;
  owner_email: string;
  site: CatalogSite;
  status: CatalogJobStatus;
  progress: number;
  message: string;
  error: string | null;
  object_key: string | null;
  filename: string | null;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  updated_at: number;
};

export type CatalogEnv = {
  DB?: D1Database;
  FILES?: R2Bucket;
  SCANNER_TRIGGER_KEY?: string;
};

export function isCatalogSite(value: unknown): value is CatalogSite {
  return CATALOG_SITES.includes(String(value) as CatalogSite);
}

export async function ensureCatalogSchema(db: D1Database) {
  await db.batch([
    db.prepare(
      `CREATE TABLE IF NOT EXISTS catalog_jobs (
        id TEXT PRIMARY KEY NOT NULL,
        owner_email TEXT NOT NULL,
        site TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        progress INTEGER NOT NULL DEFAULT 0,
        message TEXT NOT NULL DEFAULT 'Tarama sırasına eklendi.',
        error TEXT,
        object_key TEXT,
        filename TEXT,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        finished_at INTEGER,
        updated_at INTEGER NOT NULL
      )`,
    ),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_catalog_jobs_owner_created
       ON catalog_jobs(owner_email, created_at)`,
    ),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_catalog_jobs_status_created
       ON catalog_jobs(status, created_at)`,
    ),
  ]);
}

export function publicCatalogJob(job: CatalogJob) {
  return {
    id: job.id,
    site: job.site,
    status: job.status,
    progress: job.progress,
    message: job.message,
    error: job.error,
    filename: job.filename,
    createdAt: job.created_at,
    startedAt: job.started_at,
    finishedAt: job.finished_at,
    downloadUrl:
      job.status === "completed" && job.object_key
        ? `/api/catalog-jobs?download=${encodeURIComponent(job.id)}`
        : null,
  };
}

export async function secureMatch(received: string, expected: string) {
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
