ALTER TABLE `models` ADD `discovered_metadata` text;--> statement-breakpoint
ALTER TABLE `providers` ADD `adapter_id` text DEFAULT 'openai' NOT NULL;--> statement-breakpoint
ALTER TABLE `providers` ADD `health_check_url` text;--> statement-breakpoint
ALTER TABLE `providers` DROP COLUMN `type`;