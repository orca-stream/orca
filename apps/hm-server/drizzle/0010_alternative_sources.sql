ALTER TABLE `episodes` ADD `file_source_id` text;--> statement-breakpoint
ALTER TABLE `series` ADD `preferred_sources` text DEFAULT '{}' NOT NULL;