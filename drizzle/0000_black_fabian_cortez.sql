CREATE TABLE `scanner_alerts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`symbol` text NOT NULL,
	`interval` text NOT NULL,
	`direction` text NOT NULL,
	`final_score` integer NOT NULL,
	`quant_score` integer NOT NULL,
	`confidence` integer NOT NULL,
	`price` real NOT NULL,
	`sent_at` integer NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`subject` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `scanner_alerts_sent_idx` ON `scanner_alerts` (`sent_at`);--> statement-breakpoint
CREATE TABLE `scanner_config` (
	`id` integer PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`threshold` integer DEFAULT 60 NOT NULL,
	`minimum_confidence` integer DEFAULT 70 NOT NULL,
	`rearm_score` integer DEFAULT 45 NOT NULL,
	`cooldown_seconds` integer DEFAULT 14400 NOT NULL,
	`max_alerts_per_minute` integer DEFAULT 5 NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`last_heartbeat` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`scans_completed` integer DEFAULT 0 NOT NULL,
	`alerts_sent` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `scanner_intervals` (
	`interval` text PRIMARY KEY NOT NULL,
	`cadence_seconds` integer NOT NULL,
	`phase_seconds` integer NOT NULL,
	`last_started_at` integer DEFAULT 0 NOT NULL,
	`last_completed_at` integer DEFAULT 0 NOT NULL,
	`last_duration_ms` integer DEFAULT 0 NOT NULL,
	`last_scanned_count` integer DEFAULT 0 NOT NULL,
	`last_error` text
);
--> statement-breakpoint
CREATE TABLE `scanner_scores` (
	`symbol` text NOT NULL,
	`interval` text NOT NULL,
	`base_asset` text NOT NULL,
	`last_scanned_at` integer NOT NULL,
	`final_score` integer NOT NULL,
	`quant_score` integer NOT NULL,
	`context_score` integer,
	`confidence` integer NOT NULL,
	`direction` text NOT NULL,
	`price` real NOT NULL,
	`source` text NOT NULL,
	`armed` integer DEFAULT 1 NOT NULL,
	`last_alert_at` integer,
	`last_alert_direction` text,
	`last_email_attempt_at` integer,
	`error` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`symbol`, `interval`)
);
--> statement-breakpoint
CREATE INDEX `scanner_scores_rank_idx` ON `scanner_scores` (`source`,`final_score`,`confidence`);