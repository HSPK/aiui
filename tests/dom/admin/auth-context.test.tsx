// Tests for context/auth-context.tsx — the highest-priority file in this
// assignment. Focus: login/logout query-cache clearing (the mechanism that
// prevents one account's cached data leaking into the next session on a
// shared browser), the redirect-to-login fallback, and cross-tab sync via
// BroadcastChannel.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { QueryClientProvider } from "@tanstack/react-query";

import { createTestQueryClient, flushAsync } from "./_render";
import { adminUser } from "./_fixtures";
import { AuthProvider, useAuth } from "@/context/auth-context";
import { ApiError } from "@/lib/api/client";

const mockPush = vi.fn();
const mockReplace = vi.fn();
const mockRefresh = vi.fn();
const mockUsePathname = vi.fn<() => string>(() => "/dashboard");
const mockUseSearchParams = vi.fn<() => URLSearchParams | null>(() => new URLSearchParams());

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: mockPush, replace: mockReplace, refresh: mockRefresh }),
    usePathname: () => mockUsePathname(),
    useSearchParams: () => mockUseSearchParams(),
}));

vi.mock("@/lib/api/auth", () => ({
    auth: {
        me: vi.fn(),
        login: vi.fn(),
        logout: vi.fn(),
        changeOwnPassword: vi.fn(),
    },
}));

vi.mock("sonner", () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { auth } from "@/lib/api/auth";
import { toast } from "sonner";

// Captured on every render so tests can invoke `login`/`logout` directly
// (more precise than simulating clicks — lets us assert on the returned
// Promise's resolution/rejection).
let ctxRef: ReturnType<typeof useAuth> | null = null;

function Consumer() {
    const ctx = useAuth();
    ctxRef = ctx;
    return (
        <div>
            <span data-testid="user">{ctx.user ? ctx.user.username : "none"}</span>
            <span data-testid="loading">{String(ctx.isLoading)}</span>
        </div>
    );
}

function renderAuth(opts?: { queryClient?: ReturnType<typeof createTestQueryClient> }) {
    const queryClient = opts?.queryClient ?? createTestQueryClient();
    const view = render(
        <QueryClientProvider client={queryClient}>
            <AuthProvider>
                <Consumer />
            </AuthProvider>
        </QueryClientProvider>,
    );
    return { queryClient, ...view };
}

// jsdom's real `Location` throws "Not implemented: navigation" on `href`
// assignment. Swap in a plain writable stub so the cross-tab "different
// user logged in" hard-reload path can be asserted deterministically.
const originalLocation = window.location;

beforeEach(() => {
    ctxRef = null;
    mockPush.mockClear();
    mockReplace.mockClear();
    mockRefresh.mockClear();
    mockUsePathname.mockReturnValue("/dashboard");
    mockUseSearchParams.mockReturnValue(new URLSearchParams());
    // @ts-expect-error deliberately replacing jsdom's Location for this file
    delete window.location;
    window.location = { ...originalLocation, href: "" } as unknown as string & Location;
});

afterEach(() => {
    window.location = originalLocation as unknown as string & Location;
});

describe("AuthProvider — session bootstrap + redirect fallback", () => {
    it("exposes isLoading=true before the initial /users/me call settles, and does not redirect yet", () => {
        vi.mocked(auth.me).mockImplementation(() => new Promise(() => {}));
        renderAuth();
        expect(screen.getByTestId("loading")).toHaveTextContent("true");
        expect(mockPush).not.toHaveBeenCalled();
    });

    it("exposes the user once /users/me resolves and does not redirect on a protected page", async () => {
        vi.mocked(auth.me).mockResolvedValue(adminUser);
        mockUsePathname.mockReturnValue("/dashboard");
        renderAuth();
        await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("admin"));
        expect(mockPush).not.toHaveBeenCalled();
    });

    it("redirects to /login with an encoded `from` when unauthenticated on a protected page", async () => {
        vi.mocked(auth.me).mockRejectedValue(new ApiError("unauthorized", 401));
        mockUsePathname.mockReturnValue("/dashboard");
        mockUseSearchParams.mockReturnValue(new URLSearchParams());
        renderAuth();
        await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/login?from=%2Fdashboard"));
    });

    it("includes existing query params in the encoded `from` redirect target", async () => {
        vi.mocked(auth.me).mockRejectedValue(new ApiError("unauthorized", 401));
        mockUsePathname.mockReturnValue("/logs");
        mockUseSearchParams.mockReturnValue(new URLSearchParams("foo=bar"));
        renderAuth();
        await waitFor(() =>
            expect(mockPush).toHaveBeenCalledWith(`/login?from=${encodeURIComponent("/logs?foo=bar")}`),
        );
    });

    it("does not redirect when unauthenticated and already on /login", async () => {
        vi.mocked(auth.me).mockRejectedValue(new ApiError("unauthorized", 401));
        mockUsePathname.mockReturnValue("/login");
        renderAuth();
        await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
        expect(mockPush).not.toHaveBeenCalled();
    });

    it("bounces an already-authenticated user away from /login to `from` (or `/`)", async () => {
        vi.mocked(auth.me).mockResolvedValue(adminUser);
        mockUsePathname.mockReturnValue("/login");
        mockUseSearchParams.mockReturnValue(new URLSearchParams("from=%2Fplayground"));
        renderAuth();
        await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/playground"));
    });

    it("bounces an already-authenticated user on /login to `/` when there is no `from`", async () => {
        vi.mocked(auth.me).mockResolvedValue(adminUser);
        mockUsePathname.mockReturnValue("/login");
        mockUseSearchParams.mockReturnValue(new URLSearchParams());
        renderAuth();
        await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/"));
    });

    it("does not crash when useSearchParams returns null (defensive optional-chaining)", async () => {
        vi.mocked(auth.me).mockRejectedValue(new ApiError("unauthorized", 401));
        mockUsePathname.mockReturnValue("/dashboard");
        mockUseSearchParams.mockReturnValue(null);
        renderAuth();
        await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/login?from=%2Fdashboard"));
    });
});

