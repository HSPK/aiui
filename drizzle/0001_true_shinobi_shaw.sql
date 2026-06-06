ALTER TABLE `providers` ADD `type` text DEFAULT 'openai' NOT NULL;--> statement-breakpoint
ALTER TABLE `providers` ADD `api_version` text;