import { fetcher } from "./client";
import type { LoginInput, UserDTO } from "@/lib/schemas/user";

export const authApi = {
    login: (data: LoginInput) => fetcher<UserDTO>("/login", {
        method: "POST",
        body: JSON.stringify(data),
        skipAuthRedirect: true,
    }),
    logout: () => fetcher<null>("/logout", { method: "POST", skipAuthRedirect: true }),
    me: () => fetcher<UserDTO>("/users/me"),
};
