import {
  ensureScannerSchema,
  type ScannerEnv,
} from "@/lib/background-scanner";
import {
  runBistPaperTradingCycleIfDue,
} from "@/lib/bist-paper-trading";
import {
  BINANCE_FUTURES_DEMO_BASE_URL,
  getBinanceDemoFuturesMirrorStatus,
} from "@/lib/binance-demo-futures";
import { PAPER_DEFAULTS } from "@/lib/paper-trading";

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

type SyncPaperPosition = {
  id?: unknown;
  symbol?: unknown;
  base_asset?: unknown;
  interval?: unknown;
  direction?: unknown;
  status?: unknown;
  entry_score?: unknown;
  current_score?: unknown;
  confidence?: unknown;
  entry_price?: unknown;
  mark_price?: unknown;
  quantity?: unknown;
  margin?: unknown;
  leverage?: unknown;
  notional?: unknown;
  funding_rate?: unknown;
  next_funding_at?: unknown;
  funding_pnl?: unknown;
  entry_fee?: unknown;
  exit_fee?: unknown;
  entry_slippage?: unknown;
  exit_slippage?: unknown;
  gross_pnl?: unknown;
  net_pnl?: unknown;
  liquidation_price?: unknown;
  opened_at?: unknown;
  closed_at?: unknown;
  close_reason?: unknown;
  updated_at?: unknown;
};

type SyncDemoFuturesState = {
  enabled?: unknown;
  base_url?: unknown;
  margin_usdt?: unknown;
  last_cycle_at?: unknown;
  last_error?: unknown;
  opens_succeeded?: unknown;
  closes_succeeded?: unknown;
  updated_at?: unknown;
};

type SyncDemoFuturesMirror = {
  paper_position_id?: unknown;
  symbol?: unknown;
  direction?: unknown;
  quantity?: unknown;
  leverage?: unknown;
  margin_usdt?: unknown;
  open_order_id?: unknown;
  close_order_id?: unknown;
  status?: unknown;
  last_error?: unknown;
  opened_at?: unknown;
  closed_at?: unknown;
  updated_at?: unknown;
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
  paper?: {
    account?: Record<string, unknown> | null;
    openPositions?: SyncPaperPosition[];
    history?: SyncPaperPosition[];
  };
  demoFutures?: {
    state?: SyncDemoFuturesState | null;
    mirrors?: SyncDemoFuturesMirror[];
  };
};

