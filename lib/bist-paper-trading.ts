import {
  BIST_INTERVALS,
  fetchBistSymbols,
  fetchTopBistSymbols,
  type BistInterval,
} from "./bist";
import {
  bistPaperCloseReason,
  calculateBistPaperMark,
  chooseBistPaperLeaders,
  type BistPaperCandidate,
} from "./bist-paper-math";

export const BIST_PAPER_DEFAULTS = {
  initialBalance: 100_000,
  capitalPerTrade: 1_000,
  maxPositions: 15,
  entryScore: 30,
  exitScore: 15,
  minimumConfidence: 70,
  commissionRate: 0.0005,
  slippageRate: 0.0002,
} as const;

export type BistPaperAccountRow = {
  id: number;
  enabled: number;
  initial_balance: number;
  cash_balance: number;
  capital_per_trade: number;
  max_positions: number;
  entry_score: number;
  exit_score: number;
  minimum_confidence: number;
  commission_rate: number;
  slippage_rate: number;
  realized_net_pnl: number;
  total_fees: number;
  total_slippage: number;
  trades_closed: number;
  wins: number;
  losses: number;
  lease_until: number;
  last_cycle_at: number;
  last_error: string | null;
  updated_at: number;
};

export type BistPaperPositionRow = {
  id: number;
  symbol: string;
  name: string;
  interval: string;
  direction: "long";
  status: "open" | "closed";
  entry_score: number;
  current_score: number;
  confidence: number;
  entry_price: number;
  mark_price: number;
  quantity: number;
  capital: number;
  entry_fee: number;
  exit_fee: number;
  entry_slippage: number;
  exit_slippage: number;
  gross_pnl: number;
  net_pnl: number;
  opened_at: number;
  closed_at: number | null;
  close_reason: string | null;
  updated_at: number;
};

export type BistPaperTradeStatus = {
  configured: boolean;
  delayedMinutes: number;
  account: BistPaperAccountRow | null;
  metrics: {
    equity: number;
    availableCash: number;
    reservedCapital: number;
    realizedNetPnl: number;
    unrealizedNetPnl: number;
    totalNetPnl: number;
    totalFees: number;
    totalSlippage: number;
    openPositions: number;
    closedTrades: number;
    winRate: number;
  };
  openPositions: BistPaperPositionRow[];
  history: BistPaperPositionRow[];
  generatedAt: number;
};

