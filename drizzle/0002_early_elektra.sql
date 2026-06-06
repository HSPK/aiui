ALTER TABLE `generation_logs` ADD `capability` text;--> statement-breakpoint
ALTER TABLE `generation_logs` ADD `input_summary` text;--> statement-breakpoint
CREATE INDEX `gen_logs_capability_idx` ON `generation_logs` (`capability`);