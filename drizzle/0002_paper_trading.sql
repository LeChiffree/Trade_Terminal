CREATE TABLE `paper_account` (
	`id` integer PRIMARY KEY NOT NULL,
	`initial_balance` real DEFAULT 100000 NOT NULL,
	`cash_balance` real DEFAULT 100000 NOT NULL,
	`margin_per_trade` real DEFAULT 1000 NOT NULL,
	`leverage` integer DEFAULT 5 NOT NULL,
	`max_positions` integer DEFAULT 5 NOT NULL,
	`entry_score` integer DEFAULT 30 NOT NULL,
	`exit_score` integer DEFAULT 15 NOT NULL,
	`minimum_confidence` integer DEFAULT 70 NOT NULL,
	`taker_fee_rate` real DEFAULT 0.0005 NOT NULL,
	`slippage_rate` real DEFAULT 0.0002 NOT NULL,
	`maintenance_margin_rate` real DEFAULT 0.005 NOT NULL,
	`realized_net_pnl` real DEFAULT 0 NOT NULL,
	`total_fees` real DEFAULT 0 NOT NULL,
	`total_slippage` real DEFAULT 0 NOT NULL,
	`total_funding` real DEFAULT 0 NOT NULL,
	`trades_closed` integer DEFAULT 0 NOT NULL,
	`wins` integer DEFAULT 0 NOT NULL,
	`losses` integer DEFAULT 0 NOT NULL,
	`last_cycle_at` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `paper_positions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`symbol` text NOT NULL,
	`base_asset` text NOT NULL,
	`interval` text NOT NULL,
	`direction` text NOT NULL,
	`status` text NOT NULL,
	`entry_score` integer NOT NULL,
	`current_score` integer NOT NULL,
	`confidence` integer NOT NULL,
	`entry_price` real NOT NULL,
	`mark_price` real NOT NULL,
	`quantity` real NOT NULL,
	`margin` real NOT NULL,
	`leverage` integer NOT NULL,
	`notional` real NOT NULL,
	`funding_rate` real DEFAULT 0 NOT NULL,
	`next_funding_at` integer DEFAULT 0 NOT NULL,
	`funding_pnl` real DEFAULT 0 NOT NULL,
	`entry_fee` real DEFAULT 0 NOT NULL,
	`exit_fee` real DEFAULT 0 NOT NULL,
	`entry_slippage` real DEFAULT 0 NOT NULL,
	`exit_slippage` real DEFAULT 0 NOT NULL,
	`gross_pnl` real DEFAULT 0 NOT NULL,
	`net_pnl` real DEFAULT 0 NOT NULL,
	`liquidation_price` real NOT NULL,
	`opened_at` integer NOT NULL,
	`closed_at` integer,
	`close_reason` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `paper_positions_status_opened_idx` ON `paper_positions` (`status`,`opened_at`);
--> statement-breakpoint
PRAGMA optimize;
