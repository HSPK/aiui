import "server-only";
import type { User } from "../db/schema";

export interface SessionUser {
    id: string;
    username: string;
    role: "admin" | "user";
    createdAt: string;
}

export function userToSession(u: User): SessionUser {
    return {
        id: u.id,
        username: u.username,
        role: u.role,
        createdAt: u.createdAt,
    };
}
