import { fetcher } from "./client";
import type { LoginInput, UserDTO } from "@/lib/schemas/user";

/** Auth has a 3-call shape that doesn't map to CRUD; kept handwritten. */
export const auth = {
    login: (data: LoginInput) => fetcher<UserDTO>("/login", {
        method: "POST",
        body: JSON.stringify(data),
        skipAuthRedirect: true,
    }),
    logout: () => fetcher<null>("/logout", { method: "POST", skipAuthRedirect: true }),
    me: () => fetcher<UserDTO>("/users/me"),
};
