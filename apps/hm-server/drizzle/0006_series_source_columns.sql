DROP INDEX `series_external`;--> statement-breakpoint
ALTER TABLE `series` DROP COLUMN `extractor_id`;--> statement-breakpoint
ALTER TABLE `series` DROP COLUMN `external_id`;--> statement-breakpoint
ALTER TABLE `series` DROP COLUMN `source_url`;--> statement-breakpoint
ALTER TABLE `series` DROP COLUMN `last_remote_marker`;--> statement-breakpoint
ALTER TABLE `series` DROP COLUMN `known_refs`;