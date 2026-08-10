CREATE TABLE `catalog_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`site` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`message` text DEFAULT 'Tarama sırasına eklendi.' NOT NULL,
	`error` text,
	`object_key` text,
	`filename` text,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_catalog_jobs_owner_created` ON `catalog_jobs` (`owner_email`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_catalog_jobs_status_created` ON `catalog_jobs` (`status`,`created_at`);