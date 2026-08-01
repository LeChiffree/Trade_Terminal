import {
  ensureScannerSchema,
  type ScannerEnv,
} from "@/lib/background-scanner";

export const dynamic = "force-dynamic";

type SyncInterval = {
  interval?: unknown;
  cadence_seconds?: unknown;
  last_started_at?: unknown;
  last_completed_at?: unknown;
  last_duration_ms?: unknown;
  last_scanned_count?: unknown;
  last_error?: unknown;
};

type SyncLeader = {
  symbol?: unknown;
  base_asset?: unknown;
  interval?: unknown;
  final_score?: unknown;
  quant_score?: unknown;
  context_score?: unknown;
  confidence?: unknown;
  direction?: unknown;
  price?: unknown;
  last_scanned_at?: unknown;
};

type SyncPayload = {
  config?: {
    last_heartbeat?: unknown;
    last_error?: unknown;
    scans_completed?: unknown;
    alerts_sent?: unknown;
  };
  intervals?: SyncInterval[];
  leaders?: SyncLeader[];
};

const VALID_INTERVALS = new Set(["5m", "15m", "1h", "4h", "1d", "1w"]);
const VALID_DIRECTIONS = new Set(["long", "short", "neutral", "unavailable"]);

function finiteInteger(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : fallback;
}

function boundedNumber(value: unknown, minimum: number, maximum: number) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.min(maximum, Math.max(minimum, number))
    : 0;
}

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
      { error: "Yetkisiz tarayıcı senkronizasyon isteği." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const cloudflare = await import("cloudflare:workers");
  const env = cloudflare.env as unknown as ScannerEnv;
  const expected = String(env.SCANNER_TRIGGER_KEY ?? "");
  if (!expected) {
    return Response.json(
      { error: "Tarayıcı senkronizasyon anahtarı yapılandırılmadı." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!(await secureMatch(received, expected))) {
    return Response.json(
      { error: "Yetkisiz tarayıcı senkronizasyon isteği." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!env.DB) {
    return Response.json(
      { error: "Tarayıcı veritabanı yapılandırılmadı." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  let payload: SyncPayload;
  try {
    payload = await request.json() as SyncPayload;
  } catch {
    return Response.json(
      { error: "Geçersiz senkronizasyon gövdesi." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  await ensureScannerSchema(env.DB);
  const now = Date.now();
  const heartbeat = finiteInteger(payload.config?.last_heartbeat);
  const scans = finiteInteger(payload.config?.scans_completed);
  const alerts = finiteInteger(payload.config?.alerts_sent);
  const lastError = payload.config?.last_error
    ? String(payload.config.last_error).slice(0, 500)
    : null;
  const statements: D1PreparedStatement[] = [
    env.DB
      .prepare(
        `UPDATE scanner_config
         SET last_heartbeat = MAX(last_heartbeat, ?),
             scans_completed = MAX(scans_completed, ?),
             alerts_sent = MAX(alerts_sent, ?),
             last_error = ?,
             updated_at = ?
         WHERE id = 1`,
      )
      .bind(heartbeat, scans, alerts, lastError, now),
    env.DB.prepare(`DELETE FROM scanner_scores`),
  ];
  let syncedLeaderCount = 0;

  for (const item of (payload.intervals ?? []).slice(0, 6)) {
    const interval = String(item.interval ?? "");
    if (!VALID_INTERVALS.has(interval)) continue;
    statements.push(
      env.DB
        .prepare(
          `UPDATE scanner_intervals
           SET last_started_at = MAX(last_started_at, ?),
               last_completed_at = MAX(last_completed_at, ?),
               last_duration_ms = ?,
               last_scanned_count = ?,
               last_error = ?
           WHERE interval = ?`,
        )
        .bind(
          finiteInteger(item.last_started_at),
          finiteInteger(item.last_completed_at),
          finiteInteger(item.last_duration_ms),
          Math.min(50, finiteInteger(item.last_scanned_count)),
          item.last_error ? String(item.last_error).slice(0, 300) : null,
          interval,
        ),
    );
  }

  for (const item of (payload.leaders ?? []).slice(0, 20)) {
    const symbol = String(item.symbol ?? "").toUpperCase();
    const baseAsset = String(item.base_asset ?? "").toUpperCase();
    const interval = String(item.interval ?? "");
    const direction = String(item.direction ?? "");
    if (
      !/^[A-Z0-9]{2,16}USDT$/.test(symbol) ||
      !/^[A-Z0-9]{2,16}$/.test(baseAsset) ||
      !VALID_INTERVALS.has(interval) ||
      !VALID_DIRECTIONS.has(direction)
    ) continue;
    statements.push(
      env.DB
        .prepare(
          `INSERT INTO scanner_scores
           (symbol, interval, base_asset, last_scanned_at, final_score,
            quant_score, context_score, confidence, direction, price, source,
            armed, error, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'binance', 1, NULL, ?)
           ON CONFLICT(symbol, interval) DO UPDATE SET
             base_asset = excluded.base_asset,
             last_scanned_at = excluded.last_scanned_at,
             final_score = excluded.final_score,
             quant_score = excluded.quant_score,
             context_score = excluded.context_score,
             confidence = excluded.confidence,
             direction = excluded.direction,
             price = excluded.price,
             source = 'binance',
             error = NULL,
             updated_at = excluded.updated_at`,
        )
        .bind(
          symbol,
          interval,
          baseAsset,
          finiteInteger(item.last_scanned_at),
          Math.round(boundedNumber(item.final_score, -100, 100)),
          Math.round(boundedNumber(item.quant_score, -100, 100)),
          item.context_score === null || item.context_score === undefined
            ? null
            : Math.round(boundedNumber(item.context_score, -100, 100)),
          Math.round(boundedNumber(item.confidence, 0, 100)),
          direction,
          boundedNumber(item.price, 0, Number.MAX_SAFE_INTEGER),
          now,
        ),
    );
    syncedLeaderCount += 1;
  }

  await env.DB.batch(statements);
  return Response.json(
    { ok: true, heartbeat, scans, leaders: syncedLeaderCount },
    { headers: { "Cache-Control": "no-store" } },
  );
}
