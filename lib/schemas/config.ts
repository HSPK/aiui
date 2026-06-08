import { z } from "zod";
import { providerCreateSchema } from "./provider";

/**
 * Shape of the user-facing `loom.config.yaml` (also accepted as JSON or YML).
 *
 * Used by:
 *   - lib/preflight.ts to parse & hoist infra fields into env vars
 *   - bin/loom.ts to build the init-config template (typed against this)
 *   - lib/server/config.ts to upsert providers[]
 *
 * All fields are optional — a config file with only `master_key` is valid.
 * Unknown keys are preserved (`.loose()`) so older configs still load.
 */
export const loomConfigSchema = z.object({
    master_key: z.string().optional(),

    database: z
        .object({ path: z.string().optional() })
        .loose()
        .optional(),

    server: z
        .object({
            port: z.number().int().positive().optional(),
            hostname: z.string().optional(),
        })
        .loose()
        .optional(),

    admin: z
        .object({
            username: z.string().optional(),
            password: z.string().optional(),
        })
        .loose()
        .optional(),

    session: z
        .object({ ttl_days: z.number().int().positive().optional() })
        .loose()
        .optional(),

    cache: z
        .object({ models_ttl_seconds: z.number().int().min(0).optional() })
        .loose()
        .optional(),

    /**
     * Providers reuse the wire create-input schema so the file & API agree.
     * `models[]` is intentionally NOT here — model entries are discovered
     * live from each provider's /models endpoint.
     */
    providers: z.array(providerCreateSchema).optional(),
}).loose();

export type LoomConfig = z.infer<typeof loomConfigSchema>;
