export const BINANCE_FUTURES_DEMO_BASE_URL =
  "https://demo-fapi.binance.com";
export const BINANCE_DEMO_REQUEST_TIMEOUT_MS = 8_000;

export type BinanceDemoFuturesEnv = {
  BINANCE_API_KEY?: string;
  BINANCE_API_SECRET?: string;
  BINANCE_FUTURES_BASE_URL?: string;
  BINANCE_FUTURES_TRADING_ENABLED?: string;
  BINANCE_FUTURES_DEMO_ONLY?: string;
  BINANCE_FUTURES_MARGIN_USDT?: string;
};

type PaperPosition = {
  id: number;
  symbol: string;
  direction: "long" | "short";
  leverage: number;
  mark_price: number;
};

type MirrorRow = {
  paper_position_id: number;
  symbol: string;
  direction: "long" | "short";
  quantity: number;
  leverage: number;
  margin_usdt: number;
  open_client_order_id: string;
  close_client_order_id: string;
  open_order_id: number | null;
  close_order_id: number | null;
  status: "pending-open" | "open" | "pending-close" | "closed";
  last_error: string | null;
  opened_at: number | null;
  closed_at: number | null;
  updated_at: number;
};

type BinanceOrder = {
  orderId?: number;
  status?: string;
  origQty?: string;
  executedQty?: string;
  clientOrderId?: string;
};

type PositionRisk = {
  symbol?: string;
  positionAmt?: string;
  positionSide?: "BOTH" | "LONG" | "SHORT";
};

type ExchangeFilter = {
  filterType?: string;
  minQty?: string;
  maxQty?: string;
  stepSize?: string;
  notional?: string;
};

type ExchangeSymbol = {
  symbol?: string;
  status?: string;
  filters?: ExchangeFilter[];
};

type DemoConfig = {
  apiKey: string;
  apiSecret: string;
  baseUrl: string;
  marginUsdt: number;
};

