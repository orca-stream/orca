CREATE TABLE `episodes` (
	`id` text PRIMARY KEY NOT NULL,
	`series_id` text NOT NULL,
	`season` integer NOT NULL,
	`episode` integer NOT NULL,
	`title` text NOT NULL,
	`plot` text,
	`air_date` text,
	`inferred` integer DEFAULT false NOT NULL,
	`source_ref` text NOT NULL,
	`source` text NOT NULL,
	`duration_sec` real,
	`size_bytes` integer,
	`format` text,
	`status` text DEFAULT 'missing' NOT NULL,
	`file_path` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `episodes_number` ON `episodes` (`series_id`,`season`,`episode`);--> statement-breakpoint
CREATE UNIQUE INDEX `episodes_source_ref` ON `episodes` (`series_id`,`source_ref`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`payload` text NOT NULL,
	`series_id` text,
	`episode_id` text,
	`resource` text NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 5 NOT NULL,
	`run_after` integer NOT NULL,
	`lease_owner` text,
	`lease_expires_at` integer,
	`progress` real,
	`progress_detail` text,
	`last_error` text,
	`error_kind` text,
	`dedupe_key` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `jobs_ready` ON `jobs` (`status`,`run_after`,`priority`);--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_dedupe` ON `jobs` (`dedupe_key`) WHERE "jobs"."status" in ('queued', 'running');--> statement-breakpoint
CREATE TABLE `series` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`year` integer,
	`plot` text,
	`extractor_id` text NOT NULL,
	`external_id` text NOT NULL,
	`source_url` text NOT NULL,
	`folder_name` text NOT NULL,
	`has_poster` integer DEFAULT false NOT NULL,
	`follow` integer DEFAULT false NOT NULL,
	`check_interval_hours` integer DEFAULT 12 NOT NULL,
	`last_checked_at` integer,
	`last_remote_marker` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `series_external` ON `series` (`extractor_id`,`external_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `series_folder` ON `series` (`folder_name`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`user_name` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`checked_at` integer NOT NULL
);
