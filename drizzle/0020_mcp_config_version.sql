ALTER TABLE `mcp_servers` ADD `config_version` text DEFAULT '' NOT NULL;--> statement-breakpoint
-- Backfill existing rows: seed config_version from updated_at so the
-- runtime state machine treats already-cached connections (none on a
-- fresh boot, but consistent regardless) as "built against this snap".
UPDATE `mcp_servers` SET `config_version` = `updated_at` WHERE `config_version` = '';