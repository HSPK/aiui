ALTER TABLE `models` ADD `schema_adapter_id` text;--> statement-breakpoint
ALTER TABLE `providers` ADD `last_health_status` text;--> statement-breakpoint
ALTER TABLE `providers` ADD `last_health_checked_at` text;--> statement-breakpoint
ALTER TABLE `providers` ADD `last_health_error` text;