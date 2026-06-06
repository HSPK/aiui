CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`prefix` text NOT NULL,
	`key_hash` text NOT NULL,
	`last_used_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_key_hash_unique` ON `api_keys` (`key_hash`);--> statement-breakpoint
CREATE INDEX `api_keys_user_idx` ON `api_keys` (`user_id`);--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text DEFAULT 'New Chat' NOT NULL,
	`config` text DEFAULT '{}',
	`group_id` text,
	`search_text` text,
	`is_deleted` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `conversations_user_idx` ON `conversations` (`user_id`);--> statement-breakpoint
CREATE INDEX `conversations_updated_idx` ON `conversations` (`updated_at`);--> statement-breakpoint
CREATE TABLE `generation_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`model_name` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`input` text,
	`output` text,
	`reason` text,
	`content` text,
	`generation_kwargs` text DEFAULT '{}',
	`generation` text,
	`conversation_id` text,
	`message_id` text,
	`prompt_tokens` integer,
	`completion_tokens` integer,
	`total_tokens` integer,
	`latency_ms` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `gen_logs_user_idx` ON `generation_logs` (`user_id`);--> statement-breakpoint
CREATE INDEX `gen_logs_model_idx` ON `generation_logs` (`model_name`);--> statement-breakpoint
CREATE INDEX `gen_logs_status_idx` ON `generation_logs` (`status`);--> statement-breakpoint
CREATE INDEX `gen_logs_created_idx` ON `generation_logs` (`created_at`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`reasoning_content` text,
	`model_id` text,
	`generation_id` text,
	`parent_id` text,
	`meta` text,
	`is_active` integer DEFAULT true NOT NULL,
	`rating` text,
	`feedback` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `messages_conv_idx` ON `messages` (`conversation_id`);--> statement-breakpoint
CREATE INDEX `messages_parent_idx` ON `messages` (`parent_id`);--> statement-breakpoint
CREATE TABLE `models` (
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
	`timeout` integer DEFAULT 60 NOT NULL,
	`max_retries` integer DEFAULT 2 NOT NULL,
	`http_proxy` text,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `models_name_unique` ON `models` (`name`);--> statement-breakpoint
CREATE INDEX `models_provider_idx` ON `models` (`provider_id`);--> statement-breakpoint
CREATE INDEX `models_type_idx` ON `models` (`type`);--> statement-breakpoint
CREATE TABLE `providers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`base_url` text NOT NULL,
	`api_key_encrypted` text,
	`default_params` text DEFAULT '{}',
	`http_proxy` text,
	`document_page` text,
	`model_page` text,
	`is_local` integer DEFAULT false NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `providers_name_unique` ON `providers` (`name`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);