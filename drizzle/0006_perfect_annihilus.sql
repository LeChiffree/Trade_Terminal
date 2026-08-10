PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_bist_paper_account` (
	`id` integer PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`initial_balance` real DEFAULT 100000 NOT NULL,
	`cash_balance` real DEFAULT 100000 NOT NULL,
	`capital_per_trade` real DEFAULT 1000 NOT NULL,
	`max_positions` integer DEFAULT 15 NOT NULL,
	`entry_score` integer DEFAULT 30 NOT NULL,
	`exit_score` integer DEFAULT 15 NOT NULL,
	`minimum_confidence` integer DEFAULT 70 NOT NULL,
	`commission_rate` real DEFAULT 0.0005 NOT NULL,
	`slippage_rate` real DEFAULT 0.0002 NOT NULL,
	`realized_net_pnl` real DEFAULT 0 NOT NULL,
	`total_fees` real DEFAULT 0 NOT NULL,
	`total_slippage` real DEFAULT 0 NOT NULL,
	`trades_closed` integer DEFAULT 0 NOT NULL,
	`wins` integer DEFAULT 0 NOT NULL,
	`losses` integer DEFAULT 0 NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`last_cycle_at` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`updated_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_bist_paper_account`("id", "enabled", "initial_balance", "cash_balance", "capital_per_trade", "max_positions", "entry_score", "exit_score", "minimum_confidence", "commission_rate", "slippage_rate", "realized_net_pnl", "total_fees", "total_slippage", "trades_closed", "wins", "losses", "lease_until", "last_cycle_at", "last_error", "updated_at") SELECT "id", "enabled", "initial_balance", "cash_balance", "capital_per_trade", "max_positions", "entry_score", "exit_score", "minimum_confidence", "commission_rate", "slippage_rate", "realized_net_pnl", "total_fees", "total_slippage", "trades_closed", "wins", "losses", "lease_until", "last_cycle_at", "last_error", "updated_at" FROM `bist_paper_account`;--> statement-breakpoint
DROP TABLE `bist_paper_account`;--> statement-breakpoint
ALTER TABLE `__new_bist_paper_account` RENAME TO `bist_paper_account`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_paper_account` (
	`id` integer PRIMARY KEY NOT NULL,
	`initial_balance` real DEFAULT 100000 NOT NULL,
	`cash_balance` real DEFAULT 100000 NOT NULL,
	`margin_per_trade` real DEFAULT 1000 NOT NULL,
	`leverage` integer DEFAULT 5 NOT NULL,
	`max_positions` integer DEFAULT 20 NOT NULL,
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
INSERT INTO `__new_paper_account`("id", "initial_balance", "cash_balance", "margin_per_trade", "leverage", "max_positions", "entry_score", "exit_score", "minimum_confidence", "taker_fee_rate", "slippage_rate", "maintenance_margin_rate", "realized_net_pnl", "total_fees", "total_slippage", "total_funding", "trades_closed", "wins", "losses", "last_cycle_at", "updated_at") SELECT "id", "initial_balance", "cash_balance", "margin_per_trade", "leverage", "max_positions", "entry_score", "exit_score", "minimum_confidence", "taker_fee_rate", "slippage_rate", "maintenance_margin_rate", "realized_net_pnl", "total_fees", "total_slippage", "total_funding", "trades_closed", "wins", "losses", "last_cycle_at", "updated_at" FROM `paper_account`;--> statement-breakpoint
DROP TABLE `paper_account`;--> statement-breakpoint
ALTER TABLE `__new_paper_account` RENAME TO `paper_account`;