PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_models` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`provider_id` text NOT NULL,
	`upstream_model_id` text NOT NULL,
	`type` text DEFAULT 'chat' NOT NULL,
	`default_params` text DEFAULT '{}',
	`context_window` integer,
	`max_tokens` integer,
	`output_dimension` integer,
	`pricing` text,
	`description` text,
	`knowledge_date` text,
	`timeout` integer DEFAULT 3600 NOT NULL,
	`max_retries` integer DEFAULT 2 NOT NULL,
	`http_proxy` text,
	`enabled` integer DEFAULT true NOT NULL,
	`api_variant_id` text,
	`discovered_metadata` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_models`("id", "name", "provider_id", "upstream_model_id", "type", "default_params", "context_window", "max_tokens", "output_dimension", "pricing", "description", "knowledge_date", "timeout", "max_retries", "http_proxy", "enabled", "api_variant_id", "discovered_metadata", "created_at", "updated_at") SELECT "id", "name", "provider_id", "upstream_model_id", "type", "default_params", "context_window", "max_tokens", "output_dimension", "pricing", "description", "knowledge_date", "timeout", "max_retries", "http_proxy", "enabled", "api_variant_id", "discovered_metadata", "created_at", "updated_at" FROM `models`;--> statement-breakpoint
DROP TABLE `models`;--> statement-breakpoint
ALTER TABLE `__new_models` RENAME TO `models`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `models_name_unique` ON `models` (`name`);--> statement-breakpoint
CREATE INDEX `models_provider_idx` ON `models` (`provider_id`);--> statement-breakpoint
CREATE INDEX `models_type_idx` ON `models` (`type`);--> statement-breakpoint
-- Upgrade rows still on the old 60s default to match the new 3600s default.
-- Rows with any other explicitly-set timeout are left alone so admins who
-- chose a non-default value keep their choice.
UPDATE `models` SET `timeout` = 3600 WHERE `timeout` = 60;