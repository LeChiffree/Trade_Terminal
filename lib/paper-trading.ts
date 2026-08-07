export const PAPER_DEFAULTS = {
  initialBalance: 100_000,
  marginPerTrade: 1_000,
  leverage: 5,
  maxPositions: 10,
  entryScore: 30,
  exitScore: 15,
  minimumConfidence: 70,
  takerFeeRate: 0.0005,
  slippageRate: 0.0002,
  maintenanceMarginRate: 0.005,
} as const;

type PaperDirection = "long" | "short";

export type PaperAccountRow = {
  id: number;
  initial_balance: number;
  cash_balance: number;
  margin_per_trade: number;
  leverage: number;
  max_positions: number;
  entry_score: number;
  exit_score: number;
  minimum_confidence: number;
  taker_fee_rate: number;
  slippage_rate: number;
  maintenance_margin_rate: number;
  realized_net_pnl: number;
  total_fees: number;
  total_slippage: number;
  total_funding: number;
  trades_closed: number;
  wins: number;
  losses: number;
  last_cycle_at: number;
  updated_at: number;
};

export type PaperPositionRow = {
  id: number;
  symbol: string;
  base_asset: string;
  interval: string;
  direction: PaperDirection;
  status: "open" | "closed";
  entry_score: number;
  current_score: number;
  confidence: number;
  entry_price: number;
  mark_price: number;
  quantity: number;
  margin: number;
  leverage: number;
  notional: number;
  funding_rate: number;
  next_funding_at: number;
  funding_pnl: number;
  entry_fee: number;
  exit_fee: number;
  entry_slippage: number;
  exit_slippage: number;
  gross_pnl: number;
  net_pnl: number;
  liquidation_price: number;
  opened_at: number;
  closed_at: number | null;
  close_reason: string | null;
  updated_at: number;
};

type PaperScoreRow = {
  symbol: string;
  base_asset: string;
  interval: string;
  final_score: number;
  confidence: number;
  direction: string;
};

type FuturesQuote = {
  symbol: string;
  markPrice: number;
  fundingRate: number;
  nextFundingAt: number;
};

export type PaperMarkInput = {
  direction: PaperDirection;
  entryPrice: number;
  markPrice: number;
  quantity: number;
  margin: number;
  notional: number;
  entryFee: number;
  entrySlippage: number;
  fundingPnl: number;
  takerFeeRate: number;
  slippageRate: number;
};

export type PaperMarkResult = {
  exitNotional: number;
  grossPnl: number;
  exitFee: number;
  exitSlippage: number;
  netPnl: number;
  roePercent: number;
};

export type PaperTradeStatus = {
  account: PaperAccountRow | null;
  metrics: {
    equity: number;
    availableCash: number;
    reservedMargin: number;
    realizedNetPnl: number;
    unrealizedNetPnl: number;
    totalNetPnl: number;
    totalFees: number;
    totalSlippage: number;
    fundingPnl: number;
    openPositions: number;
    closedTrades: number;
    winRate: number;
  };
  openPositions: PaperPositionRow[];
  history: PaperPositionRow[];
};

