import { analyzeMarket, type AnalysisResult, type MarketPayload } from "./analysis";
import {
  fetchBinanceLiveCandles,
  fetchTopBinanceSymbols,
  type MarketSymbol,
} from "./binance";
import { blendDecisionScores, decisionContextScore } from "./decision";
import {
  fetchMarketContext,
  type MarketContextPayload,
} from "./market-context";
import { sendGmailMessage } from "./smtp";
import {
  ensurePaperTradingSchema,
  getPaperTradingStatus,
  runPaperTradingCycle,
} from "./paper-trading";
import {
  getBinanceDemoFuturesMirrorStatus,
  runBinanceDemoFuturesMirrorCycle,
  type BinanceDemoFuturesEnv,
} from "./binance-demo-futures";

export const SCANNER_INTERVALS = [
  { interval: "5m", cadenceSeconds: 15, phaseSeconds: 0, horizon: "çok kısa vadede" },
  { interval: "15m", cadenceSeconds: 45, phaseSeconds: 15, horizon: "kısa vadede" },
  { interval: "1h", cadenceSeconds: 120, phaseSeconds: 30, horizon: "kısa/orta vadede" },
  { interval: "4h", cadenceSeconds: 300, phaseSeconds: 45, horizon: "orta vadede" },
  { interval: "1d", cadenceSeconds: 900, phaseSeconds: 60, horizon: "uzun vadede" },
  { interval: "1w", cadenceSeconds: 3_600, phaseSeconds: 120, horizon: "makro vadede" },
] as const;
export const EC2_SCANNER_CONCURRENCY = 12;

export type ScannerEnv = BinanceDemoFuturesEnv & {
  DB?: D1Database;
  SCANNER_TRIGGER_KEY?: string;
  SCANNER_SINGLE_TICK?: string;
  FASTACT_EMAIL_SENDER?: string;
  FASTACT_EMAIL_APP_PASSWORD?: string;
  FASTACT_EMAIL_RECIPIENT?: string;
};

type ScannerConfig = {
  enabled: number;
  threshold: number;
  minimum_confidence: number;
  rearm_score: number;
  cooldown_seconds: number;
  max_alerts_per_minute: number;
};

type IntervalState = {
  interval: string;
  cadence_seconds: number;
  phase_seconds: number;
  last_started_at: number;
};

type PreviousScore = {
  symbol: string;
  interval: string;
  armed: number;
  last_alert_at: number | null;
  last_alert_direction: string | null;
  last_email_attempt_at: number | null;
};

type ScanResult = {
  symbol: string;
  baseAsset: string;
  interval: string;
  analysis: AnalysisResult | null;
  quantScore: number;
  contextScore: number | null;
  finalScore: number;
  confidence: number;
  direction: "long" | "short" | "neutral" | "unavailable";
  price: number;
  source: "binance" | "demo";
  reasons: string[];
  armed: boolean;
  candidate: boolean;
  error: string | null;
};

