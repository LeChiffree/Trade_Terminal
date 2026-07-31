import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const scannerConfig = sqliteTable("scanner_config", {
  id: integer("id").primaryKey(),
  enabled: integer("enabled").notNull().default(1),
  threshold: integer("threshold").notNull().default(55),
  minimumConfidence: integer("minimum_confidence").notNull().default(70),
  rearmScore: integer("rearm_score").notNull().default(45),
  cooldownSeconds: integer("cooldown_seconds").notNull().default(14_400),
  maxAlertsPerMinute: integer("max_alerts_per_minute").notNull().default(5),
  leaseUntil: integer("lease_until").notNull().default(0),
  lastHeartbeat: integer("last_heartbeat").notNull().default(0),
  lastError: text("last_error"),
  scansCompleted: integer("scans_completed").notNull().default(0),
  alertsSent: integer("alerts_sent").notNull().default(0),
  updatedAt: integer("updated_at").notNull().default(0),
});

export const scannerIntervals = sqliteTable("scanner_intervals", {
  interval: text("interval").primaryKey(),
  cadenceSeconds: integer("cadence_seconds").notNull(),
  phaseSeconds: integer("phase_seconds").notNull(),
  lastStartedAt: integer("last_started_at").notNull().default(0),
  lastCompletedAt: integer("last_completed_at").notNull().default(0),
  lastDurationMs: integer("last_duration_ms").notNull().default(0),
  lastScannedCount: integer("last_scanned_count").notNull().default(0),
  lastError: text("last_error"),
});

export const scannerScores = sqliteTable(
  "scanner_scores",
  {
    symbol: text("symbol").notNull(),
    interval: text("interval").notNull(),
    baseAsset: text("base_asset").notNull(),
    lastScannedAt: integer("last_scanned_at").notNull(),
    finalScore: integer("final_score").notNull(),
    quantScore: integer("quant_score").notNull(),
    contextScore: integer("context_score"),
    confidence: integer("confidence").notNull(),
    direction: text("direction").notNull(),
    price: real("price").notNull(),
    source: text("source").notNull(),
    armed: integer("armed").notNull().default(1),
    lastAlertAt: integer("last_alert_at"),
    lastAlertDirection: text("last_alert_direction"),
    lastEmailAttemptAt: integer("last_email_attempt_at"),
    error: text("error"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.symbol, table.interval] }),
    index("scanner_scores_rank_idx").on(
      table.source,
      table.finalScore,
      table.confidence,
    ),
  ],
);

export const scannerAlerts = sqliteTable(
  "scanner_alerts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    symbol: text("symbol").notNull(),
    interval: text("interval").notNull(),
    direction: text("direction").notNull(),
    finalScore: integer("final_score").notNull(),
    quantScore: integer("quant_score").notNull(),
    confidence: integer("confidence").notNull(),
    price: real("price").notNull(),
    sentAt: integer("sent_at").notNull(),
    status: text("status").notNull(),
    error: text("error"),
    subject: text("subject").notNull(),
  },
  (table) => [index("scanner_alerts_sent_idx").on(table.sentAt)],
);
