ALTER TABLE `series` ADD `has_backdrop` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `series` ADD `has_logo` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `series` ADD `artwork_version` integer DEFAULT 0 NOT NULL;