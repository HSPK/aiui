import { fetcher } from "./client";
import type { LoginInput, SelfPasswordInput, UserDTO } from "@/lib/schemas/user";

/** Auth has a 4-call shape that doesn't map to CRUD; kept handwritten. */
export const auth = {
    login: (data: LoginInput) => fetcher<UserDTO>("/login", {
        method: "POST",
        body: JSON.stringify(data),
        skipAuthRedirect: true,
    }),
    logout: () => fetcher<null>("/logout", { method: "POST", skipAuthRedirect: true }),
    me: () => fetcher<UserDTO>("/users/me"),
    /** Self-service password rotation. Server revokes every session
     *  (including the caller's other tabs); the *current* tab keeps
     *  its cookie but should expect a 401 on the next request and
     *  redirect to /login. */
    changeOwnPassword: (data: SelfPasswordInput) =>
        fetcher<{ ok: true }>("/users/me", { method: "PATCH", body: JSON.stringify(data) }),
};
