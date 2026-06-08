import { z } from "zod";

// ---- Transport-specific config schemas ----

export const mcpStdioConfigSchema = z.object({
    command: z.string().trim().min(1, "command is required"),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    cwd: z.string().optional(),
});

export const mcpHttpConfigSchema = z.object({
    url: z.string().trim().url("url must be a valid URL"),
    headers: z.record(z.string(), z.string()).optional(),
});

export const mcpTransportSchema = z.enum(["stdio", "http"]);

// ---- DTO ----

export const mcpToolDescriptorSchema = z.object({
    name: z.string(),
    description: z.string().optional(),
    parameters: z.record(z.string(), z.unknown()),
});

export const mcpServerInfoSchema = z.object({
    name: z.string().optional(),
    version: z.string().optional(),
    instructions: z.string().optional(),
    /** Negotiated capabilities map from the initialize handshake —
     *  free-form per the MCP spec (`tools`, `resources`, `prompts`,
     *  `logging`, `completions`, etc., each typically `{}` or a
     *  feature flag object). */
    capabilities: z.record(z.string(), z.unknown()).optional(),
});

export const mcpServerDTOSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    transport: mcpTransportSchema,
    /** Free-form config object — discriminated by `transport`. */
    config: z.record(z.string(), z.unknown()),
    enabled: z.boolean(),
    /** Health check status from the most recent check (create / update
     *  / explicit /check call). `null` means "never checked". */
    last_check_status: z.enum(["ok", "error"]).nullable(),
    last_check_at: z.string().nullable(),
    last_check_error: z.string().nullable(),
    /** `tools/list` snapshot from the last successful check. */
    tools_cache: z.array(mcpToolDescriptorSchema).nullable(),
    /** Server-reported identity from the initialize handshake. Useful
     *  for showing the upstream's own description / version on the
     *  details sheet without forcing the admin to type one. */
    server_info: mcpServerInfoSchema.nullable(),
    created_at: z.string(),
    updated_at: z.string(),
});

// ---- Inputs ----

export const mcpServerCreateSchema = z
    .object({
        name: z.string().trim().min(1, "Server name is required"),
        description: z.string().optional(),
        transport: mcpTransportSchema,
        config: z.record(z.string(), z.unknown()),
        enabled: z.boolean().optional(),
    })
    .superRefine((val, ctx) => {
        // Validate config shape against the transport tag.
        const parser = val.transport === "stdio" ? mcpStdioConfigSchema : mcpHttpConfigSchema;
        const result = parser.safeParse(val.config);
        if (!result.success) {
            for (const issue of result.error.issues) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ["config", ...issue.path],
                    message: issue.message,
                });
            }
        }
    });

export const mcpServerUpdateSchema = z
    .object({
        name: z.string().trim().min(1).optional(),
        description: z.string().optional(),
        transport: mcpTransportSchema.optional(),
        config: z.record(z.string(), z.unknown()).optional(),
        enabled: z.boolean().optional(),
    })
    .superRefine((val, ctx) => {
        if (val.transport && val.config) {
            const parser = val.transport === "stdio" ? mcpStdioConfigSchema : mcpHttpConfigSchema;
            const result = parser.safeParse(val.config);
            if (!result.success) {
                for (const issue of result.error.issues) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        path: ["config", ...issue.path],
                        message: issue.message,
                    });
                }
            }
        }
    });

// ---- Derived types ----

export type McpTransport = z.infer<typeof mcpTransportSchema>;
export type McpStdioConfig = z.infer<typeof mcpStdioConfigSchema>;
export type McpHttpConfig = z.infer<typeof mcpHttpConfigSchema>;
export type McpToolDescriptor = z.infer<typeof mcpToolDescriptorSchema>;
export type McpServerInfo = z.infer<typeof mcpServerInfoSchema>;
export type McpServerDTO = z.infer<typeof mcpServerDTOSchema>;
export type McpServerCreateInput = z.infer<typeof mcpServerCreateSchema>;
export type McpServerUpdateInput = z.infer<typeof mcpServerUpdateSchema>;

// ---- Preset catalogue ----

/** A one-click preset entry — describes a popular MCP server's transport
 *  + base config. The FE form pre-fills from this; the admin then fills
 *  in any required secrets / paths and saves. `slots` lists fields the
 *  preset can't pre-fill (API keys, allowed paths) so the FE can hint at
 *  them. */
export const mcpPresetSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    transport: mcpTransportSchema,
    /** Stdio: `{command, args, env, cwd?}`. Http: `{url, headers?}`.
     *  Placeholder strings for secrets / paths use `<UPPERCASE>` so it's
     *  obvious in the form which fields still need filling. */
    config: z.record(z.string(), z.unknown()),
    /** Slot descriptors — fields the user has to fill in. Keys are
     *  dot-paths into config (e.g. `env.GITHUB_TOKEN`, `args[2]`). */
    slots: z
        .array(
            z.object({
                path: z.string(),
                label: z.string(),
                /** "secret" hides on display, "path" suggests filesystem
                 *  browser hint, "text" is plain. */
                kind: z.enum(["secret", "path", "text"]),
            }),
        )
        .default([]),
    /** Source URL (npm / GitHub repo) for documentation. */
    homepage: z.string().optional(),
});

export type McpPreset = z.infer<typeof mcpPresetSchema>;
