import { z } from "zod";

export const userRoleSchema = z.enum(["user", "admin"]);

export const userCreateSchema = z.object({
    username: z.string().trim().min(1, "Username is required"),
    password: z.string().min(4, "Password must be at least 4 characters"),
    role: userRoleSchema.default("user"),
});

export const userUpdateSchema = z.object({
    password: z.string().min(4, "Password must be at least 4 characters").optional(),
    role: userRoleSchema.optional(),
});

export const userListQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    page_size: z.coerce.number().int().min(1).max(200).default(20),
    sort: z.string().default("-created_at"),
    keyword: z.string().trim().optional(),
    filter_admin: z.enum(["true", "false"]).optional(),
});

export type UserCreateInput = z.infer<typeof userCreateSchema>;
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;
export type UserListQuery = z.infer<typeof userListQuerySchema>;
