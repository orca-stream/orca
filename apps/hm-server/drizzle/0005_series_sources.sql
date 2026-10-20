CREATE TABLE `series_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`series_id` text NOT NULL,
	`extractor_id` text NOT NULL,
	`external_id` text NOT NULL,
	`source_url` text NOT NULL,
	`season` integer,
	`episode_offset` integer DEFAULT 0 NOT NULL,
	`remote_marker` text,
	`known_refs` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `series_sources_external` ON `series_sources` (`extractor_id`,`external_id`);--> statement-breakpoint
CREATE INDEX `series_sources_series` ON `series_sources` (`series_id`);--> statement-breakpoint
ALTER TABLE `episodes` ADD `source_id` text REFERENCES series_sources(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `series` ADD `tmdb_id` text;--> statement-breakpoint
ALTER TABLE `series` ADD `imdb_id` text;--> statement-breakpoint
-- Every series so far was read from one address: it becomes the series' first source, under the
-- series' own id, and every episode belongs to it. The columns it came from go in the next migration.
INSERT INTO `series_sources` (`id`, `series_id`, `extractor_id`, `external_id`, `source_url`, `season`, `episode_offset`, `remote_marker`, `known_refs`, `created_at`)
  SELECT `id`, `id`, `extractor_id`, `external_id`, `source_url`, NULL, 0, `last_remote_marker`, `known_refs`, `created_at` FROM `series`;--> statement-breakpoint
UPDATE `episodes` SET `source_id` = `series_id`;
