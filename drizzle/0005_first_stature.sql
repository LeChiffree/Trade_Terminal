CREATE TABLE `binance_demo_futures_mirrors` (
	`paper_position_id` integer PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`direction` text NOT NULL,
	`quantity` real DEFAULT 0 NOT NULL,
	`leverage` integer NOT NULL,
	`margin_usdt` real NOT NULL,
	`open_client_order_id` text NOT NULL,
	`close_client_order_id` text NOT NULL,
	`open_order_id` integer,
	`close_order_id` integer,
	`status` text DEFAULT 'pending-open' NOT NULL,
	`last_error` text,
	`opened_at` integer,
	`closed_at` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `binance_demo_futures_mirrors_open_client_order_id_unique` ON `binance_demo_futures_mirrors` (`open_client_order_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `binance_demo_futures_mirrors_close_client_order_id_unique` ON `binance_demo_futures_mirrors` (`close_client_order_id`);--> statement-breakpoint
CREATE INDEX `idx_binance_demo_mirrors_status` ON `binance_demo_futures_mirrors` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `binance_demo_futures_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`base_url` text DEFAULT '' NOT NULL,
	`margin_usdt` real DEFAULT 25 NOT NULL,
	`last_cycle_at` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`opens_succeeded` integer DEFAULT 0 NOT NULL,
	`closes_succeeded` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
PRAGMA optimize;
