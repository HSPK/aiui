import { z } from "zod";

export const apiKeyCreateSchema = z.object({
    name: z.string().trim().min(1, "API key name is required"),
});

export type ApiKeyCreateInput = z.infer<typeof apiKeyCreateSchema>;
