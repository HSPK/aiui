PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`prefix` text NOT NULL,
	`key_hash` text NOT NULL,
	`last_used_at` text,
	`expires_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_api_keys`("id", "user_id", "name", "prefix", "key_hash", "last_used_at", "expires_at", "created_at") SELECT "id", "user_id", "name", "prefix", "key_hash", "last_used_at", "expires_at", "created_at" FROM `api_keys`;--> statement-breakpoint
DROP TABLE `api_keys`;--> statement-breakpoint
ALTER TABLE `__new_api_keys` RENAME TO `api_keys`;--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_key_hash_unique` ON `api_keys` (`key_hash`);--> statement-breakpoint
CREATE INDEX `api_keys_user_idx` ON `api_keys` (`user_id`);--> statement-breakpoint
CREATE TABLE `__new_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text DEFAULT 'New Chat' NOT NULL,
	`config` text DEFAULT '{}',
	`group_id` text,
	`is_deleted` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_conversations`("id", "user_id", "title", "config", "group_id", "is_deleted", "created_at", "updated_at") SELECT "id", "user_id", "title", "config", "group_id", "is_deleted", "created_at", "updated_at" FROM `conversations`;--> statement-breakpoint
DROP TABLE `conversations`;--> statement-breakpoint
ALTER TABLE `__new_conversations` RENAME TO `conversations`;--> statement-breakpoint
CREATE INDEX `conversations_user_idx` ON `conversations` (`user_id`);--> statement-breakpoint
CREATE INDEX `conversations_updated_idx` ON `conversations` (`updated_at`);--> statement-breakpoint
CREATE INDEX `conversations_user_active_updated_idx` ON `conversations` (`user_id`,`is_deleted`,`updated_at`);--> statement-breakpoint
CREATE TABLE `__new_generation_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`model_name` text NOT NULL,
	`capability` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`input` text,
	`input_summary` text,
	`output` text,
	`reason` text,
	`generation_kwargs` text DEFAULT '{}',
	`generation` text,
	`conversation_id` text,
	`message_id` text,
	`prompt_tokens` integer,
	`completion_tokens` integer,
	`total_tokens` integer,
	`first_token_latency_ms` integer,
	`total_latency_ms` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_generation_logs`("id", "user_id", "model_name", "capability", "status", "input", "input_summary", "output", "reason", "generation_kwargs", "generation", "conversation_id", "message_id", "prompt_tokens", "completion_tokens", "total_tokens", "first_token_latency_ms", "total_latency_ms", "is_deleted", "created_at", "updated_at") SELECT "id", "user_id", "model_name", "capability", "status", "input", "input_summary", "output", "reason", "generation_kwargs", "generation", "conversation_id", "message_id", "prompt_tokens", "completion_tokens", "total_tokens", "first_token_latency_ms", "total_latency_ms", "is_deleted", "created_at", "updated_at" FROM `generation_logs`;--> statement-breakpoint
DROP TABLE `generation_logs`;--> statement-breakpoint
ALTER TABLE `__new_generation_logs` RENAME TO `generation_logs`;--> statement-breakpoint
CREATE INDEX `gen_logs_user_idx` ON `generation_logs` (`user_id`);--> statement-breakpoint
CREATE INDEX `gen_logs_model_idx` ON `generation_logs` (`model_name`);--> statement-breakpoint
CREATE INDEX `gen_logs_status_idx` ON `generation_logs` (`status`);--> statement-breakpoint
CREATE INDEX `gen_logs_capability_idx` ON `generation_logs` (`capability`);--> statement-breakpoint
CREATE INDEX `gen_logs_created_idx` ON `generation_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `gen_logs_user_deleted_created_idx` ON `generation_logs` (`user_id`,`is_deleted`,`created_at`);--> statement-breakpoint
CREATE INDEX `gen_logs_cap_deleted_created_idx` ON `generation_logs` (`capability`,`is_deleted`,`created_at`);--> statement-breakpoint
CREATE INDEX `gen_logs_status_deleted_created_idx` ON `generation_logs` (`status`,`is_deleted`,`created_at`);--> statement-breakpoint
CREATE TABLE `__new_mcp_servers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`transport` text NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_check_status` text,
	`last_check_at` text,
	`last_check_error` text,
	`tools_cache` text,
	`resources_cache` text,
	`prompts_cache` text,
	`server_info` text,
	`config_version` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_mcp_servers`("id", "name", "description", "transport", "config", "enabled", "last_check_status", "last_check_at", "last_check_error", "tools_cache", "resources_cache", "prompts_cache", "server_info", "config_version", "created_at", "updated_at") SELECT "id", "name", "description", "transport", "config", "enabled", "last_check_status", "last_check_at", "last_check_error", "tools_cache", "resources_cache", "prompts_cache", "server_info", "config_version", "created_at", "updated_at" FROM `mcp_servers`;--> statement-breakpoint
DROP TABLE `mcp_servers`;--> statement-breakpoint
ALTER TABLE `__new_mcp_servers` RENAME TO `mcp_servers`;--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_servers_name_unique` ON `mcp_servers` (`name`);--> statement-breakpoint
CREATE TABLE `__new_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`reasoning_content` text,
	`model_id` text,
	`generation_id` text,
	`parent_id` text,
	`is_active` integer DEFAULT true NOT NULL,
	`rating` text,
	`feedback` text,
	`error` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_messages`("id", "conversation_id", "role", "content", "reasoning_content", "model_id", "generation_id", "parent_id", "is_active", "rating", "feedback", "error", "created_at") SELECT "id", "conversation_id", "role", "content", "reasoning_content", "model_id", "generation_id", "parent_id", "is_active", "rating", "feedback", "error", "created_at" FROM `messages`;--> statement-breakpoint
