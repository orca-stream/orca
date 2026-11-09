DROP INDEX `series_folder`;--> statement-breakpoint
ALTER TABLE `series` ADD `kind` text DEFAULT 'show' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `series_folder` ON `series` (`kind`,`folder_name`);