describe("AuthProvider — login()", () => {
    it("logs in, caches the returned user, toasts success, and redirects to `from` (or /)", async () => {
        vi.mocked(auth.me).mockRejectedValue(new ApiError("unauthorized", 401));
        vi.mocked(auth.login).mockResolvedValue(adminUser);
        mockUsePathname.mockReturnValue("/login");
        mockUseSearchParams.mockReturnValue(new URLSearchParams("from=%2Fplayground%2Fchat"));

        const { queryClient } = renderAuth();
        await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));

        await act(async () => {
            await ctxRef!.login({ user_name: "admin", user_password: "secret" });
        });

        expect(auth.login).toHaveBeenCalledWith({ user_name: "admin", user_password: "secret" });
        expect(queryClient.getQueryData(["user", "me"])).toEqual(adminUser);
        expect(toast.success).toHaveBeenCalledWith("Login successful");
        expect(mockPush).toHaveBeenCalledWith("/playground/chat");
    });

    it("clears every cached query on login — prevents the previous session's data leaking into the new one", async () => {
        vi.mocked(auth.me).mockRejectedValue(new ApiError("unauthorized", 401));
        vi.mocked(auth.login).mockResolvedValue(adminUser);
        mockUsePathname.mockReturnValue("/login");

        const { queryClient } = renderAuth();
        await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));

        // Seed the cache as if a PREVIOUS user's session had populated it
        // (conversations, logs, preferences — anything per-user-scoped).
        queryClient.setQueryData(["conversations", "list"], [{ id: "leaked-conv-from-prior-user" }]);
        queryClient.setQueryData(["preferences"], { theme_id: "prior-users-theme" });
        expect(queryClient.getQueryData(["conversations", "list"])).toBeDefined();

        await act(async () => {
            await ctxRef!.login({ user_name: "admin", user_password: "secret" });
        });

        // The explicit assertion the task calls for: nothing from the
        // previous session should survive a login.
        expect(queryClient.getQueryData(["conversations", "list"])).toBeUndefined();
        expect(queryClient.getQueryData(["preferences"])).toBeUndefined();
        // ...while the freshly-authenticated user IS present.
        expect(queryClient.getQueryData(["user", "me"])).toEqual(adminUser);
    });

    it("broadcasts a login envelope (kind+username) to sibling tabs", async () => {
        vi.mocked(auth.me).mockRejectedValue(new ApiError("unauthorized", 401));
        vi.mocked(auth.login).mockResolvedValue(adminUser);
        mockUsePathname.mockReturnValue("/login");
        renderAuth();
        await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));

        const received: unknown[] = [];
        const peer = new BroadcastChannel("loom-auth");
        peer.onmessage = (e) => received.push(e.data);

        await act(async () => {
            await ctxRef!.login({ user_name: "admin", user_password: "secret" });
        });

        await waitFor(() => expect(received).toContainEqual({ kind: "login", username: "admin" }));
        peer.close();
    });

    it("shows 'Invalid username or password' and rethrows on a 401, without touching the cache", async () => {
        vi.mocked(auth.me).mockRejectedValue(new ApiError("unauthorized", 401));
        vi.mocked(auth.login).mockRejectedValue(new ApiError("bad credentials", 401));
        mockUsePathname.mockReturnValue("/login");

        const { queryClient } = renderAuth();
        await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
        queryClient.setQueryData(["marker"], "still-here");

        await act(async () => {
            await expect(
                ctxRef!.login({ user_name: "admin", user_password: "wrong" }),
            ).rejects.toThrow();
        });

        expect(toast.error).toHaveBeenCalledWith("Invalid username or password");
        expect(queryClient.getQueryData(["marker"])).toBe("still-here");
        expect(queryClient.getQueryData(["user", "me"])).not.toEqual(adminUser);
    });

    it("shows the raw error message and rethrows on a non-401 / generic failure", async () => {
        vi.mocked(auth.me).mockRejectedValue(new ApiError("unauthorized", 401));
        vi.mocked(auth.login).mockRejectedValue(new Error("network down"));
        mockUsePathname.mockReturnValue("/login");

        renderAuth();
        await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));

        await act(async () => {
            await expect(
                ctxRef!.login({ user_name: "admin", user_password: "x" }),
            ).rejects.toThrow("network down");
        });

        expect(toast.error).toHaveBeenCalledWith("network down");
    });

    it("falls back to a generic 'Login failed' toast for a non-Error thrown value", async () => {
        vi.mocked(auth.me).mockRejectedValue(new ApiError("unauthorized", 401));
         
        vi.mocked(auth.login).mockRejectedValue("weird non-error rejection" as any);
        mockUsePathname.mockReturnValue("/login");

        renderAuth();
        await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));

        await act(async () => {
            await expect(ctxRef!.login({ user_name: "admin", user_password: "x" })).rejects.toBeTruthy();
        });

        expect(toast.error).toHaveBeenCalledWith("Login failed");
    });
});

