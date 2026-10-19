CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`series_id` text,
	`job_id` text,
	`data` text NOT NULL,
	`created_at` integer NOT NULL,
	`read_at` integer,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `notifications_recent` ON `notifications` (`created_at`);