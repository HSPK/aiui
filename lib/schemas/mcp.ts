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

export const mcpServerDTOSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    transport: mcpTransportSchema,
    /** Free-form config object — discriminated by `transport`. */
    config: z.record(z.string(), z.unknown()),
    enabled: z.boolean(),
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
export type McpServerDTO = z.infer<typeof mcpServerDTOSchema>;
export type McpServerCreateInput = z.infer<typeof mcpServerCreateSchema>;
export type McpServerUpdateInput = z.infer<typeof mcpServerUpdateSchema>;