describe("AuthProvider — logout()", () => {
    it("logs out, clears every cached query, sets user to null, redirects, and toasts", async () => {
        vi.mocked(auth.me).mockResolvedValue(adminUser);
        vi.mocked(auth.logout).mockResolvedValue(null);
        mockUsePathname.mockReturnValue("/dashboard");

        const { queryClient } = renderAuth();
        await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("admin"));

        // Seed cache with per-user data that must not survive into
        // whatever session comes next on this browser.
        queryClient.setQueryData(["conversations", "list"], [{ id: "admins-conv" }]);
        queryClient.setQueryData(["api-keys", "list"], [{ id: "admins-key" }]);

        act(() => {
            void ctxRef!.logout();
        });

        await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/login"));
        expect(auth.logout).toHaveBeenCalled();
        // Explicit cache-clearing assertion for logout too.
        expect(queryClient.getQueryData(["conversations", "list"])).toBeUndefined();
        expect(queryClient.getQueryData(["api-keys", "list"])).toBeUndefined();
        // Set to `null` (a known value), not merely removed/undefined.
        expect(queryClient.getQueryData(["user", "me"])).toBeNull();
        expect(toast.info).toHaveBeenCalledWith("Logged out");
    });

    it("still clears local state and redirects even when the server-side logout call fails", async () => {
        vi.mocked(auth.me).mockResolvedValue(adminUser);
        vi.mocked(auth.logout).mockRejectedValue(new Error("network down"));

        const { queryClient } = renderAuth();
        await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("admin"));
        queryClient.setQueryData(["marker"], "value");

        act(() => {
            void ctxRef!.logout();
        });

        await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/login"));
        expect(queryClient.getQueryData(["marker"])).toBeUndefined();
        expect(queryClient.getQueryData(["user", "me"])).toBeNull();
        expect(toast.info).toHaveBeenCalledWith("Logged out");
    });

    it("broadcasts a logout envelope to sibling tabs", async () => {
        vi.mocked(auth.me).mockResolvedValue(adminUser);
        vi.mocked(auth.logout).mockResolvedValue(null);
        renderAuth();
        await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("admin"));

        const received: unknown[] = [];
        const peer = new BroadcastChannel("loom-auth");
        peer.onmessage = (e) => received.push(e.data);

        act(() => {
            void ctxRef!.logout();
        });

        await waitFor(() => expect(received).toContainEqual({ kind: "logout" }));
        peer.close();
    });
});