const CREATE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS bist_paper_account (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    enabled INTEGER NOT NULL DEFAULT 1,
    initial_balance REAL NOT NULL DEFAULT 100000,
    cash_balance REAL NOT NULL DEFAULT 100000,
    capital_per_trade REAL NOT NULL DEFAULT 1000,
    max_positions INTEGER NOT NULL DEFAULT 15,
    entry_score INTEGER NOT NULL DEFAULT 30,
    exit_score INTEGER NOT NULL DEFAULT 15,
    minimum_confidence INTEGER NOT NULL DEFAULT 70,
    commission_rate REAL NOT NULL DEFAULT 0.0005,
    slippage_rate REAL NOT NULL DEFAULT 0.0002,
    realized_net_pnl REAL NOT NULL DEFAULT 0,
    total_fees REAL NOT NULL DEFAULT 0,
    total_slippage REAL NOT NULL DEFAULT 0,
    trades_closed INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    lease_until INTEGER NOT NULL DEFAULT 0,
    last_cycle_at INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    updated_at INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS bist_paper_positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    name TEXT NOT NULL,
    interval TEXT NOT NULL,
    direction TEXT NOT NULL DEFAULT 'long',
    status TEXT NOT NULL,
    entry_score INTEGER NOT NULL,
    current_score INTEGER NOT NULL,
    confidence INTEGER NOT NULL,
    entry_price REAL NOT NULL,
    mark_price REAL NOT NULL,
    quantity REAL NOT NULL,
    capital REAL NOT NULL,
    entry_fee REAL NOT NULL DEFAULT 0,
    exit_fee REAL NOT NULL DEFAULT 0,
    entry_slippage REAL NOT NULL DEFAULT 0,
    exit_slippage REAL NOT NULL DEFAULT 0,
    gross_pnl REAL NOT NULL DEFAULT 0,
    net_pnl REAL NOT NULL DEFAULT 0,
    opened_at INTEGER NOT NULL,
    closed_at INTEGER,
    close_reason TEXT,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_bist_paper_positions_status_opened
    ON bist_paper_positions (status, opened_at DESC)`,
];

const INSERT_ACCOUNT = `INSERT OR IGNORE INTO bist_paper_account
  (id, enabled, initial_balance, cash_balance, capital_per_trade,
   max_positions, entry_score, exit_score, minimum_confidence,
   commission_rate, slippage_rate, updated_at)
  VALUES (1, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

let schemaReady = false;

export async function ensureBistPaperTradingSchema(db: D1Database) {
  if (schemaReady) return;
  await db.batch(CREATE_STATEMENTS.map((statement) => db.prepare(statement)));
  const now = Date.now();
  await db
    .prepare(INSERT_ACCOUNT)
    .bind(
      BIST_PAPER_DEFAULTS.initialBalance,
      BIST_PAPER_DEFAULTS.initialBalance,
      BIST_PAPER_DEFAULTS.capitalPerTrade,
      BIST_PAPER_DEFAULTS.maxPositions,
      BIST_PAPER_DEFAULTS.entryScore,
      BIST_PAPER_DEFAULTS.exitScore,
      BIST_PAPER_DEFAULTS.minimumConfidence,
      BIST_PAPER_DEFAULTS.commissionRate,
      BIST_PAPER_DEFAULTS.slippageRate,
      now,
    )
    .run();
  await db
    .prepare(
      `UPDATE bist_paper_account
       SET max_positions = ?, updated_at = ?
       WHERE id = 1 AND max_positions < ?`,
    )
    .bind(
      BIST_PAPER_DEFAULTS.maxPositions,
      now,
      BIST_PAPER_DEFAULTS.maxPositions,
    )
    .run();
  await db.prepare("PRAGMA optimize").run();
  schemaReady = true;
}

async function acquireLease(db: D1Database, now: number) {
  const result = await db
    .prepare(
      `UPDATE bist_paper_account
       SET lease_until = ?, updated_at = ?
       WHERE id = 1 AND enabled = 1 AND lease_until < ?`,
    )
    .bind(now + 50_000, now, now)
    .run();
  return Number(result.meta.changes ?? 0) > 0;
}

function rowsFromDirectories(
  directories: Awaited<ReturnType<typeof fetchTopBistSymbols>>[],
) {
  return directories.flatMap((directory): BistPaperCandidate[] => {
    if (directory.source !== "tradingview") return [];
    return directory.symbols.flatMap((symbol): BistPaperCandidate[] =>
      symbol.direction === "unavailable"
        ? []
        : [{
            symbol: symbol.symbol,
            name: symbol.name,
            interval: directory.interval,
            score: symbol.score,
            confidence: symbol.confidence,
            price: symbol.lastPrice,
          }]
    );
  });
}

async function releaseLease(
  db: D1Database,
  now: number,
  error: string | null,
) {
  await db
    .prepare(
      `UPDATE bist_paper_account
       SET lease_until = 0, last_error = ?, updated_at = ?
       WHERE id = 1`,
    )
    .bind(error, now)
    .run();
}

export async function runBistPaperTradingCycle(
  db: D1Database,
  now = Date.now(),
) {
  await ensureBistPaperTradingSchema(db);
  if (!(await acquireLease(db, now))) {
    return { skipped: true, reason: "lease-or-disabled" };
  }

  try {
    const [account, openRows] = await Promise.all([
      db
        .prepare("SELECT * FROM bist_paper_account WHERE id = 1")
        .first<BistPaperAccountRow>(),
      db
        .prepare(
          `SELECT * FROM bist_paper_positions
           WHERE status = 'open'
           ORDER BY opened_at ASC`,
        )
        .all<BistPaperPositionRow>(),
    ]);
    if (!account) throw new Error("BIST paper hesabı oluşturulamadı.");

    const openSymbolsByInterval = new Map<BistInterval, string[]>();
    for (const position of openRows.results) {
      if (!BIST_INTERVALS.includes(position.interval as BistInterval)) continue;
      const interval = position.interval as BistInterval;
      openSymbolsByInterval.set(interval, [
        ...(openSymbolsByInterval.get(interval) ?? []),
        position.symbol,
      ]);
    }
    const [directories, openPositionDirectories] = await Promise.all([
      Promise.all(
        BIST_INTERVALS.map((interval) => fetchTopBistSymbols(interval, 80)),
      ),
      Promise.all(
        [...openSymbolsByInterval].map(([interval, symbols]) =>
          fetchBistSymbols(interval, symbols)
        ),
      ),
    ]);

    const liveDirectories = directories.filter(
      (directory) => directory.source === "tradingview",
    );
    if (!liveDirectories.length) {
      throw new Error("Canlı gecikmeli BIST puanları alınamadı.");
    }

    const leaderRows = rowsFromDirectories(directories);
    const positionScoreRows = rowsFromDirectories([
      ...directories,
      ...openPositionDirectories,
    ]);
    const leaders = chooseBistPaperLeaders(leaderRows);
    const scoreByKey = new Map(
      positionScoreRows.map((row) => [`${row.symbol}:${row.interval}`, row]),
    );
    const statements: D1PreparedStatement[] = [];
    const stillOpen: BistPaperPositionRow[] = [];
    const closedSymbols = new Set<string>();
    let cashBalance = account.cash_balance;
    let realizedNetPnl = account.realized_net_pnl;
    let totalFees = account.total_fees;
    let totalSlippage = account.total_slippage;
    let tradesClosed = account.trades_closed;
    let wins = account.wins;
    let losses = account.losses;

    for (const position of openRows.results) {
      const score = scoreByKey.get(`${position.symbol}:${position.interval}`);
      if (!score) {
        stillOpen.push(position);
        continue;
      }
      const mark = calculateBistPaperMark({
        entryPrice: position.entry_price,
        markPrice: score.price,
        quantity: position.quantity,
        capital: position.capital,
        entryFee: position.entry_fee,
        entrySlippage: position.entry_slippage,
        commissionRate: account.commission_rate,
        slippageRate: account.slippage_rate,
      });
      const closeReason = bistPaperCloseReason(
        score.score,
        account.exit_score,
      );
      if (!closeReason) {
        statements.push(
          db
            .prepare(
              `UPDATE bist_paper_positions
               SET current_score = ?, confidence = ?, mark_price = ?,
                   exit_fee = ?, exit_slippage = ?, gross_pnl = ?,
                   net_pnl = ?, updated_at = ?
               WHERE id = ? AND status = 'open'`,
            )
            .bind(
              score.score,
              score.confidence,
              score.price,
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
          current_score: score.score,
          confidence: score.confidence,
          mark_price: score.price,
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
        position.capital +
          mark.grossPnl -
          mark.exitFee -
          mark.exitSlippage,
      );
      cashBalance += settlement;
      realizedNetPnl += mark.netPnl;
      totalFees += mark.exitFee;
      totalSlippage += mark.exitSlippage;
      tradesClosed += 1;
      if (mark.netPnl > 0) wins += 1;
      else losses += 1;
      closedSymbols.add(position.symbol);
      statements.push(
        db
          .prepare(
            `UPDATE bist_paper_positions
             SET status = 'closed', current_score = ?, confidence = ?,
                 mark_price = ?, exit_fee = ?, exit_slippage = ?,
                 gross_pnl = ?, net_pnl = ?, closed_at = ?,
                 close_reason = ?, updated_at = ?
             WHERE id = ? AND status = 'open'`,
          )
          .bind(
            score.score,
            score.confidence,
            score.price,
            mark.exitFee,
            mark.exitSlippage,
            mark.grossPnl,
            mark.netPnl,
            now,
            closeReason,
            now,
            position.id,
          ),
      );
    }

    const openSymbols = new Set(
      stillOpen.map((position) => position.symbol),
    );
    const candidates = leaders.filter(
      (candidate) =>
        candidate.score >= account.entry_score &&
        candidate.confidence >= account.minimum_confidence,
    );
    for (const candidate of candidates) {
      if (stillOpen.length >= account.max_positions) break;
      if (
        openSymbols.has(candidate.symbol) ||
        closedSymbols.has(candidate.symbol)
      ) continue;
      const capital = account.capital_per_trade;
      const entryFee = capital * account.commission_rate;
      const entrySlippage = capital * account.slippage_rate;
      const requiredCash = capital + entryFee + entrySlippage;
      if (cashBalance < requiredCash) break;
      const quantity = capital / candidate.price;
      const mark = calculateBistPaperMark({
        entryPrice: candidate.price,
        markPrice: candidate.price,
        quantity,
        capital,
        entryFee,
        entrySlippage,
        commissionRate: account.commission_rate,
        slippageRate: account.slippage_rate,
      });
      cashBalance -= requiredCash;
      totalFees += entryFee;
      totalSlippage += entrySlippage;
      openSymbols.add(candidate.symbol);
      const position: Omit<BistPaperPositionRow, "id"> = {
        symbol: candidate.symbol,
        name: candidate.name,
        interval: candidate.interval,
        direction: "long",
        status: "open",
        entry_score: candidate.score,
        current_score: candidate.score,
        confidence: candidate.confidence,
        entry_price: candidate.price,
        mark_price: candidate.price,
        quantity,
        capital,
        entry_fee: entryFee,
        exit_fee: mark.exitFee,
        entry_slippage: entrySlippage,
        exit_slippage: mark.exitSlippage,
        gross_pnl: mark.grossPnl,
        net_pnl: mark.netPnl,
        opened_at: now,
        closed_at: null,
        close_reason: null,
        updated_at: now,
      };
      stillOpen.push({ ...position, id: -stillOpen.length - 1 });
      statements.push(
        db
          .prepare(
            `INSERT INTO bist_paper_positions
             (symbol, name, interval, direction, status, entry_score,
              current_score, confidence, entry_price, mark_price, quantity,
              capital, entry_fee, exit_fee, entry_slippage, exit_slippage,
              gross_pnl, net_pnl, opened_at, closed_at, close_reason, updated_at)
             VALUES (
               ?, ?, ?, 'long', 'open', ?, ?, ?, ?, ?, ?, ?,
               ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?
             )`,
          )
          .bind(
            position.symbol,
            position.name,
            position.interval,
            position.entry_score,
            position.current_score,
            position.confidence,
            position.entry_price,
            position.mark_price,
            position.quantity,
            position.capital,
            position.entry_fee,
            position.exit_fee,
            position.entry_slippage,
            position.exit_slippage,
            position.gross_pnl,
            position.net_pnl,
            position.opened_at,
            position.updated_at,
          ),
      );
    }

    statements.push(
      db
        .prepare(
          `UPDATE bist_paper_account
           SET cash_balance = ?, realized_net_pnl = ?, total_fees = ?,
               total_slippage = ?, trades_closed = ?, wins = ?, losses = ?,
               last_cycle_at = ?, last_error = NULL, updated_at = ?
           WHERE id = 1`,
        )
        .bind(
          cashBalance,
          realizedNetPnl,
          totalFees,
          totalSlippage,
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
    await releaseLease(db, Date.now(), null);
    return {
      skipped: false,
      openPositions: stillOpen.length,
      liveIntervals: liveDirectories.length,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message.slice(0, 500)
        : "BIST paper döngüsü başarısız.";
    await releaseLease(db, Date.now(), message);
    throw error;
  }
}

export async function runBistPaperTradingCycleIfDue(
  db: D1Database,
  now = Date.now(),
  minimumIntervalMs = 55_000,
) {
  await ensureBistPaperTradingSchema(db);
  const account = await db
    .prepare(
      `SELECT enabled, last_cycle_at, lease_until
       FROM bist_paper_account
       WHERE id = 1`,
    )
    .first<{
      enabled: number;
      last_cycle_at: number;
      lease_until: number;
    }>();
  if (!account?.enabled) {
    return { skipped: true, reason: "disabled" } as const;
  }
  if (account.lease_until >= now) {
    return { skipped: true, reason: "lease-active" } as const;
  }
  if (
    account.last_cycle_at > 0 &&
    now - account.last_cycle_at < minimumIntervalMs
  ) {
    return { skipped: true, reason: "not-due" } as const;
  }
  return await runBistPaperTradingCycle(db, now);
}

function emptyMetrics() {
  return {
    equity: BIST_PAPER_DEFAULTS.initialBalance,
    availableCash: BIST_PAPER_DEFAULTS.initialBalance,
    reservedCapital: 0,
    realizedNetPnl: 0,
    unrealizedNetPnl: 0,
    totalNetPnl: 0,
    totalFees: 0,
    totalSlippage: 0,
    openPositions: 0,
    closedTrades: 0,
    winRate: 0,
  };
}

export async function getBistPaperTradingStatus(
  db: D1Database,
): Promise<BistPaperTradeStatus> {
  await ensureBistPaperTradingSchema(db);
  const [account, openRows, historyRows] = await Promise.all([
    db
      .prepare("SELECT * FROM bist_paper_account WHERE id = 1")
      .first<BistPaperAccountRow>(),
    db
      .prepare(
        `SELECT * FROM bist_paper_positions
         WHERE status = 'open'
         ORDER BY current_score DESC, opened_at DESC`,
      )
      .all<BistPaperPositionRow>(),
    db
      .prepare(
        `SELECT * FROM bist_paper_positions
         WHERE status = 'closed'
         ORDER BY closed_at DESC
         LIMIT 50`,
      )
      .all<BistPaperPositionRow>(),
  ]);
  if (!account) {
    return {
      configured: false,
      delayedMinutes: 15,
      account: null,
      metrics: emptyMetrics(),
      openPositions: [],
      history: [],
      generatedAt: Date.now(),
    };
  }
  const openPositions = openRows.results;
  const reservedCapital = openPositions.reduce(
    (total, position) => total + position.capital,
    0,
  );
  const unrealizedNetPnl = openPositions.reduce(
    (total, position) => total + position.net_pnl,
    0,
  );
  const equity =
    account.initial_balance +
    account.realized_net_pnl +
    unrealizedNetPnl;
  return {
    configured: true,
    delayedMinutes: 15,
    account,
    metrics: {
      equity,
      availableCash: account.cash_balance,
      reservedCapital,
      realizedNetPnl: account.realized_net_pnl,
      unrealizedNetPnl,
      totalNetPnl: equity - account.initial_balance,
      totalFees: account.total_fees,
      totalSlippage: account.total_slippage,
      openPositions: openPositions.length,
      closedTrades: account.trades_closed,
      winRate:
        account.trades_closed > 0
          ? (account.wins / account.trades_closed) * 100
          : 0,
    },
    openPositions,
    history: historyRows.results,
    generatedAt: Date.now(),
  };
}