const CREATE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS scanner_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    enabled INTEGER NOT NULL DEFAULT 1,
    threshold INTEGER NOT NULL DEFAULT 55,
    minimum_confidence INTEGER NOT NULL DEFAULT 70,
    rearm_score INTEGER NOT NULL DEFAULT 45,
    cooldown_seconds INTEGER NOT NULL DEFAULT 14400,
    max_alerts_per_minute INTEGER NOT NULL DEFAULT 5,
    lease_until INTEGER NOT NULL DEFAULT 0,
    last_heartbeat INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    scans_completed INTEGER NOT NULL DEFAULT 0,
    alerts_sent INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS scanner_intervals (
    interval TEXT PRIMARY KEY,
    cadence_seconds INTEGER NOT NULL,
    phase_seconds INTEGER NOT NULL,
    last_started_at INTEGER NOT NULL DEFAULT 0,
    last_completed_at INTEGER NOT NULL DEFAULT 0,
    last_duration_ms INTEGER NOT NULL DEFAULT 0,
    last_scanned_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS scanner_scores (
    symbol TEXT NOT NULL,
    interval TEXT NOT NULL,
    base_asset TEXT NOT NULL,
    last_scanned_at INTEGER NOT NULL,
    final_score INTEGER NOT NULL,
    quant_score INTEGER NOT NULL,
    context_score INTEGER,
    confidence INTEGER NOT NULL,
    direction TEXT NOT NULL,
    price REAL NOT NULL,
    source TEXT NOT NULL,
    armed INTEGER NOT NULL DEFAULT 1,
    last_alert_at INTEGER,
    last_alert_direction TEXT,
    last_email_attempt_at INTEGER,
    error TEXT,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (symbol, interval)
  )`,
  `CREATE INDEX IF NOT EXISTS scanner_scores_rank_idx
    ON scanner_scores (source, final_score, confidence)`,
  `CREATE TABLE IF NOT EXISTS scanner_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    interval TEXT NOT NULL,
    direction TEXT NOT NULL,
    final_score INTEGER NOT NULL,
    quant_score INTEGER NOT NULL,
    confidence INTEGER NOT NULL,
    price REAL NOT NULL,
    sent_at INTEGER NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    subject TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS scanner_alerts_sent_idx
    ON scanner_alerts (sent_at DESC)`,
];

const INSERT_CONFIG = `INSERT OR IGNORE INTO scanner_config
  (id, enabled, threshold, minimum_confidence, rearm_score, cooldown_seconds,
   max_alerts_per_minute, updated_at)
  VALUES (1, 1, 55, 70, 45, 14400, 5, ?)`;

const UPSERT_INTERVAL = `INSERT INTO scanner_intervals
  (interval, cadence_seconds, phase_seconds)
  VALUES (?, ?, ?)
  ON CONFLICT(interval) DO UPDATE SET
    cadence_seconds = excluded.cadence_seconds,
    phase_seconds = excluded.phase_seconds`;

let scannerSchemaReady = false;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : 0));
}

function htmlEscape(value: unknown) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ] ?? character,
  );
}

function formatPrice(value: number) {
  const digits = value < 0.01 ? 8 : value < 1 ? 5 : 2;
  return new Intl.NumberFormat("tr-TR", {
    maximumFractionDigits: digits,
    minimumFractionDigits: Math.min(2, digits),
  }).format(value);
}

function signed(value: number) {
  return `${value > 0 ? "+" : ""}${value}`;
}

function intervalDetails(interval: string) {
  return SCANNER_INTERVALS.find((item) => item.interval === interval);
}

function emailConfigured(env: ScannerEnv) {
  return Boolean(
    env.FASTACT_EMAIL_SENDER &&
      env.FASTACT_EMAIL_APP_PASSWORD &&
      env.FASTACT_EMAIL_RECIPIENT,
  );
}

async function runBatches(
  db: D1Database,
  statements: D1PreparedStatement[],
  size = 50,
) {
  for (let index = 0; index < statements.length; index += size) {
    await db.batch(statements.slice(index, index + size));
  }
}

export async function ensureScannerSchema(db: D1Database) {
  if (scannerSchemaReady) return;
  await runBatches(
    db,
    CREATE_STATEMENTS.map((statement) => db.prepare(statement)),
  );
  const now = Date.now();
  await db.batch([
    db.prepare(INSERT_CONFIG).bind(now),
    ...SCANNER_INTERVALS.map((item) =>
      db
        .prepare(UPSERT_INTERVAL)
        .bind(item.interval, item.cadenceSeconds, item.phaseSeconds),
    ),
  ]);
  await ensurePaperTradingSchema(db);
  scannerSchemaReady = true;
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  worker: (value: T) => Promise<R>,
) {
  const results = new Array<R>(values.length);
  let cursor = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (cursor < values.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await worker(values[index]);
      }
    },
  );
  await Promise.all(runners);
  return results;
}

function buildMarketPayload(
  symbol: MarketSymbol,
  interval: string,
  candles: MarketPayload["candles"],
): MarketPayload {
  const last = candles.at(-1);
  const highPrice = candles.reduce(
    (highest, candle) => Math.max(highest, candle.high),
    last?.high ?? symbol.lastPrice,
  );
  const lowPrice = candles.reduce(
    (lowest, candle) => Math.min(lowest, candle.low),
    last?.low ?? symbol.lastPrice,
  );
  return {
    symbol: symbol.symbol,
    interval,
    candles,
    ticker: {
      lastPrice: last?.close ?? symbol.lastPrice,
      priceChange: 0,
      priceChangePercent: symbol.priceChangePercent,
      highPrice,
      lowPrice,
      quoteVolume: symbol.quoteVolume,
    },
    book: { bids: [], asks: [] },
    fetchedAt: Date.now(),
    source: "binance",
  };
}

function scoreKey(symbol: string, interval: string) {
  return `${symbol}:${interval}`;
}

function isIntervalDue(state: IntervalState, now: number) {
  const slotSeconds = Math.floor(now / 15_000) * 15;
  const normalized =
    ((slotSeconds - state.phase_seconds) % state.cadence_seconds +
      state.cadence_seconds) %
    state.cadence_seconds;
  return normalized === 0 && state.last_started_at < slotSeconds * 1_000;
}

async function loadDueIntervals(db: D1Database, now: number) {
  const rows = await db
    .prepare(
      `SELECT interval, cadence_seconds, phase_seconds, last_started_at
       FROM scanner_intervals`,
    )
    .all<IntervalState>();
  return rows.results.filter((row) => isIntervalDue(row, now));
}

async function loadPreviousScores(
  db: D1Database,
  intervals: string[],
) {
  if (!intervals.length) return new Map<string, PreviousScore>();
  const placeholders = intervals.map(() => "?").join(",");
  const rows = await db
    .prepare(
      `SELECT symbol, interval, armed, last_alert_at, last_alert_direction,
              last_email_attempt_at
       FROM scanner_scores
       WHERE interval IN (${placeholders})`,
    )
    .bind(...intervals)
    .all<PreviousScore>();
  return new Map(
    rows.results.map((row) => [scoreKey(row.symbol, row.interval), row]),
  );
}

function evaluateCandidate(
  result: Omit<ScanResult, "armed" | "candidate">,
  previous: PreviousScore | undefined,
  config: ScannerConfig,
  now: number,
) {
  const absoluteScore = Math.abs(result.finalScore);
  const direction = result.direction;
  const strong =
    result.source === "binance" &&
    (direction === "long" || direction === "short") &&
    absoluteScore >= config.threshold &&
    result.confidence >= config.minimum_confidence;
  let armed = previous?.armed !== 0;
  if (absoluteScore <= config.rearm_score) armed = true;

  const lastAlertAt = previous?.last_alert_at ?? 0;
  const lastAttemptAt = previous?.last_email_attempt_at ?? 0;
  const directionChanged =
    Boolean(previous?.last_alert_direction) &&
    previous?.last_alert_direction !== direction;
  const cooldownReady =
    !lastAlertAt || now - lastAlertAt >= config.cooldown_seconds * 1_000;
  const retryReady = !lastAttemptAt || now - lastAttemptAt >= 5 * 60_000;
  return {
    armed,
    candidate:
      strong && armed && retryReady && (cooldownReady || directionChanged),
  };
}

async function scanSymbolInterval(
  symbol: MarketSymbol,
  interval: string,
  context: MarketContextPayload,
  previous: PreviousScore | undefined,
  config: ScannerConfig,
  now: number,
): Promise<ScanResult> {
  const candleResult = await fetchBinanceLiveCandles(symbol.symbol, interval, 260);
  if (candleResult.source !== "binance") {
    const unavailable = {
      symbol: symbol.symbol,
      baseAsset: symbol.baseAsset,
      interval,
      analysis: null,
      quantScore: 0,
      contextScore: null,
      finalScore: 0,
      confidence: 0,
      direction: "unavailable" as const,
      price: symbol.lastPrice,
      source: "demo" as const,
      reasons: [],
      error: "Canlı Binance mum verisi alınamadı.",
    };
    return {
      ...unavailable,
      ...evaluateCandidate(unavailable, previous, config, now),
    };
  }

  try {
    const analysis = analyzeMarket(
      buildMarketPayload(symbol, interval, candleResult.candles),
    );
    const contextScore = decisionContextScore(context, symbol.symbol);
    const finalScore = clamp(
      blendDecisionScores(analysis.quantScore, contextScore, null),
      -100,
      100,
    );
    const direction: ScanResult["direction"] =
      finalScore >= 20 ? "long" : finalScore <= -20 ? "short" : "neutral";
    const scored = {
      symbol: symbol.symbol,
      baseAsset: symbol.baseAsset,
      interval,
      analysis,
      quantScore: analysis.quantScore,
      contextScore,
      finalScore,
      confidence: analysis.confidence,
      direction,
      price: analysis.price,
      source: "binance" as const,
      reasons: analysis.reasons.slice(0, 3),
      error: null,
    };
    return {
      ...scored,
      ...evaluateCandidate(scored, previous, config, now),
    };
  } catch {
    const invalid = {
      symbol: symbol.symbol,
      baseAsset: symbol.baseAsset,
      interval,
      analysis: null,
      quantScore: 0,
      contextScore: null,
      finalScore: 0,
      confidence: 0,
      direction: "unavailable" as const,
      price: symbol.lastPrice,
      source: "demo" as const,
      reasons: [],
      error: "Teknik analiz hesaplanamadı.",
    };
    return {
      ...invalid,
      ...evaluateCandidate(invalid, previous, config, now),
    };
  }
}

function scoreUpsert(db: D1Database, result: ScanResult, now: number) {
  return db
    .prepare(
      `INSERT INTO scanner_scores
       (symbol, interval, base_asset, last_scanned_at, final_score, quant_score,
        context_score, confidence, direction, price, source, armed, error,
        updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(symbol, interval) DO UPDATE SET
         base_asset = excluded.base_asset,
         last_scanned_at = excluded.last_scanned_at,
         final_score = excluded.final_score,
         quant_score = excluded.quant_score,
         context_score = excluded.context_score,
         confidence = excluded.confidence,
         direction = excluded.direction,
         price = excluded.price,
         source = excluded.source,
         armed = excluded.armed,
         error = excluded.error,
         updated_at = excluded.updated_at`,
    )
    .bind(
      result.symbol,
      result.interval,
      result.baseAsset,
      now,
      result.finalScore,
      result.quantScore,
      result.contextScore,
      result.confidence,
      result.direction,
      result.price,
      result.source,
      result.armed ? 1 : 0,
      result.error,
      now,
    );
}

function makeSignalEmail(result: ScanResult) {
  const timeframe = intervalDetails(result.interval);
  const side = result.direction === "long" ? "LONG" : "SHORT";
  const sideTr = result.direction === "long" ? "long" : "short";
  const horizon = timeframe?.horizon ?? `${result.interval} zaman diliminde`;
  const subject = `[${side} FIRSATI] ${result.baseAsset} ${horizon} · ${signed(result.finalScore)}`;
  const opening = `${result.baseAsset}'de ${horizon} ${sideTr} fırsatı yüksek. QuantScope puanı ${signed(result.finalScore)}/100, güven %${result.confidence}.`;
  const facts = [
    `Parite: ${result.symbol}`,
    `Zaman dilimi: ${result.interval}`,
    `Fiyat: ${formatPrice(result.price)} USDT`,
    `Teknik skor: ${signed(result.quantScore)}`,
    `Global bağlam: ${result.contextScore === null ? "veri yok" : signed(result.contextScore)}`,
  ];
  const reasons = result.reasons.length
    ? result.reasons.map((reason) => `- ${reason}`)
    : ["- Teknik göstergelerin ağırlıklı birleşimi eşiği aştı."];
  const text = [
    opening,
    "",
    ...facts,
    "",
    "Başlıca gerekçeler:",
    ...reasons,
    "",
    "Bu otomatik bir piyasa sinyalidir; yatırım tavsiyesi değildir.",
  ].join("\n");
  const htmlFacts = facts.map((fact) => `<li>${htmlEscape(fact)}</li>`).join("");
  const htmlReasons = result.reasons.length
    ? result.reasons
        .map((reason) => `<li>${htmlEscape(reason)}</li>`)
        .join("")
    : "<li>Teknik göstergelerin ağırlıklı birleşimi eşiği aştı.</li>";
  const html =
    `<h2 style="margin:0 0 12px">${htmlEscape(opening)}</h2>` +
    `<ul>${htmlFacts}</ul>` +
    `<h3>Başlıca gerekçeler</h3><ul>${htmlReasons}</ul>` +
    '<p style="color:#64748b">Bu otomatik bir piyasa sinyalidir; yatırım tavsiyesi değildir.</p>';
  return { subject, text, html };
}

async function recordAlertAttempt(
  db: D1Database,
  result: ScanResult,
  subject: string,
  status: "sent" | "failed",
  error: string | null,
  now: number,
  threshold: number,
) {
  await db.batch([
    db
      .prepare(
        `INSERT INTO scanner_alerts
         (symbol, interval, direction, final_score, quant_score, confidence,
          price, sent_at, status, error, subject)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        result.symbol,
        result.interval,
        result.direction,
        result.finalScore,
        result.quantScore,
        result.confidence,
        result.price,
        now,
        status,
        error,
        subject,
      ),
    db
      .prepare(
        `UPDATE scanner_scores
         SET last_email_attempt_at = ?,
             last_alert_at = CASE WHEN ? = 'sent' THEN ? ELSE last_alert_at END,
             last_alert_direction = CASE WHEN ? = 'sent' THEN ? ELSE last_alert_direction END,
             armed = CASE WHEN ? = 'sent' THEN 0 ELSE armed END
         WHERE symbol = ? AND interval = ?`,
      )
      .bind(
        now,
        status,
        now,
        status,
        result.direction,
        status,
        result.symbol,
        result.interval,
      ),
  ]);
  if (status === "sent") {
    await db.batch([
      db
        .prepare(
          `UPDATE scanner_scores
           SET armed = 0, last_alert_at = ?, last_alert_direction = ?
           WHERE symbol = ? AND direction = ? AND ABS(final_score) >= ?`,
        )
        .bind(now, result.direction, result.symbol, result.direction, threshold),
      db
        .prepare(
          `UPDATE scanner_config
           SET alerts_sent = alerts_sent + 1, updated_at = ?
           WHERE id = 1`,
        )
        .bind(now),
    ]);
  }
}

async function sendCandidates(
  db: D1Database,
  env: ScannerEnv,
  candidates: ScanResult[],
  config: ScannerConfig,
  now: number,
) {
  if (!candidates.length) return;
  if (!emailConfigured(env)) {
    await db
      .prepare(
        `UPDATE scanner_config
         SET last_error = ?, updated_at = ?
         WHERE id = 1`,
      )
      .bind("Güçlü sinyal bulundu fakat e-posta yapılandırması eksik.", now)
      .run();
    return;
  }

  const recent = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM scanner_alerts
       WHERE sent_at >= ?`,
    )
    .bind(now - 60_000)
    .first<{ count: number }>();
  let capacity = Math.max(
    0,
    config.max_alerts_per_minute - Number(recent?.count ?? 0),
  );
  if (!capacity) return;

  const strongestBySymbol = new Map<string, ScanResult>();
  for (const result of [...candidates].sort(
    (left, right) => Math.abs(right.finalScore) - Math.abs(left.finalScore),
  )) {
    if (!strongestBySymbol.has(result.symbol)) {
      strongestBySymbol.set(result.symbol, result);
    }
  }

  for (const result of strongestBySymbol.values()) {
    if (capacity <= 0) break;
    capacity -= 1;
    const content = makeSignalEmail(result);
    try {
      await sendGmailMessage({
        sender: String(env.FASTACT_EMAIL_SENDER),
        appPassword: String(env.FASTACT_EMAIL_APP_PASSWORD),
        recipient: String(env.FASTACT_EMAIL_RECIPIENT),
        ...content,
      });
      await recordAlertAttempt(
        db,
        result,
        content.subject,
        "sent",
        null,
        now,
        config.threshold,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message.slice(0, 300) : "SMTP gönderimi başarısız.";
      await recordAlertAttempt(
        db,
        result,
        content.subject,
        "failed",
        message,
        now,
        config.threshold,
      );
    }
  }
}

async function scanDueIntervals(
  db: D1Database,
  env: ScannerEnv,
  symbols: MarketSymbol[],
  context: MarketContextPayload,
  config: ScannerConfig,
  due: IntervalState[],
  now: number,
) {
  const intervals = due.map((item) => item.interval);
  await runBatches(
    db,
    due.map((item) =>
      db
        .prepare(
          `UPDATE scanner_intervals
           SET last_started_at = ?, last_error = NULL
           WHERE interval = ?`,
        )
        .bind(now, item.interval),
    ),
  );
  const previous = await loadPreviousScores(db, intervals);
  const tasks = due.flatMap((item) =>
    symbols.map((symbol) => ({ symbol, interval: item.interval })),
  );
  const started = Date.now();
  const singleTick = ["1", "true", "yes", "on"].includes(
    String(env.SCANNER_SINGLE_TICK ?? "").trim().toLowerCase(),
  );
  const results = await mapWithConcurrency(
    tasks,
    singleTick ? EC2_SCANNER_CONCURRENCY : 6,
    async (task) =>
    await scanSymbolInterval(
      task.symbol,
      task.interval,
      context,
      previous.get(scoreKey(task.symbol.symbol, task.interval)),
      config,
      now,
    ),
  );
  await runBatches(
    db,
    results.map((result) => scoreUpsert(db, result, now)),
  );

  const duration = Date.now() - started;
  await runBatches(
    db,
    due.map((item) => {
      const intervalResults = results.filter(
        (result) => result.interval === item.interval,
      );
      const liveCount = intervalResults.filter(
        (result) => result.source === "binance",
      ).length;
      const error =
        liveCount === intervalResults.length
          ? null
          : `${intervalResults.length - liveCount} parite canlı veriden hesaplanamadı.`;
      return db
        .prepare(
          `UPDATE scanner_intervals
           SET last_completed_at = ?, last_duration_ms = ?,
               last_scanned_count = ?, last_error = ?
           WHERE interval = ?`,
        )
        .bind(Date.now(), duration, liveCount, error, item.interval);
    }),
  );
  await db
    .prepare(
      `UPDATE scanner_config
       SET scans_completed = scans_completed + ?, last_heartbeat = ?,
           last_error = NULL, updated_at = ?
       WHERE id = 1`,
    )
    .bind(results.length, Date.now(), Date.now())
    .run();
  await sendCandidates(
    db,
    env,
    results.filter((result) => result.candidate),
    config,
    Date.now(),
  );
}

async function acquireLease(db: D1Database, now: number) {
  const result = await db
    .prepare(
      `UPDATE scanner_config
       SET lease_until = ?, last_heartbeat = ?, updated_at = ?
       WHERE id = 1 AND enabled = 1 AND lease_until < ?`,
    )
    .bind(now + 5 * 60_000, now, now, now)
    .run();
  return Number(result.meta.changes ?? 0) > 0;
}

export async function runScheduledScannerMinute(
  env: ScannerEnv,
  scheduledTime: number,
  wait: (delayMs: number) => Promise<void>,
) {
  const db = env.DB;
  if (!db) return { skipped: true, reason: "database-not-configured" };
  await ensureScannerSchema(db);
  const now = Date.now();
  if (!(await acquireLease(db, now))) {
    return { skipped: true, reason: "lease-or-disabled" };
  }

  try {
    const [directory, context] = await Promise.all([
      fetchTopBinanceSymbols(50),
      fetchMarketContext(),
    ]);
    if (directory.source !== "binance" || directory.symbols.length < 50) {
      throw new Error("Canlı ilk 50 Binance coin listesi alınamadı.");
    }
    const config = await db
      .prepare(
        `SELECT enabled, threshold, minimum_confidence, rearm_score,
                cooldown_seconds, max_alerts_per_minute
         FROM scanner_config
         WHERE id = 1`,
      )
      .first<ScannerConfig>();
    if (!config?.enabled) {
      return { skipped: true, reason: "disabled" };
    }

    const singleTick = ["1", "true", "yes", "on"].includes(
      String(env.SCANNER_SINGLE_TICK ?? "").trim().toLowerCase(),
    );
    for (const offsetSeconds of singleTick ? [0] : [0, 15, 30, 45]) {
      const delay = scheduledTime + offsetSeconds * 1_000 - Date.now();
      if (delay > 0) await wait(delay);
      const tickTime = Date.now();
      const due = await loadDueIntervals(db, tickTime);
      if (due.length) {
        await scanDueIntervals(
          db,
          env,
          directory.symbols,
          context,
          config,
          due,
          tickTime,
        );
      }
      try {
        await runPaperTradingCycle(db, Date.now());
        await runBinanceDemoFuturesMirrorCycle(db, env, Date.now());
      } catch (error) {
        console.error("Paper/demo Futures cycle failed", error);
      }
      await db
        .prepare(
          `UPDATE scanner_config
           SET lease_until = ?, last_heartbeat = ?, updated_at = ?
           WHERE id = 1`,
        )
        .bind(Date.now() + 25_000, Date.now(), Date.now())
        .run();
    }
    return { skipped: false };
  } catch (error) {
    try {
      await runPaperTradingCycle(db, Date.now());
      await runBinanceDemoFuturesMirrorCycle(db, env, Date.now());
    } catch (paperError) {
      console.error("Paper/demo Futures fallback cycle failed", paperError);
    }
    const message =
      error instanceof Error ? error.message.slice(0, 500) : "Tarama görevi başarısız.";
    await db
      .prepare(
        `UPDATE scanner_config
         SET last_error = ?, last_heartbeat = ?, updated_at = ?
         WHERE id = 1`,
      )
      .bind(message, Date.now(), Date.now())
      .run();
    throw error;
  } finally {
    await db
      .prepare(
        `UPDATE scanner_config
         SET lease_until = 0, updated_at = ?
         WHERE id = 1`,
      )
      .bind(Date.now())
      .run();
  }
}

export async function getScannerStatus(db: D1Database) {
  await ensureScannerSchema(db);
  const [config, intervals, leaders, alerts, paper, demoFutures] = await Promise.all([
    db.prepare(`SELECT * FROM scanner_config WHERE id = 1`).first(),
    db
      .prepare(
        `SELECT interval, cadence_seconds, last_started_at, last_completed_at,
                last_duration_ms, last_scanned_count, last_error
         FROM scanner_intervals
         ORDER BY cadence_seconds ASC`,
      )
      .all(),
    db
      .prepare(
        `SELECT symbol, base_asset, interval, final_score, quant_score,
                context_score, confidence, direction, price, last_scanned_at
         FROM scanner_scores
         WHERE source = 'binance' AND last_scanned_at >= ?
         ORDER BY ABS(final_score) DESC, confidence DESC
         LIMIT 20`,
      )
      .bind(Date.now() - 2 * 60 * 60_000)
      .all(),
    db
      .prepare(
        `SELECT symbol, interval, direction, final_score, confidence,
                price, sent_at, status, subject
         FROM scanner_alerts
         ORDER BY sent_at DESC
         LIMIT 20`,
      )
      .all(),
    getPaperTradingStatus(db),
    getBinanceDemoFuturesMirrorStatus(db),
  ]);
  return {
    configured: true,
    config,
    intervals: intervals.results,
    leaders: leaders.results,
    alerts: alerts.results,
    paper,
    demoFutures,
    generatedAt: Date.now(),
  };
}
