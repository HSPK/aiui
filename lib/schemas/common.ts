// Shared schemas: single source of truth for wire-format types.
//
// Both server (validation + service signatures) and client (TypeScript
// types + request builders) import from here. There are no per-side
// hand-written DTO interfaces anywhere else in the codebase — changing
// a field touches *this file*, the Drizzle column it maps to, and the
// one line in the serializer that copies the value.
//
// Types are derived via `z.infer<typeof xxxSchema>`. Don't re-declare them.

import { z } from "zod";

// ---- Common shapes ----

export const baseResponseSchema = <T extends z.ZodType>(data: T) =>
    z.object({ code: z.number(), msg: z.string(), data });

export const paginationQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    page_size: z.coerce.number().int().min(1).max(500).default(20),
    sort: z.string().default("-created_at"),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export interface Paginated<T> {
    items: T[];
    total: number;
    page: number;
    page_size: number;
}

/** The envelope every API response is wrapped in. */
export interface BaseResponse<T> {
    code: number;
    msg: string;
    data: T;
}