const PAPER_CREATE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS paper_account (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    initial_balance REAL NOT NULL DEFAULT 100000,
    cash_balance REAL NOT NULL DEFAULT 100000,
    margin_per_trade REAL NOT NULL DEFAULT 1000,
    leverage INTEGER NOT NULL DEFAULT 5,
    max_positions INTEGER NOT NULL DEFAULT 10,
    entry_score INTEGER NOT NULL DEFAULT 30,
    exit_score INTEGER NOT NULL DEFAULT 15,
    minimum_confidence INTEGER NOT NULL DEFAULT 70,
    taker_fee_rate REAL NOT NULL DEFAULT 0.0005,
    slippage_rate REAL NOT NULL DEFAULT 0.0002,
    maintenance_margin_rate REAL NOT NULL DEFAULT 0.005,
    realized_net_pnl REAL NOT NULL DEFAULT 0,
    total_fees REAL NOT NULL DEFAULT 0,
    total_slippage REAL NOT NULL DEFAULT 0,
    total_funding REAL NOT NULL DEFAULT 0,
    trades_closed INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    last_cycle_at INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS paper_positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    base_asset TEXT NOT NULL,
    interval TEXT NOT NULL,
    direction TEXT NOT NULL,
    status TEXT NOT NULL,
    entry_score INTEGER NOT NULL,
    current_score INTEGER NOT NULL,
    confidence INTEGER NOT NULL,
    entry_price REAL NOT NULL,
    mark_price REAL NOT NULL,
    quantity REAL NOT NULL,
    margin REAL NOT NULL,
    leverage INTEGER NOT NULL,
    notional REAL NOT NULL,
    funding_rate REAL NOT NULL DEFAULT 0,
    next_funding_at INTEGER NOT NULL DEFAULT 0,
    funding_pnl REAL NOT NULL DEFAULT 0,
    entry_fee REAL NOT NULL DEFAULT 0,
    exit_fee REAL NOT NULL DEFAULT 0,
    entry_slippage REAL NOT NULL DEFAULT 0,
    exit_slippage REAL NOT NULL DEFAULT 0,
    gross_pnl REAL NOT NULL DEFAULT 0,
    net_pnl REAL NOT NULL DEFAULT 0,
    liquidation_price REAL NOT NULL,
    opened_at INTEGER NOT NULL,
    closed_at INTEGER,
    close_reason TEXT,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS paper_positions_status_opened_idx
    ON paper_positions (status, opened_at DESC)`,
];

const INSERT_PAPER_ACCOUNT = `INSERT OR IGNORE INTO paper_account
  (id, initial_balance, cash_balance, margin_per_trade, leverage, max_positions,
   entry_score, exit_score, minimum_confidence, taker_fee_rate, slippage_rate,
   maintenance_margin_rate, updated_at)
  VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

let paperSchemaReady = false;

function finite(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function directionSign(direction: PaperDirection) {
  return direction === "long" ? 1 : -1;
}

export function calculatePaperMark(input: PaperMarkInput): PaperMarkResult {
  const sign = directionSign(input.direction);
  const exitNotional = Math.max(0, input.quantity * input.markPrice);
  const grossPnl =
    sign * input.quantity * (input.markPrice - input.entryPrice);
  const exitFee = exitNotional * input.takerFeeRate;
  const exitSlippage = exitNotional * input.slippageRate;
  const netPnl =
    grossPnl +
    input.fundingPnl -
    input.entryFee -
    input.entrySlippage -
    exitFee -
    exitSlippage;
  return {
    exitNotional,
    grossPnl,
    exitFee,
    exitSlippage,
    netPnl,
    roePercent: input.margin > 0 ? (netPnl / input.margin) * 100 : 0,
  };
}

export function paperCloseReason(
  direction: PaperDirection,
  markPrice: number,
  liquidationPrice: number,
  currentScore: number | null,
  currentDirection: string | null,
  exitScore: number = PAPER_DEFAULTS.exitScore,
) {
  const liquidated =
    direction === "long"
      ? markPrice <= liquidationPrice
      : markPrice >= liquidationPrice;
  if (liquidated) return "liquidation";
  if (
    currentDirection === "long" ||
    currentDirection === "short"
  ) {
    if (currentDirection !== direction) return "direction-reversal";
  }
  if (currentScore !== null && Math.abs(currentScore) <= exitScore) {
    return "score-normalized";
  }
  return null;
}

export async function ensurePaperTradingSchema(db: D1Database) {
  if (paperSchemaReady) return;
  for (let index = 0; index < PAPER_CREATE_STATEMENTS.length; index += 50) {
    await db.batch(
      PAPER_CREATE_STATEMENTS.slice(index, index + 50).map((statement) =>
        db.prepare(statement)
      ),
    );
  }
  const now = Date.now();
  await db
    .prepare(INSERT_PAPER_ACCOUNT)
    .bind(
      PAPER_DEFAULTS.initialBalance,
      PAPER_DEFAULTS.initialBalance,
      PAPER_DEFAULTS.marginPerTrade,
      PAPER_DEFAULTS.leverage,
      PAPER_DEFAULTS.maxPositions,
      PAPER_DEFAULTS.entryScore,
      PAPER_DEFAULTS.exitScore,
      PAPER_DEFAULTS.minimumConfidence,
      PAPER_DEFAULTS.takerFeeRate,
      PAPER_DEFAULTS.slippageRate,
      PAPER_DEFAULTS.maintenanceMarginRate,
      now,
    )
    .run();
  await db
    .prepare(
      `UPDATE paper_account
       SET max_positions = ?, updated_at = ?
       WHERE id = 1 AND max_positions < ?`,
    )
    .bind(
      PAPER_DEFAULTS.maxPositions,
      now,
      PAPER_DEFAULTS.maxPositions,
    )
    .run();
  await db.prepare("PRAGMA optimize").run();
  paperSchemaReady = true;
}

async function fetchFuturesQuotes() {
  const response = await fetch(
    "https://fapi.binance.com/fapi/v1/premiumIndex",
    {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(7_000),
      cache: "no-store",
    },
  );
  if (!response.ok) throw new Error(`Binance Futures ${response.status}`);
  const payload = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error("Binance Futures mark fiyatı alınamadı.");
  }
  const quotes = new Map<string, FuturesQuote>();
  for (const value of payload) {
    if (!value || typeof value !== "object") continue;
    const item = value as Record<string, unknown>;
    const symbol = String(item.symbol ?? "").toUpperCase();
    const markPrice = finite(item.markPrice);
    if (!symbol || markPrice <= 0) continue;
    quotes.set(symbol, {
      symbol,
      markPrice,
      fundingRate: finite(item.lastFundingRate),
      nextFundingAt: Math.max(0, Math.trunc(finite(item.nextFundingTime))),
    });
  }
  return quotes;
}

function liquidationPrice(
  direction: PaperDirection,
  entryPrice: number,
  leverage: number,
  maintenanceMarginRate: number,
) {
  const distance = Math.max(
    0.01,
    1 / Math.max(1, leverage) - maintenanceMarginRate,
  );
  return direction === "long"
    ? entryPrice * (1 - distance)
    : entryPrice * (1 + distance);
}

function currentFunding(
  position: PaperPositionRow,
  quote: FuturesQuote,
  now: number,
) {
  if (
    !position.next_funding_at ||
    now < position.next_funding_at
  ) {
    return {
      fundingPnl: position.funding_pnl,
      fundingRate: quote.fundingRate,
      nextFundingAt: quote.nextFundingAt,
    };
  }
  const fundingNotional = position.quantity * quote.markPrice;
  const payment =
    -directionSign(position.direction) * fundingNotional * quote.fundingRate;
  return {
    fundingPnl: position.funding_pnl + payment,
    fundingRate: quote.fundingRate,
    nextFundingAt:
      quote.nextFundingAt > now
        ? quote.nextFundingAt
        : now + 8 * 60 * 60_000,
  };
}

export async function runPaperTradingCycle(db: D1Database, now = Date.now()) {
  await ensurePaperTradingSchema(db);
  const [account, openRows, scoreRows, quotes] = await Promise.all([
    db
      .prepare(`SELECT * FROM paper_account WHERE id = 1`)
      .first<PaperAccountRow>(),
    db
      .prepare(
        `SELECT * FROM paper_positions
         WHERE status = 'open'
         ORDER BY opened_at ASC`,
      )
      .all<PaperPositionRow>(),
    db
      .prepare(
        `SELECT symbol, base_asset, interval, final_score, confidence, direction
         FROM scanner_scores
         WHERE source = 'binance' AND last_scanned_at >= ?
         ORDER BY ABS(final_score) DESC, confidence DESC`,
      )
      .bind(now - 2 * 60 * 60_000)
      .all<PaperScoreRow>(),
    fetchFuturesQuotes(),
  ]);
  if (!account) throw new Error("Paper trade hesabı oluşturulamadı.");

  const scores = scoreRows.results;
  const scoreByKey = new Map(
    scores.map((score) => [`${score.symbol}:${score.interval}`, score]),
  );
  const statements: D1PreparedStatement[] = [];
  const stillOpen: PaperPositionRow[] = [];
  const closedSymbols = new Set<string>();
  let cashBalance = account.cash_balance;
  let realizedNetPnl = account.realized_net_pnl;
  let totalFees = account.total_fees;
  let totalSlippage = account.total_slippage;
  let totalFunding = account.total_funding;
  let tradesClosed = account.trades_closed;
  let wins = account.wins;
  let losses = account.losses;

  for (const position of openRows.results) {
    const quote = quotes.get(position.symbol);
    if (!quote) {
      stillOpen.push(position);
      continue;
    }
    const score = scoreByKey.get(`${position.symbol}:${position.interval}`);
    const funding = currentFunding(position, quote, now);
    const mark = calculatePaperMark({
      direction: position.direction,
      entryPrice: position.entry_price,
      markPrice: quote.markPrice,
      quantity: position.quantity,
      margin: position.margin,
      notional: position.notional,
      entryFee: position.entry_fee,
      entrySlippage: position.entry_slippage,
      fundingPnl: funding.fundingPnl,
      takerFeeRate: account.taker_fee_rate,
      slippageRate: account.slippage_rate,
    });
    const closeReason = paperCloseReason(
      position.direction,
      quote.markPrice,
      position.liquidation_price,
      score?.final_score ?? null,
      score?.direction ?? null,
      account.exit_score,
    );
    if (!closeReason) {
      statements.push(
        db
          .prepare(
            `UPDATE paper_positions
             SET current_score = ?, confidence = ?, mark_price = ?,
                 funding_rate = ?, next_funding_at = ?, funding_pnl = ?,
                 exit_fee = ?, exit_slippage = ?, gross_pnl = ?, net_pnl = ?,
                 updated_at = ?
             WHERE id = ? AND status = 'open'`,
          )
          .bind(
            score?.final_score ?? position.current_score,
            score?.confidence ?? position.confidence,
            quote.markPrice,
            funding.fundingRate,
            funding.nextFundingAt,
            funding.fundingPnl,
            mark.exitFee,
            mark.exitSlippage,
            mark.grossPnl,
            mark.netPnl,
            now,
            position.id,
          ),
      );
      stillOpen.push({
        ...position,
        current_score: score?.final_score ?? position.current_score,
        confidence: score?.confidence ?? position.confidence,
        mark_price: quote.markPrice,
        funding_rate: funding.fundingRate,
        next_funding_at: funding.nextFundingAt,
        funding_pnl: funding.fundingPnl,
        exit_fee: mark.exitFee,
        exit_slippage: mark.exitSlippage,
        gross_pnl: mark.grossPnl,
        net_pnl: mark.netPnl,
        updated_at: now,
      });
      continue;
    }

    const settlement = Math.max(
      0,
      position.margin +
        mark.grossPnl +
        funding.fundingPnl -
        mark.exitFee -
        mark.exitSlippage,
    );
    const netPnl =
      settlement -
      position.margin -
      position.entry_fee -
      position.entry_slippage;
    cashBalance += settlement;
    realizedNetPnl += netPnl;
    totalFees += mark.exitFee;
    totalSlippage += mark.exitSlippage;
    totalFunding += funding.fundingPnl;
    tradesClosed += 1;
    if (netPnl > 0) wins += 1;
    else losses += 1;
    closedSymbols.add(position.symbol);
    statements.push(
      db
        .prepare(
          `UPDATE paper_positions
           SET status = 'closed', current_score = ?, confidence = ?,
               mark_price = ?, funding_rate = ?, next_funding_at = ?,
               funding_pnl = ?, exit_fee = ?, exit_slippage = ?,
               gross_pnl = ?, net_pnl = ?, closed_at = ?, close_reason = ?,
               updated_at = ?
           WHERE id = ? AND status = 'open'`,
        )
        .bind(
          score?.final_score ?? position.current_score,
          score?.confidence ?? position.confidence,
          quote.markPrice,
          funding.fundingRate,
          funding.nextFundingAt,
          funding.fundingPnl,
          mark.exitFee,
          mark.exitSlippage,
          mark.grossPnl,
          netPnl,
          now,
          closeReason,
          now,
          position.id,
        ),
    );
  }

  const openSymbols = new Set(stillOpen.map((position) => position.symbol));
  const candidates = scores.filter(
    (score) =>
      (score.direction === "long" || score.direction === "short") &&
      Math.abs(score.final_score) >= account.entry_score &&
      score.confidence >= account.minimum_confidence,
  );
  for (const score of candidates) {
    if (stillOpen.length >= account.max_positions) break;
    if (
      openSymbols.has(score.symbol) ||
      closedSymbols.has(score.symbol)
    ) continue;
    const quote = quotes.get(score.symbol);
    if (!quote) continue;
    const direction = score.direction as PaperDirection;
    const notional = account.margin_per_trade * account.leverage;
    const entryFee = notional * account.taker_fee_rate;
    const entrySlippage = notional * account.slippage_rate;
    const requiredCash = account.margin_per_trade + entryFee + entrySlippage;
    if (cashBalance < requiredCash) break;
    const quantity = notional / quote.markPrice;
    const liquidation = liquidationPrice(
      direction,
      quote.markPrice,
      account.leverage,
      account.maintenance_margin_rate,
    );
    cashBalance -= requiredCash;
    totalFees += entryFee;
    totalSlippage += entrySlippage;
    openSymbols.add(score.symbol);
    const position: Omit<PaperPositionRow, "id"> = {
      symbol: score.symbol,
      base_asset: score.base_asset,
      interval: score.interval,
      direction,
      status: "open",
      entry_score: score.final_score,
      current_score: score.final_score,
      confidence: score.confidence,
      entry_price: quote.markPrice,
      mark_price: quote.markPrice,
      quantity,
      margin: account.margin_per_trade,
      leverage: account.leverage,
      notional,
      funding_rate: quote.fundingRate,
      next_funding_at: quote.nextFundingAt,
      funding_pnl: 0,
      entry_fee: entryFee,
      exit_fee: notional * account.taker_fee_rate,
      entry_slippage: entrySlippage,
      exit_slippage: notional * account.slippage_rate,
      gross_pnl: 0,
      net_pnl: -(entryFee + entrySlippage * 2 + notional * account.taker_fee_rate),
      liquidation_price: liquidation,
      opened_at: now,
      closed_at: null,
      close_reason: null,
      updated_at: now,
    };
    stillOpen.push({ ...position, id: -stillOpen.length - 1 });
    statements.push(
      db
        .prepare(
          `INSERT INTO paper_positions
           (symbol, base_asset, interval, direction, status, entry_score,
            current_score, confidence, entry_price, mark_price, quantity,
            margin, leverage, notional, funding_rate, next_funding_at,
            funding_pnl, entry_fee, exit_fee, entry_slippage, exit_slippage,
            gross_pnl, net_pnl, liquidation_price, opened_at, closed_at,
            close_reason, updated_at)
           VALUES (
             ?, ?, ?, ?, 'open',
             ?, ?, ?, ?, ?,
             ?, ?, ?, ?, ?,
             ?, ?, ?, ?, ?,
             ?, ?, ?, ?, ?,
             NULL, NULL, ?
           )`,
        )
        .bind(
          position.symbol,
          position.base_asset,
          position.interval,
          position.direction,
          position.entry_score,
          position.current_score,
          position.confidence,
          position.entry_price,
          position.mark_price,
          position.quantity,
          position.margin,
          position.leverage,
          position.notional,
          position.funding_rate,
          position.next_funding_at,
          position.funding_pnl,
          position.entry_fee,
          position.exit_fee,
          position.entry_slippage,
          position.exit_slippage,
          position.gross_pnl,
          position.net_pnl,
          position.liquidation_price,
          position.opened_at,
          now,
        ),
    );
  }

  statements.push(
    db
      .prepare(
        `UPDATE paper_account
         SET cash_balance = ?, realized_net_pnl = ?, total_fees = ?,
             total_slippage = ?, total_funding = ?, trades_closed = ?,
             wins = ?, losses = ?, last_cycle_at = ?, updated_at = ?
         WHERE id = 1`,
      )
      .bind(
        cashBalance,
        realizedNetPnl,
        totalFees,
        totalSlippage,
        totalFunding,
        tradesClosed,
        wins,
        losses,
        now,
        now,
      ),
  );
  for (let index = 0; index < statements.length; index += 50) {
    await db.batch(statements.slice(index, index + 50));
  }
}

function emptyMetrics() {
  return {
    equity: PAPER_DEFAULTS.initialBalance,
    availableCash: PAPER_DEFAULTS.initialBalance,
    reservedMargin: 0,
    realizedNetPnl: 0,
    unrealizedNetPnl: 0,
    totalNetPnl: 0,
    totalFees: 0,
    totalSlippage: 0,
    fundingPnl: 0,
    openPositions: 0,
    closedTrades: 0,
    winRate: 0,
  };
}

export async function getPaperTradingStatus(
  db: D1Database,
): Promise<PaperTradeStatus> {
  await ensurePaperTradingSchema(db);
  const [account, openRows, historyRows] = await Promise.all([
    db
      .prepare(`SELECT * FROM paper_account WHERE id = 1`)
      .first<PaperAccountRow>(),
    db
      .prepare(
        `SELECT * FROM paper_positions
         WHERE status = 'open'
         ORDER BY ABS(net_pnl) DESC, opened_at DESC`,
      )
      .all<PaperPositionRow>(),
    db
      .prepare(
        `SELECT * FROM paper_positions
         WHERE status = 'closed'
         ORDER BY closed_at DESC
         LIMIT 50`,
      )
      .all<PaperPositionRow>(),
  ]);
  if (!account) {
    return {
      account: null,
      metrics: emptyMetrics(),
      openPositions: [],
      history: [],
    };
  }
  const openPositions = openRows.results;
  const reservedMargin = openPositions.reduce(
    (total, position) => total + position.margin,
    0,
  );
  const unrealizedNetPnl = openPositions.reduce(
    (total, position) => total + position.net_pnl,
    0,
  );
  const openFunding = openPositions.reduce(
    (total, position) => total + position.funding_pnl,
    0,
  );
  const equity =
    account.initial_balance +
    account.realized_net_pnl +
    unrealizedNetPnl;
  return {
    account,
    metrics: {
      equity,
      availableCash: account.cash_balance,
      reservedMargin,
      realizedNetPnl: account.realized_net_pnl,
      unrealizedNetPnl,
      totalNetPnl: equity - account.initial_balance,
      totalFees: account.total_fees,
      totalSlippage: account.total_slippage,
      fundingPnl: account.total_funding + openFunding,
      openPositions: openPositions.length,
      closedTrades: account.trades_closed,
      winRate:
        account.trades_closed > 0
          ? (account.wins / account.trades_closed) * 100
          : 0,
    },
    openPositions,
    history: historyRows.results,
  };
}
