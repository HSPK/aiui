CREATE INDEX `conversations_user_active_updated_idx` ON `conversations` (`user_id`,`is_deleted`,`updated_at`);--> statement-breakpoint
CREATE INDEX `gen_logs_user_deleted_created_idx` ON `generation_logs` (`user_id`,`is_deleted`,`created_at`);--> statement-breakpoint
CREATE INDEX `gen_logs_cap_deleted_created_idx` ON `generation_logs` (`capability`,`is_deleted`,`created_at`);--> statement-breakpoint
CREATE INDEX `gen_logs_status_deleted_created_idx` ON `generation_logs` (`status`,`is_deleted`,`created_at`);--> statement-breakpoint
CREATE INDEX `messages_conv_active_created_idx` ON `messages` (`conversation_id`,`is_active`,`created_at`);