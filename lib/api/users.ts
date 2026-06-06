import { fetcher, withQuery } from "./client";
import type {
    User,
    UserCreateParams,
    UserFilterParams,
    UserListResponse,
    UserUpdateParams,
} from "@/lib/types";

export const usersApi = {
    list: (params: UserFilterParams = {}) =>
        fetcher<UserListResponse>(withQuery("/users", { ...params })),
    create: (data: UserCreateParams) =>
        fetcher<User>("/users", { method: "POST", body: JSON.stringify(data) }),
    update: (username: string, data: UserUpdateParams) =>
        fetcher<null>(`/users/${encodeURIComponent(username)}`, {
            method: "PATCH",
            body: JSON.stringify(data),
        }),
    remove: (username: string) =>
        fetcher<null>(`/users/${encodeURIComponent(username)}`, { method: "DELETE" }),
};