const VALID_INTERVALS = new Set(["5m", "15m", "1h", "4h", "1d", "1w"]);
const VALID_DIRECTIONS = new Set(["long", "short", "neutral", "unavailable"]);
const VALID_PAPER_STATUSES = new Set(["open", "closed"]);
const VALID_DEMO_MIRROR_STATUSES = new Set([
  "pending-open",
  "open",
  "pending-close",
  "closed",
]);
const VALID_CLOSE_REASONS = new Set([
  "score-normalized",
  "direction-reversal",
  "liquidation",
]);

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
  // This creates the display-only Demo Futures tables on Sites. Only the EC2
  // scanner owns credentials and submits orders; Sites receives sanitized state.
  await getBinanceDemoFuturesMirrorStatus(env.DB);
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
  let syncedPositionCount = 0;

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

  const paperAccount = payload.paper?.account;
  if (paperAccount && typeof paperAccount === "object") {
    statements.push(
      env.DB
        .prepare(
          `UPDATE paper_account
           SET initial_balance = ?, cash_balance = ?, margin_per_trade = ?,
               leverage = ?, max_positions = ?, entry_score = ?,
               exit_score = ?, minimum_confidence = ?, taker_fee_rate = ?,
               slippage_rate = ?, maintenance_margin_rate = ?,
               realized_net_pnl = ?, total_fees = ?, total_slippage = ?,
               total_funding = ?, trades_closed = ?, wins = ?, losses = ?,
               last_cycle_at = ?, updated_at = ?
           WHERE id = 1`,
        )
        .bind(
          boundedNumber(paperAccount.initial_balance, 0, 10_000_000),
          boundedNumber(paperAccount.cash_balance, 0, 10_000_000),
          boundedNumber(paperAccount.margin_per_trade, 1, 1_000_000),
          Math.round(boundedNumber(paperAccount.leverage, 1, 125)),
          Math.max(
            PAPER_DEFAULTS.maxPositions,
            Math.round(boundedNumber(paperAccount.max_positions, 1, 20)),
          ),
          Math.round(boundedNumber(paperAccount.entry_score, 1, 100)),
          Math.round(boundedNumber(paperAccount.exit_score, 0, 100)),
          Math.round(boundedNumber(paperAccount.minimum_confidence, 0, 100)),
          boundedNumber(paperAccount.taker_fee_rate, 0, 0.02),
          boundedNumber(paperAccount.slippage_rate, 0, 0.02),
          boundedNumber(paperAccount.maintenance_margin_rate, 0, 0.2),
          boundedNumber(paperAccount.realized_net_pnl, -10_000_000, 10_000_000),
          boundedNumber(paperAccount.total_fees, 0, 10_000_000),
          boundedNumber(paperAccount.total_slippage, 0, 10_000_000),
          boundedNumber(paperAccount.total_funding, -10_000_000, 10_000_000),
          finiteInteger(paperAccount.trades_closed),
          finiteInteger(paperAccount.wins),
          finiteInteger(paperAccount.losses),
          finiteInteger(paperAccount.last_cycle_at),
          now,
        ),
      env.DB.prepare(`DELETE FROM paper_positions`),
    );

    const paperPositions = [
      ...(payload.paper?.openPositions ?? []).slice(
        0,
        PAPER_DEFAULTS.maxPositions,
      ),
      ...(payload.paper?.history ?? []).slice(0, 30),
    ];
    const seenIds = new Set<number>();
    for (const item of paperPositions) {
      const id = finiteInteger(item.id);
      const symbol = String(item.symbol ?? "").toUpperCase();
      const baseAsset = String(item.base_asset ?? "").toUpperCase();
      const interval = String(item.interval ?? "");
      const direction = String(item.direction ?? "");
      const status = String(item.status ?? "");
      const closeReason = item.close_reason
        ? String(item.close_reason)
        : null;
      if (
        !id ||
        seenIds.has(id) ||
        !/^[A-Z0-9]{2,16}USDT$/.test(symbol) ||
        !/^[A-Z0-9]{2,16}$/.test(baseAsset) ||
        !VALID_INTERVALS.has(interval) ||
        !["long", "short"].includes(direction) ||
        !VALID_PAPER_STATUSES.has(status) ||
        (closeReason !== null && !VALID_CLOSE_REASONS.has(closeReason))
      ) continue;
      seenIds.add(id);
      statements.push(
        env.DB
          .prepare(
            `INSERT INTO paper_positions
             (id, symbol, base_asset, interval, direction, status, entry_score,
              current_score, confidence, entry_price, mark_price, quantity,
              margin, leverage, notional, funding_rate, next_funding_at,
              funding_pnl, entry_fee, exit_fee, entry_slippage, exit_slippage,
              gross_pnl, net_pnl, liquidation_price, opened_at, closed_at,
              close_reason, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                     ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            id,
            symbol,
            baseAsset,
            interval,
            direction,
            status,
            Math.round(boundedNumber(item.entry_score, -100, 100)),
            Math.round(boundedNumber(item.current_score, -100, 100)),
            Math.round(boundedNumber(item.confidence, 0, 100)),
            boundedNumber(item.entry_price, 0, Number.MAX_SAFE_INTEGER),
            boundedNumber(item.mark_price, 0, Number.MAX_SAFE_INTEGER),
            boundedNumber(item.quantity, 0, Number.MAX_SAFE_INTEGER),
            boundedNumber(item.margin, 0, 1_000_000),
            Math.round(boundedNumber(item.leverage, 1, 125)),
            boundedNumber(item.notional, 0, 10_000_000),
            boundedNumber(item.funding_rate, -1, 1),
            finiteInteger(item.next_funding_at),
            boundedNumber(item.funding_pnl, -10_000_000, 10_000_000),
            boundedNumber(item.entry_fee, 0, 1_000_000),
            boundedNumber(item.exit_fee, 0, 1_000_000),
            boundedNumber(item.entry_slippage, 0, 1_000_000),
            boundedNumber(item.exit_slippage, 0, 1_000_000),
            boundedNumber(item.gross_pnl, -10_000_000, 10_000_000),
            boundedNumber(item.net_pnl, -10_000_000, 10_000_000),
            boundedNumber(item.liquidation_price, 0, Number.MAX_SAFE_INTEGER),
            finiteInteger(item.opened_at),
            item.closed_at === null || item.closed_at === undefined
              ? null
              : finiteInteger(item.closed_at),
            closeReason,
            finiteInteger(item.updated_at, now),
          ),
      );
      syncedPositionCount += 1;
    }
  }

  const demoState = payload.demoFutures?.state;
  const demoBaseUrl = String(demoState?.base_url ?? "");
  if (
    demoState &&
    typeof demoState === "object" &&
    demoBaseUrl === BINANCE_FUTURES_DEMO_BASE_URL
  ) {
    statements.push(
      env.DB
        .prepare(
          `UPDATE binance_demo_futures_state
           SET enabled = ?, base_url = ?, margin_usdt = ?, last_cycle_at = ?,
               last_error = ?, opens_succeeded = ?, closes_succeeded = ?,
               updated_at = ?
           WHERE id = 1`,
        )
        .bind(
          Number(demoState.enabled) === 1 ? 1 : 0,
          BINANCE_FUTURES_DEMO_BASE_URL,
          boundedNumber(demoState.margin_usdt, 5, 10_000),
          finiteInteger(demoState.last_cycle_at),
          demoState.last_error
            ? String(demoState.last_error).slice(0, 1_000)
            : null,
          finiteInteger(demoState.opens_succeeded),
          finiteInteger(demoState.closes_succeeded),
          finiteInteger(demoState.updated_at, now),
        ),
      env.DB.prepare(`DELETE FROM binance_demo_futures_mirrors`),
    );

    const seenDemoPositionIds = new Set<number>();
    for (const item of (payload.demoFutures?.mirrors ?? []).slice(0, 50)) {
      const paperPositionId = finiteInteger(item.paper_position_id);
      const symbol = String(item.symbol ?? "").toUpperCase();
      const direction = String(item.direction ?? "");
      const status = String(item.status ?? "");
      if (
        !paperPositionId ||
        seenDemoPositionIds.has(paperPositionId) ||
        !/^[A-Z0-9]{2,16}USDT$/.test(symbol) ||
        !["long", "short"].includes(direction) ||
        !VALID_DEMO_MIRROR_STATUSES.has(status)
      ) continue;
      seenDemoPositionIds.add(paperPositionId);
      const openOrderId = item.open_order_id === null || item.open_order_id === undefined
        ? null
        : finiteInteger(item.open_order_id);
      const closeOrderId = item.close_order_id === null || item.close_order_id === undefined
        ? null
        : finiteInteger(item.close_order_id);
      statements.push(
        env.DB
          .prepare(
            `INSERT INTO binance_demo_futures_mirrors
             (paper_position_id, symbol, direction, quantity, leverage,
              margin_usdt, open_client_order_id, close_client_order_id,
              open_order_id, close_order_id, status, last_error, opened_at,
              closed_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            paperPositionId,
            symbol,
            direction,
            boundedNumber(item.quantity, 0, Number.MAX_SAFE_INTEGER),
            Math.round(boundedNumber(item.leverage, 1, 125)),
            boundedNumber(item.margin_usdt, 5, 10_000),
            `qs-sync-open-${paperPositionId}`,
            `qs-sync-close-${paperPositionId}`,
            openOrderId,
            closeOrderId,
            status,
            item.last_error ? String(item.last_error).slice(0, 500) : null,
            item.opened_at === null || item.opened_at === undefined
              ? null
              : finiteInteger(item.opened_at),
            item.closed_at === null || item.closed_at === undefined
              ? null
              : finiteInteger(item.closed_at),
            finiteInteger(item.updated_at, now),
          ),
      );
    }
  }

  await env.DB.batch(statements);
  let bistPaper: Awaited<
    ReturnType<typeof runBistPaperTradingCycleIfDue>
  > | null = null;
  try {
    bistPaper = await runBistPaperTradingCycleIfDue(env.DB, Date.now());
  } catch {
    // The crypto snapshot must remain successful when the BIST provider is down.
  }
  return Response.json(
    {
      ok: true,
      heartbeat,
      scans,
      leaders: syncedLeaderCount,
      paperPositions: syncedPositionCount,
      bistPaper,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
