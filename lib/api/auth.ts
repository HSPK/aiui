import { fetcher } from "./client";
import type { AuthParams, User } from "@/lib/types";

export const authApi = {
    login: (data: AuthParams) => fetcher<User>("/login", {
        method: "POST",
        body: JSON.stringify(data),
        skipAuthRedirect: true,
    }),
    logout: () => fetcher<null>("/logout", { method: "POST", skipAuthRedirect: true }),
    me: () => fetcher<User>("/users/me"),
};
