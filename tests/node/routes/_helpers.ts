// Shared test-only helpers for the `tests/node/routes/**` suite. Not a
// `*.test.ts` file so vitest's `tests/node/**/*.test.ts` include glob
// never picks it up as its own suite.
//
// Every route test file mocks `@/lib/server/auth` itself (vi.mock must
// be written per-file so vitest's hoisting works), then uses the
// `asAnon` / `asUser` / `asAdmin` helpers below to drive the four
// exported functions `defineRoute` actually calls (`getCurrentUser`,
// `requireUser`, `requireAdmin`, `authenticateGateway`) the same way
// the real session/gateway auth modules would resolve them for a given
// caller — so route-handler tests exercise the real 401/403 branching
// in `lib/server/route.ts` without spinning up real sessions.
import { vi } from "vitest";
import { NextRequest } from "next/server";
import * as auth from "@/lib/server/auth";
import { forbidden, unauthorized } from "@/lib/server/response";
import type { SessionUser } from "@/lib/server/auth";
import type { User } from "@/lib/server/db/schema";

/** Build a full SessionUser (incl. createdAt) from a seeded DB row.
 *  `tests/helpers/db.ts`'s own `sessionUser()` omits `createdAt`, which
 *  a couple of routes (`GET /api/users/me`) read directly. */
export function toSessionUser(user: User): SessionUser {
    return { id: user.id, username: user.username, role: user.role, createdAt: user.createdAt };
}

/** No session, no bearer key — every auth mode should 401. */
export function asAnon(): void {
    vi.mocked(auth.getCurrentUser).mockResolvedValue(null);
    vi.mocked(auth.requireUser).mockRejectedValue(unauthorized());
    vi.mocked(auth.requireAdmin).mockRejectedValue(unauthorized());
    vi.mocked(auth.authenticateGateway).mockRejectedValue(unauthorized("Missing or invalid credentials"));
}

/** A logged-in non-admin caller — admin-gated routes must 403. */
export function asUser(user: SessionUser): void {
    vi.mocked(auth.getCurrentUser).mockResolvedValue(user);
    vi.mocked(auth.requireUser).mockResolvedValue(user);
    vi.mocked(auth.requireAdmin).mockRejectedValue(forbidden("Admin required"));
    vi.mocked(auth.authenticateGateway).mockResolvedValue(user);
}

/** A logged-in admin caller — every auth mode succeeds. */
export function asAdmin(user: SessionUser): void {
    vi.mocked(auth.getCurrentUser).mockResolvedValue(user);
    vi.mocked(auth.requireUser).mockResolvedValue(user);
    vi.mocked(auth.requireAdmin).mockResolvedValue(user);
    vi.mocked(auth.authenticateGateway).mockResolvedValue(user);
}

export interface ReqInit extends Omit<RequestInit, "body"> {
    /** Convenience: JSON-serialised and given the right Content-Type. */
    json?: unknown;
    body?: BodyInit | null;
}

const ORIGIN = "http://localhost";

/** Build a NextRequest for a route handler test. `path` may be relative
 *  (`/api/things?x=1`) or absolute. */
export function makeRequest(path: string, init: ReqInit = {}): NextRequest {
    const { json, headers: rawHeaders, body: rawBody, signal, ...rest } = init;
    const headers = new Headers(rawHeaders);
    let body = rawBody ?? undefined;
    if (json !== undefined) {
        body = JSON.stringify(json);
        if (!headers.has("content-type")) headers.set("content-type", "application/json");
    }
    const url = path.startsWith("http") ? path : `${ORIGIN}${path}`;
    // NextRequest's RequestInit is stricter than the DOM lib's (no `null` for
    // `signal`) — normalise it away since no test here passes one.
    return new NextRequest(url, { ...rest, headers, body, signal: signal ?? undefined });
}

export function getReq(path: string, init: ReqInit = {}): NextRequest {
    return makeRequest(path, { method: "GET", ...init });
}
export function postJson(path: string, json: unknown, init: ReqInit = {}): NextRequest {
    return makeRequest(path, { method: "POST", json, ...init });
}
export function patchJson(path: string, json: unknown, init: ReqInit = {}): NextRequest {
    return makeRequest(path, { method: "PATCH", json, ...init });
}
export function deleteReq(path: string, init: ReqInit = {}): NextRequest {
    return makeRequest(path, { method: "DELETE", ...init });
}

/** Dynamic-route context — `{ params: Promise.resolve(params) }`. */
export function ctx<T extends Record<string, string>>(params: T): { params: Promise<T> } {
    return { params: Promise.resolve(params) };
}

/** Parse the standard `{code,msg,data}` envelope off a Response. */
export async function envelope<T = unknown>(res: Response): Promise<{ code: number; msg: string; data: T }> {
    return res.json();
}

/** Installs `global.fetch` as a `vi.fn()` that answers any `/models`
 *  discovery GET with an empty OpenAI-shaped list, and rejects
 *  anything else — override per-test with `.mockResolvedValueOnce` /
 *  `.mockImplementation` for scenarios that need real discovery data.
 *  Keeps provider/model route tests network-free by default. */
export function mockDiscoveryFetch(): ReturnType<typeof vi.fn> {
    const fn = vi.fn(async (input: string | URL | Request) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url.includes("/models")) {
            return new Response(JSON.stringify({ data: [] }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
        }
        return new Response(JSON.stringify({ status: "ok" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    });
    global.fetch = fn as unknown as typeof fetch;
    return fn;
}