DROP TABLE `messages`;--> statement-breakpoint
ALTER TABLE `__new_messages` RENAME TO `messages`;--> statement-breakpoint
CREATE INDEX `messages_conv_idx` ON `messages` (`conversation_id`);--> statement-breakpoint
CREATE INDEX `messages_parent_idx` ON `messages` (`parent_id`);--> statement-breakpoint
CREATE INDEX `messages_conv_active_created_idx` ON `messages` (`conversation_id`,`is_active`,`created_at`);--> statement-breakpoint
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
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_models`("id", "name", "provider_id", "upstream_model_id", "type", "default_params", "context_window", "max_tokens", "output_dimension", "pricing", "description", "knowledge_date", "timeout", "max_retries", "http_proxy", "enabled", "api_variant_id", "discovered_metadata", "created_at", "updated_at") SELECT "id", "name", "provider_id", "upstream_model_id", "type", "default_params", "context_window", "max_tokens", "output_dimension", "pricing", "description", "knowledge_date", "timeout", "max_retries", "http_proxy", "enabled", "api_variant_id", "discovered_metadata", "created_at", "updated_at" FROM `models`;--> statement-breakpoint
DROP TABLE `models`;--> statement-breakpoint
ALTER TABLE `__new_models` RENAME TO `models`;--> statement-breakpoint
CREATE UNIQUE INDEX `models_name_unique` ON `models` (`name`);--> statement-breakpoint
CREATE INDEX `models_provider_idx` ON `models` (`provider_id`);--> statement-breakpoint
CREATE INDEX `models_type_idx` ON `models` (`type`);--> statement-breakpoint
CREATE TABLE `__new_providers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`adapter_id` text DEFAULT 'openai' NOT NULL,
	`base_url` text NOT NULL,
	`api_version` text,
	`api_key_encrypted` text,
	`default_params` text DEFAULT '{}',
	`http_proxy` text,
	`document_page` text,
	`model_page` text,
	`health_check_url` text,
	`last_health_status` text,
	`last_health_checked_at` text,
	`last_health_error` text,
	`is_local` integer DEFAULT false NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_providers`("id", "name", "adapter_id", "base_url", "api_version", "api_key_encrypted", "default_params", "http_proxy", "document_page", "model_page", "health_check_url", "last_health_status", "last_health_checked_at", "last_health_error", "is_local", "enabled", "created_at", "updated_at") SELECT "id", "name", "adapter_id", "base_url", "api_version", "api_key_encrypted", "default_params", "http_proxy", "document_page", "model_page", "health_check_url", "last_health_status", "last_health_checked_at", "last_health_error", "is_local", "enabled", "created_at", "updated_at" FROM `providers`;--> statement-breakpoint
DROP TABLE `providers`;--> statement-breakpoint
ALTER TABLE `__new_providers` RENAME TO `providers`;--> statement-breakpoint
CREATE UNIQUE INDEX `providers_name_unique` ON `providers` (`name`);--> statement-breakpoint
CREATE TABLE `__new_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_sessions`("id", "user_id", "expires_at", "created_at") SELECT "id", "user_id", "expires_at", "created_at" FROM `sessions`;--> statement-breakpoint
DROP TABLE `sessions`;--> statement-breakpoint
ALTER TABLE `__new_sessions` RENAME TO `sessions`;--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expires_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `__new_tools` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`parameters` text DEFAULT '{}' NOT NULL,
	`webhook_url` text,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_tools`("id", "name", "description", "parameters", "webhook_url", "enabled", "created_at", "updated_at") SELECT "id", "name", "description", "parameters", "webhook_url", "enabled", "created_at", "updated_at" FROM `tools`;--> statement-breakpoint
DROP TABLE `tools`;--> statement-breakpoint
ALTER TABLE `__new_tools` RENAME TO `tools`;--> statement-breakpoint
CREATE UNIQUE INDEX `tools_name_unique` ON `tools` (`name`);--> statement-breakpoint
CREATE TABLE `__new_user_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`preferences` text DEFAULT '{}' NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_user_preferences`("user_id", "preferences", "updated_at") SELECT "user_id", "preferences", "updated_at" FROM `user_preferences`;--> statement-breakpoint
DROP TABLE `user_preferences`;--> statement-breakpoint
ALTER TABLE `__new_user_preferences` RENAME TO `user_preferences`;--> statement-breakpoint
CREATE TABLE `__new_users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_users`("id", "username", "password_hash", "role", "created_at") SELECT "id", "username", "password_hash", "role", "created_at" FROM `users`;--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);--> statement-breakpoint
PRAGMA foreign_key_check;--> statement-breakpoint
PRAGMA foreign_keys=ON;