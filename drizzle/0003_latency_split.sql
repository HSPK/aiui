ALTER TABLE `generation_logs` RENAME COLUMN "latency_ms" TO "total_latency_ms";--> statement-breakpoint
ALTER TABLE `generation_logs` ADD `first_token_latency_ms` integer;