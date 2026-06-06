import type { BaseResponse } from "@/lib/types";

export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "/api";

export class ApiError extends Error {
    status: number;
    code?: number;
    constructor(message: string, status: number, code?: number) {
        super(message);
        this.status = status;
        this.code = code;
        this.name = "ApiError";
    }
}

interface FetcherOptions extends RequestInit {
    /** When true, do not redirect to /login on 401. Useful for auth endpoints themselves. */
    skipAuthRedirect?: boolean;
}

/**
 * Single low-level fetch helper used by every domain-specific api module.
 * Unwraps the `{ code, msg, data }` envelope, surfaces `ApiError` for
 * non-2xx OR `code !== 0`, and bounces the browser to /login on 401.
 */
export async function fetcher<T>(path: string, options?: FetcherOptions): Promise<T> {
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(options?.headers as Record<string, string>),
    };

    const res = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers,
        credentials: "include",
    });

    if (!res.ok) {
        if (res.status === 401 && !options?.skipAuthRedirect && typeof window !== "undefined" && !window.location.pathname.includes("/login")) {
            const here = window.location.pathname + window.location.search;
            window.location.href = `/login?from=${encodeURIComponent(here)}`;
            throw new ApiError("Unauthorized - redirecting to login", 401);
        }
        let message = `API Error: ${res.statusText}`;
        let code: number | undefined;
        try {
            const body = await res.json();
            message = body.msg || message;
            code = body.code;
        } catch { /* ignore */ }
        throw new ApiError(message, res.status, code);
    }

    const json = (await res.json()) as BaseResponse<T>;
    if (json.code !== 0) throw new ApiError(json.msg || "Unknown API Error", 200, json.code);
    return json.data;
}

/**
 * Raw fetch (no envelope unwrapping) for SSE / binary endpoints. Still goes
 * through credentials: include + 401 handling.
 */
export async function rawFetch(path: string, options?: FetcherOptions): Promise<Response> {
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(options?.headers as Record<string, string>),
    };
    const res = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers,
        credentials: "include",
    });
    if (!res.ok && res.status === 401 && !options?.skipAuthRedirect && typeof window !== "undefined" && !window.location.pathname.includes("/login")) {
        const here = window.location.pathname + window.location.search;
        window.location.href = `/login?from=${encodeURIComponent(here)}`;
        throw new ApiError("Unauthorized - redirecting to login", 401);
    }
    if (!res.ok) {
        let message = `API Error: ${res.statusText}`;
        try {
            const body = await res.json();
            message = body.msg || message;
        } catch { /* ignore */ }
        throw new ApiError(message, res.status);
    }
    return res;
}

export function withQuery(path: string, params: Record<string, string | number | boolean | undefined | null>): string {
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
        if (v === undefined || v === null || v === "") continue;
        search.set(k, String(v));
    }
    const qs = search.toString();
    return qs ? `${path}?${qs}` : path;
}