describe("AuthProvider — cross-tab sync via BroadcastChannel", () => {
    let peer: BroadcastChannel;

    beforeEach(() => {
        peer = new BroadcastChannel("loom-auth");
    });

    afterEach(() => {
        peer.close();
    });

    it("clears the cache and redirects when a sibling tab logs out (not already on /login)", async () => {
        vi.mocked(auth.me).mockResolvedValue(adminUser);
        mockUsePathname.mockReturnValue("/dashboard");

        const { queryClient } = renderAuth();
        await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("admin"));
        queryClient.setQueryData(["marker"], "value");

        act(() => {
            peer.postMessage({ kind: "logout" });
        });

        await waitFor(() => expect(queryClient.getQueryData(["marker"])).toBeUndefined());
        expect(queryClient.getQueryData(["user", "me"])).toBeNull();
        await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/login"));
    });

    it("does not push /login again when the sibling-tab logout arrives while already on /login", async () => {
        vi.mocked(auth.me).mockRejectedValue(new ApiError("unauthorized", 401));
        mockUsePathname.mockReturnValue("/login");
        renderAuth();
        await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
        mockPush.mockClear();

        act(() => {
            peer.postMessage({ kind: "logout" });
        });
        await flushAsync();

        expect(mockPush).not.toHaveBeenCalled();
    });

    it("cancels in-flight queries, clears the cache, and hard-reloads when a DIFFERENT user logs in from a sibling tab", async () => {
        vi.mocked(auth.me).mockResolvedValue(adminUser);
        const { queryClient } = renderAuth();
        await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("admin"));
        queryClient.setQueryData(["marker"], "value");

        const cancelSpy = vi.spyOn(queryClient, "cancelQueries");

        act(() => {
            peer.postMessage({ kind: "login", username: "someone-else" });
        });

        await waitFor(() => expect(cancelSpy).toHaveBeenCalledWith({ queryKey: ["user", "me"] }));
        await waitFor(() => expect(queryClient.getQueryData(["marker"])).toBeUndefined());
        expect(window.location.href).toBe("/");
    });

    it("does nothing when the SAME user logs in again from a sibling tab (no-op guard)", async () => {
        vi.mocked(auth.me).mockResolvedValue(adminUser);
        const { queryClient } = renderAuth();
        await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("admin"));
        queryClient.setQueryData(["marker"], "value");

        act(() => {
            peer.postMessage({ kind: "login", username: adminUser.username });
        });
        await flushAsync();

        expect(queryClient.getQueryData(["marker"])).toBe("value");
        expect(window.location.href).toBe("");
    });

    it("does not throw and skips broadcasting when BroadcastChannel is unavailable", async () => {
        const original = globalThis.BroadcastChannel;
        // @ts-expect-error simulate an older browser without BroadcastChannel
        delete globalThis.BroadcastChannel;
        try {
            vi.mocked(auth.me).mockResolvedValue(adminUser);
            vi.mocked(auth.logout).mockResolvedValue(null);
            renderAuth();
            await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("admin"));

            act(() => {
                void ctxRef!.logout();
            });
            await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/login"));
        } finally {
            globalThis.BroadcastChannel = original;
        }
    });
});

describe("useAuth()", () => {
    it("throws when used outside an AuthProvider", () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        function Bad() {
            useAuth();
            return null;
        }
        expect(() => render(<Bad />)).toThrow("useAuth must be used within an AuthProvider");
        consoleError.mockRestore();
    });
});