const CREATE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS binance_demo_futures_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    enabled INTEGER NOT NULL DEFAULT 0,
    base_url TEXT NOT NULL DEFAULT '',
    margin_usdt REAL NOT NULL DEFAULT 25,
    last_cycle_at INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    opens_succeeded INTEGER NOT NULL DEFAULT 0,
    closes_succeeded INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS binance_demo_futures_mirrors (
    paper_position_id INTEGER PRIMARY KEY,
    symbol TEXT NOT NULL,
    direction TEXT NOT NULL,
    quantity REAL NOT NULL DEFAULT 0,
    leverage INTEGER NOT NULL,
    margin_usdt REAL NOT NULL,
    open_client_order_id TEXT NOT NULL UNIQUE,
    close_client_order_id TEXT NOT NULL UNIQUE,
    open_order_id INTEGER,
    close_order_id INTEGER,
    status TEXT NOT NULL DEFAULT 'pending-open',
    last_error TEXT,
    opened_at INTEGER,
    closed_at INTEGER,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_binance_demo_mirrors_status
   ON binance_demo_futures_mirrors (status, updated_at)`,
];

const INSERT_STATE = `INSERT OR IGNORE INTO binance_demo_futures_state
  (id, enabled, base_url, margin_usdt, last_cycle_at, last_error,
   opens_succeeded, closes_succeeded, updated_at)
  VALUES (1, 0, '', 25, 0, NULL, 0, 0, 0)`;

function truthy(value: string | undefined) {
  return ["1", "true", "yes", "on"].includes(
    String(value ?? "").trim().toLowerCase(),
  );
}

export function assertBinanceDemoBaseUrl(value?: string) {
  const candidate = new URL(value || BINANCE_FUTURES_DEMO_BASE_URL);
  if (
    candidate.origin !== BINANCE_FUTURES_DEMO_BASE_URL ||
    !["", "/"].includes(candidate.pathname) ||
    candidate.username ||
    candidate.password ||
    candidate.search ||
    candidate.hash
  ) {
    throw new Error(
      "Binance Futures emirleri yalnızca demo-fapi.binance.com adresine gönderilebilir.",
    );
  }
  return candidate.origin;
}

export function parseDemoMarginUsdt(value?: string) {
  const parsed = Number(value ?? 25);
  if (!Number.isFinite(parsed) || parsed < 5 || parsed > 10_000) {
    throw new Error("BINANCE_FUTURES_MARGIN_USDT 5 ile 10000 arasında olmalıdır.");
  }
  return parsed;
}

function loadConfig(env: BinanceDemoFuturesEnv): DemoConfig | null {
  if (!truthy(env.BINANCE_FUTURES_TRADING_ENABLED)) return null;
  if (!truthy(env.BINANCE_FUTURES_DEMO_ONLY)) {
    throw new Error("BINANCE_FUTURES_DEMO_ONLY=true olmadan emir gönderilemez.");
  }
  const apiKey = String(env.BINANCE_API_KEY ?? "").trim();
  const apiSecret = String(env.BINANCE_API_SECRET ?? "").trim();
  if (!apiKey || !apiSecret) {
    throw new Error("Binance Demo API anahtarı veya gizli anahtarı eksik.");
  }
  return {
    apiKey,
    apiSecret,
    baseUrl: assertBinanceDemoBaseUrl(env.BINANCE_FUTURES_BASE_URL),
    marginUsdt: parseDemoMarginUsdt(env.BINANCE_FUTURES_MARGIN_USDT),
  };
}

function decimalPlaces(value: string) {
  const normalized = value.toLowerCase();
  if (normalized.includes("e-")) {
    return Number(normalized.split("e-")[1] ?? 0);
  }
  return (normalized.split(".")[1] ?? "").replace(/0+$/, "").length;
}

export function floorToStep(value: number, stepSize: string) {
  const step = Number(stepSize);
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(step) || step <= 0) {
    return "0";
  }
  const precision = Math.min(12, decimalPlaces(stepSize));
  const units = Math.floor((value + step * 1e-9) / step);
  const rounded = units * step;
  const formatted = rounded.toFixed(precision);
  return precision > 0 ? formatted.replace(/\.?0+$/, "") : formatted;
}

export function marketQuantity(
  notionalUsdt: number,
  markPrice: number,
  symbol: ExchangeSymbol,
) {
  const filters = symbol.filters ?? [];
  const lot =
    filters.find((filter) => filter.filterType === "MARKET_LOT_SIZE") ??
    filters.find((filter) => filter.filterType === "LOT_SIZE");
  if (!lot?.stepSize) throw new Error(`${symbol.symbol ?? "Parite"} lot filtresi yok.`);
  const quantity = floorToStep(notionalUsdt / markPrice, lot.stepSize);
  const numeric = Number(quantity);
  const minQty = Number(lot.minQty ?? 0);
  const maxQty = Number(lot.maxQty ?? Number.POSITIVE_INFINITY);
  const minNotional = Number(
    filters.find((filter) => filter.filterType === "MIN_NOTIONAL")?.notional ?? 0,
  );
  if (!numeric || numeric < minQty || numeric > maxQty) {
    throw new Error(`${symbol.symbol ?? "Parite"} için hesaplanan miktar lot sınırında değil.`);
  }
  if (numeric * markPrice < minNotional) {
    throw new Error(`${symbol.symbol ?? "Parite"} emri minimum notional değerinin altında.`);
  }
  return quantity;
}

async function hmacSha256Hex(secret: string, payload: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

class BinanceApiError extends Error {
  code: number | null;

  constructor(message: string, code: number | null = null) {
    super(message);
    this.name = "BinanceApiError";
    this.code = code;
  }
}

class BinanceDemoClient {
  private readonly config: DemoConfig;
  private clockOffset = 0;

  constructor(config: DemoConfig) {
    this.config = config;
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    params: Record<string, string | number | boolean> = {},
    signed = false,
  ): Promise<T> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      query.set(key, String(value));
    }
    if (signed) {
      query.set("recvWindow", "5000");
      query.set("timestamp", String(Date.now() + this.clockOffset));
      query.set(
        "signature",
        await hmacSha256Hex(this.config.apiSecret, query.toString()),
      );
    }
    const url = `${this.config.baseUrl}${path}${query.size ? `?${query}` : ""}`;
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      BINANCE_DEMO_REQUEST_TIMEOUT_MS,
    );
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: { "X-MBX-APIKEY": this.config.apiKey },
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new BinanceApiError(
          "Binance Demo request timed out after 8 seconds.",
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
    const payload = await response.json().catch(() => null) as
      | (T & { code?: number; msg?: string })
      | null;
    if (!response.ok || (payload && typeof payload.code === "number" && payload.code < 0)) {
      throw new BinanceApiError(
        payload?.msg || `Binance Demo HTTP ${response.status}`,
        payload?.code ?? null,
      );
    }
    if (payload === null) throw new BinanceApiError("Binance Demo boş yanıt verdi.");
    return payload;
  }

  async synchronizeClock() {
    const before = Date.now();
    const response = await this.request<{ serverTime: number }>(
      "GET",
      "/fapi/v1/time",
    );
    this.clockOffset = response.serverTime - Math.floor((before + Date.now()) / 2);
  }

  exchangeInfo() {
    return this.request<{ symbols?: ExchangeSymbol[] }>(
      "GET",
      "/fapi/v1/exchangeInfo",
    );
  }

  async hedgeMode() {
    const response = await this.request<{ dualSidePosition?: boolean }>(
      "GET",
      "/fapi/v1/positionSide/dual",
      {},
      true,
    );
    return Boolean(response.dualSidePosition);
  }

  positions(symbol: string) {
    return this.request<PositionRisk[]>(
      "GET",
      "/fapi/v3/positionRisk",
      { symbol },
      true,
    );
  }

  async markPrice(symbol: string) {
    const response = await this.request<{ markPrice?: string }>(
      "GET",
      "/fapi/v1/premiumIndex",
      { symbol },
    );
    const price = Number(response.markPrice);
    if (!Number.isFinite(price) || price <= 0) {
      throw new BinanceApiError(`${symbol} mark fiyatı alınamadı.`);
    }
    return price;
  }

  leverage(symbol: string, leverage: number) {
    return this.request(
      "POST",
      "/fapi/v1/leverage",
      { symbol, leverage },
      true,
    );
  }

  async isolated(symbol: string) {
    try {
      await this.request(
        "POST",
        "/fapi/v1/marginType",
        { symbol, marginType: "ISOLATED" },
        true,
      );
    } catch (error) {
      if (error instanceof BinanceApiError && error.code === -4046) return;
      throw error;
    }
  }

  async order(symbol: string, clientOrderId: string) {
    try {
      return await this.request<BinanceOrder>(
        "GET",
        "/fapi/v1/order",
        { symbol, origClientOrderId: clientOrderId },
        true,
      );
    } catch (error) {
      if (error instanceof BinanceApiError && error.code === -2013) return null;
      throw error;
    }
  }

  newOrder(params: Record<string, string | number | boolean>) {
    return this.request<BinanceOrder>(
      "POST",
      "/fapi/v1/order",
      params,
      true,
    );
  }
}

function errorMessage(error: unknown) {
  return (error instanceof Error ? error.message : "Binance Demo işlemi başarısız.")
    .replace(/[\r\n]+/g, " ")
    .slice(0, 500);
}

function relevantPositionAmount(
  rows: PositionRisk[],
  direction: "long" | "short",
  hedgeMode: boolean,
) {
  if (hedgeMode) {
    const side = direction === "long" ? "LONG" : "SHORT";
    const row = rows.find((candidate) => candidate.positionSide === side);
    return Math.abs(Number(row?.positionAmt ?? 0));
  }
  const amount = Number(
    rows.find((candidate) => candidate.positionSide === "BOTH")?.positionAmt ??
      rows[0]?.positionAmt ??
      0,
  );
  if (direction === "long" && amount < 0) return -1;
  if (direction === "short" && amount > 0) return -1;
  return Math.abs(amount);
}

async function ensureSchema(db: D1Database) {
  await db.batch(CREATE_STATEMENTS.map((statement) => db.prepare(statement)));
  await db.prepare(INSERT_STATE).run();
}

async function updateMirrorError(
  db: D1Database,
  paperPositionId: number,
  message: string,
  now: number,
) {
  await db
    .prepare(
      `UPDATE binance_demo_futures_mirrors
       SET last_error = ?, updated_at = ?
       WHERE paper_position_id = ?`,
    )
    .bind(message, now, paperPositionId)
    .run();
}

async function markMirrorOpen(
  db: D1Database,
  mirror: MirrorRow,
  order: BinanceOrder,
  now: number,
) {
  const quantity = Number(order.executedQty ?? order.origQty ?? mirror.quantity);
  await db
    .prepare(
      `UPDATE binance_demo_futures_mirrors
       SET quantity = ?, open_order_id = ?, status = 'open', last_error = NULL,
           opened_at = COALESCE(opened_at, ?), updated_at = ?
       WHERE paper_position_id = ?`,
    )
    .bind(quantity, order.orderId ?? null, now, now, mirror.paper_position_id)
    .run();
}

async function markMirrorClosed(
  db: D1Database,
  mirror: MirrorRow,
  order: BinanceOrder | null,
  now: number,
) {
  await db
    .prepare(
      `UPDATE binance_demo_futures_mirrors
       SET close_order_id = ?, status = 'closed', last_error = NULL,
           closed_at = ?, updated_at = ?
       WHERE paper_position_id = ?`,
    )
    .bind(order?.orderId ?? null, now, now, mirror.paper_position_id)
    .run();
}

async function openMirror(
  db: D1Database,
  client: BinanceDemoClient,
  paper: PaperPosition,
  mirror: MirrorRow,
  symbol: ExchangeSymbol,
  hedgeMode: boolean,
  now: number,
) {
  const previous = await client.order(paper.symbol, mirror.open_client_order_id);
  if (previous && Number(previous.executedQty ?? previous.origQty ?? 0) > 0) {
    await markMirrorOpen(db, mirror, previous, now);
    return true;
  }

  const positions = await client.positions(paper.symbol);
  const existing = relevantPositionAmount(positions, paper.direction, hedgeMode);
  if (existing !== 0) {
    throw new Error(
      existing < 0
        ? `${paper.symbol} demo hesabında ters yönlü pozisyon var.`
        : `${paper.symbol} demo hesabında eşlenmemiş açık pozisyon var.`,
    );
  }

  await client.leverage(paper.symbol, paper.leverage);
  await client.isolated(paper.symbol);
  const price = await client.markPrice(paper.symbol);
  const quantity = marketQuantity(
    mirror.margin_usdt * paper.leverage,
    price,
    symbol,
  );
  const order = await client.newOrder({
    symbol: paper.symbol,
    side: paper.direction === "long" ? "BUY" : "SELL",
    ...(hedgeMode
      ? { positionSide: paper.direction === "long" ? "LONG" : "SHORT" }
      : {}),
    type: "MARKET",
    quantity,
    newClientOrderId: mirror.open_client_order_id,
    newOrderRespType: "RESULT",
  });
  await markMirrorOpen(
    db,
    { ...mirror, quantity: Number(quantity) },
    order,
    now,
  );
  return true;
}

async function closeMirror(
  db: D1Database,
  client: BinanceDemoClient,
  mirror: MirrorRow,
  symbol: ExchangeSymbol,
  hedgeMode: boolean,
  now: number,
) {
  const previous = await client.order(mirror.symbol, mirror.close_client_order_id);
  if (previous && Number(previous.executedQty ?? previous.origQty ?? 0) > 0) {
    await markMirrorClosed(db, mirror, previous, now);
    return true;
  }

  const positions = await client.positions(mirror.symbol);
  const actual = relevantPositionAmount(positions, mirror.direction, hedgeMode);
  if (actual < 0) {
    throw new Error(`${mirror.symbol} demo hesabındaki pozisyon yönü eşlemeyle çelişiyor.`);
  }
  if (actual === 0) {
    await markMirrorClosed(db, mirror, null, now);
    return true;
  }
  const lot =
    (symbol.filters ?? []).find((filter) => filter.filterType === "MARKET_LOT_SIZE") ??
    (symbol.filters ?? []).find((filter) => filter.filterType === "LOT_SIZE");
  if (!lot?.stepSize) throw new Error(`${mirror.symbol} lot filtresi yok.`);
  const quantity = floorToStep(Math.min(actual, mirror.quantity), lot.stepSize);
  if (!Number(quantity)) throw new Error(`${mirror.symbol} kapatma miktarı sıfırlandı.`);
  const order = await client.newOrder({
    symbol: mirror.symbol,
    side: mirror.direction === "long" ? "SELL" : "BUY",
    ...(hedgeMode
      ? { positionSide: mirror.direction === "long" ? "LONG" : "SHORT" }
      : { reduceOnly: true }),
    type: "MARKET",
    quantity,
    newClientOrderId: mirror.close_client_order_id,
    newOrderRespType: "RESULT",
  });
  await markMirrorClosed(db, mirror, order, now);
  return true;
}

export async function runBinanceDemoFuturesMirrorCycle(
  db: D1Database,
  env: BinanceDemoFuturesEnv,
  now = Date.now(),
) {
  await ensureSchema(db);
  let config: DemoConfig | null = null;
  try {
    config = loadConfig(env);
  } catch (error) {
    const message = errorMessage(error);
    await db
      .prepare(
        `UPDATE binance_demo_futures_state
         SET enabled = 0, last_cycle_at = ?, last_error = ?, updated_at = ?
         WHERE id = 1`,
      )
      .bind(now, message, now)
      .run();
    throw error;
  }
  if (!config) {
    await db
      .prepare(
        `UPDATE binance_demo_futures_state
         SET enabled = 0, last_cycle_at = ?, last_error = NULL, updated_at = ?
         WHERE id = 1`,
      )
      .bind(now, now)
      .run();
    return { skipped: true, reason: "disabled", opened: 0, closed: 0, errors: [] };
  }

  const [paperResult, mirrorResult] = await Promise.all([
    db
      .prepare(
        `SELECT id, symbol, direction, leverage, mark_price
         FROM paper_positions
         WHERE status = 'open'
         ORDER BY opened_at ASC`,
      )
      .all<PaperPosition>(),
    db
      .prepare(
        `SELECT * FROM binance_demo_futures_mirrors
         WHERE status != 'closed'
         ORDER BY updated_at ASC`,
      )
      .all<MirrorRow>(),
  ]);
  const papers = paperResult.results.filter(
    (paper) => paper.direction === "long" || paper.direction === "short",
  );
  const desiredIds = new Set(papers.map((paper) => paper.id));
  const mirrorById = new Map(
    mirrorResult.results.map((mirror) => [mirror.paper_position_id, mirror]),
  );

  for (const paper of papers) {
    if (mirrorById.has(paper.id)) continue;
    const openClientId = `qs-po-${paper.id}`;
    const closeClientId = `qs-pc-${paper.id}`;
    await db
      .prepare(
        `INSERT OR IGNORE INTO binance_demo_futures_mirrors
         (paper_position_id, symbol, direction, quantity, leverage, margin_usdt,
          open_client_order_id, close_client_order_id, open_order_id,
          close_order_id, status, last_error, opened_at, closed_at, updated_at)
         VALUES (?, ?, ?, 0, ?, ?, ?, ?, NULL, NULL, 'pending-open', NULL,
                 NULL, NULL, ?)`,
      )
      .bind(
        paper.id,
        paper.symbol,
        paper.direction,
        paper.leverage,
        config.marginUsdt,
        openClientId,
        closeClientId,
        now,
      )
      .run();
    mirrorById.set(paper.id, {
      paper_position_id: paper.id,
      symbol: paper.symbol,
      direction: paper.direction,
      quantity: 0,
      leverage: paper.leverage,
      margin_usdt: config.marginUsdt,
      open_client_order_id: openClientId,
      close_client_order_id: closeClientId,
      open_order_id: null,
      close_order_id: null,
      status: "pending-open",
      last_error: null,
      opened_at: null,
      closed_at: null,
      updated_at: now,
    });
  }

  const toClose = [...mirrorById.values()].filter(
    (mirror) => !desiredIds.has(mirror.paper_position_id),
  );
  const toOpen = papers
    .map((paper) => ({ paper, mirror: mirrorById.get(paper.id)! }))
    .filter(({ mirror }) => mirror.status === "pending-open");
  if (!toClose.length && !toOpen.length) {
    await db
      .prepare(
        `UPDATE binance_demo_futures_state
         SET enabled = 1, base_url = ?, margin_usdt = ?, last_cycle_at = ?,
             last_error = NULL, updated_at = ?
         WHERE id = 1`,
      )
      .bind(config.baseUrl, config.marginUsdt, now, now)
      .run();
    return { skipped: false, opened: 0, closed: 0, errors: [] };
  }

  const client = new BinanceDemoClient(config);
  await client.synchronizeClock();
  const [exchange, hedgeMode] = await Promise.all([
    client.exchangeInfo(),
    client.hedgeMode(),
  ]);
  const symbols = new Map(
    (exchange.symbols ?? []).map((symbol) => [symbol.symbol ?? "", symbol]),
  );
  let opened = 0;
  let closed = 0;
  const errors: string[] = [];

  for (const mirror of toClose) {
    try {
      const symbol = symbols.get(mirror.symbol);
      if (!symbol || symbol.status !== "TRADING") {
        throw new Error(`${mirror.symbol} Binance Demo üzerinde işlemde değil.`);
      }
      await db
        .prepare(
          `UPDATE binance_demo_futures_mirrors
           SET status = 'pending-close', updated_at = ?
           WHERE paper_position_id = ?`,
        )
        .bind(now, mirror.paper_position_id)
        .run();
      if (await closeMirror(db, client, mirror, symbol, hedgeMode, now)) closed += 1;
    } catch (error) {
      const message = errorMessage(error);
      errors.push(`${mirror.symbol}: ${message}`);
      await updateMirrorError(db, mirror.paper_position_id, message, now);
    }
  }

  for (const { paper, mirror } of toOpen) {
    try {
      const symbol = symbols.get(paper.symbol);
      if (!symbol || symbol.status !== "TRADING") {
        throw new Error(`${paper.symbol} Binance Demo üzerinde işlemde değil.`);
      }
      if (await openMirror(db, client, paper, mirror, symbol, hedgeMode, now)) opened += 1;
    } catch (error) {
      const message = errorMessage(error);
      errors.push(`${paper.symbol}: ${message}`);
      await updateMirrorError(db, paper.id, message, now);
    }
  }

  await db
    .prepare(
      `UPDATE binance_demo_futures_state
       SET enabled = 1, base_url = ?, margin_usdt = ?, last_cycle_at = ?,
           last_error = ?, opens_succeeded = opens_succeeded + ?,
           closes_succeeded = closes_succeeded + ?, updated_at = ?
       WHERE id = 1`,
    )
    .bind(
      config.baseUrl,
      config.marginUsdt,
      now,
      errors.length ? errors.join(" | ").slice(0, 1000) : null,
      opened,
      closed,
      now,
    )
    .run();
  return { skipped: false, opened, closed, errors };
}

export async function getBinanceDemoFuturesMirrorStatus(db: D1Database) {
  await ensureSchema(db);
  const [state, mirrors] = await Promise.all([
    db.prepare(`SELECT * FROM binance_demo_futures_state WHERE id = 1`).first(),
    db
      .prepare(
        `SELECT paper_position_id, symbol, direction, quantity, leverage,
                margin_usdt, open_order_id, close_order_id, status, last_error,
                opened_at, closed_at, updated_at
         FROM binance_demo_futures_mirrors
         ORDER BY updated_at DESC
         LIMIT 50`,
      )
      .all(),
  ]);
  return { state, mirrors: mirrors.results };
}
