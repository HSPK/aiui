import { z } from "zod";

// ---- DTO ----

export const toolDTOSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    /** JSON Schema for the function parameters (object type at the top). */
    parameters: z.record(z.string(), z.unknown()),
    /** Optional server-side webhook invoked when the model calls this tool. */
    webhook_url: z.string().nullable(),
    enabled: z.boolean(),
    created_at: z.string(),
    updated_at: z.string(),
});

// ---- Inputs ----

/** OpenAI function names must be /[a-zA-Z0-9_-]+/. */
const toolNameSchema = z
    .string()
    .trim()
    .min(1, "Tool name is required")
    .regex(/^[a-zA-Z0-9_-]+$/, "Only letters, digits, _ and - allowed");

export const toolCreateSchema = z.object({
    name: toolNameSchema,
    description: z.string().optional(),
    parameters: z.record(z.string(), z.unknown()).optional(),
    webhook_url: z
        .string()
        .trim()
        .url("webhook_url must be a URL")
        .nullable()
        .optional(),
    enabled: z.boolean().optional(),
});

export const toolUpdateSchema = toolCreateSchema.partial();

// ---- Derived types ----

export type ToolDTO = z.infer<typeof toolDTOSchema>;
export type ToolCreateInput = z.infer<typeof toolCreateSchema>;
export type ToolUpdateInput = z.infer<typeof toolUpdateSchema>;
