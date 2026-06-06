import { z } from "zod";

// ---- DTO (output) ----

export const userDTOSchema = z.object({
    username: z.string(),
    role: z.enum(["user", "admin"]),
    created_at: z.string().optional(),
});

// ---- Inputs ----

export const loginSchema = z.object({
    user_name: z.string().trim().min(1),
    user_password: z.string().min(1),
});

export const userCreateSchema = z.object({
    username: z.string().trim().min(1, "Username is required"),
    password: z.string().min(4, "Password must be at least 4 characters"),
    role: z.enum(["user", "admin"]).default("user"),
});

export const userUpdateSchema = z.object({
    password: z.string().min(4, "Password must be at least 4 characters").optional(),
    role: z.enum(["user", "admin"]).optional(),
});

export const userListQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    page_size: z.coerce.number().int().min(1).max(200).default(20),
    sort: z.string().default("-created_at"),
    keyword: z.string().trim().optional(),
    filter_admin: z.enum(["true", "false"]).optional(),
});

// ---- Derived types ----

export type UserDTO = z.infer<typeof userDTOSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UserCreateInput = z.infer<typeof userCreateSchema>;
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;
export type UserListQuery = z.infer<typeof userListQuerySchema>;

/** FE-friendly query type: boolean instead of `"true" | "false"` URL string. */
export type UserFilterParams = {
    page?: number;
    page_size?: number;
    sort?: string;
    keyword?: string;
    filter_admin?: boolean;
};
