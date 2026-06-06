import { fetcher, withQuery } from "./client";
import type { Paginated } from "@/lib/schemas/common";
import type { UserCreateInput, UserDTO, UserFilterParams, UserUpdateInput } from "@/lib/schemas/user";

export const usersApi = {
    list: (params: UserFilterParams = {}) =>
        fetcher<Paginated<UserDTO>>(withQuery("/users", { ...params })),
    create: (data: UserCreateInput) =>
        fetcher<UserDTO>("/users", { method: "POST", body: JSON.stringify(data) }),
    update: (username: string, data: UserUpdateInput) =>
        fetcher<null>(`/users/${encodeURIComponent(username)}`, {
            method: "PATCH",
            body: JSON.stringify(data),
        }),
    remove: (username: string) =>
        fetcher<null>(`/users/${encodeURIComponent(username)}`, { method: "DELETE" }),
};
