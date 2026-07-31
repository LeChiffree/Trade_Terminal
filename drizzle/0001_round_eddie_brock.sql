PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_scanner_config` (
	`id` integer PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`threshold` integer DEFAULT 55 NOT NULL,
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
INSERT INTO `__new_scanner_config`("id", "enabled", "threshold", "minimum_confidence", "rearm_score", "cooldown_seconds", "max_alerts_per_minute", "lease_until", "last_heartbeat", "last_error", "scans_completed", "alerts_sent", "updated_at") SELECT "id", "enabled", "threshold", "minimum_confidence", "rearm_score", "cooldown_seconds", "max_alerts_per_minute", "lease_until", "last_heartbeat", "last_error", "scans_completed", "alerts_sent", "updated_at" FROM `scanner_config`;--> statement-breakpoint
DROP TABLE `scanner_config`;--> statement-breakpoint
ALTER TABLE `__new_scanner_config` RENAME TO `scanner_config`;--> statement-breakpoint
PRAGMA foreign_keys=ON;