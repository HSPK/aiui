"use client"

import { auth } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/client";
import type { LoginInput, UserDTO } from "@/lib/schemas/user";
import * as React from "react"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { useQuery, useQueryClient } from "@tanstack/react-query"

import { toast } from "sonner"

interface AuthContextType {
    user: UserDTO | null
    isLoading: boolean
    login: (params: LoginInput) => Promise<void>
    logout: () => void
}

const AuthContext = React.createContext<AuthContextType | undefined>(undefined)

/** Cross-tab auth lifecycle channel.
 *
 *  Without this, tab 2 keeps serving cached `["user","me"]` (5min
 *  staleTime) + cached per-user resources for minutes after tab 1
 *  logs out — until something triggers a network call that 401s. In
 *  shared-browser scenarios that's a privacy leak.
 *
 *  Channel envelopes:
 *    - `{kind:"logout"}`            → peers clear cache + redirect to /login
 *    - `{kind:"login", username}`   → peers whose cached username differs
 *                                     clear cache + reload (a different user
 *                                     just logged in on a sibling tab) */
type AuthBroadcast =
    | { kind: "logout" }
    | { kind: "login"; username: string };

const AUTH_CHANNEL = "loom-auth";

function postAuth(msg: AuthBroadcast): void {
    if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(AUTH_CHANNEL);
    try { ch.postMessage(msg); } finally { ch.close(); }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const router = useRouter()
    const pathname = usePathname()
    const searchParams = useSearchParams()
    const queryClient = useQueryClient()

    const { data: user, status, isFetching } = useQuery({
        queryKey: ["user", "me"],
        queryFn: auth.me,
        retry: false,
        // Treat 401 result as a value, not as undefined-due-to-loading.
        staleTime: 1000 * 60 * 5,
    })

    // Cross-tab listener: react to logouts / different-user logins
    // happening in sibling tabs.
    React.useEffect(() => {
        if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return
        const ch = new BroadcastChannel(AUTH_CHANNEL)
        const onMessage = (e: MessageEvent<AuthBroadcast>) => {
            if (e.data?.kind === "logout") {
                queryClient.clear()
                queryClient.setQueryData(["user", "me"], null)
                if (pathname !== "/login") router.push("/login")
            } else if (e.data?.kind === "login") {
                // A login happened in a sibling tab. We CANNOT compare
                // against our cached username and bail when missing —
                // if our `/users/me` query is mid-flight with the
                // PREVIOUS user's cookie, its response will populate
                // the cache with the wrong identity even though the
                // browser cookie jar now holds the new user's token.
                // Cancel + clear + invalidate so the refetch uses the
                // freshly-installed cookie, then hard-reload if the
                // identity changed.
                const peerUsername = e.data.username
                const currentName = queryClient.getQueryData<UserDTO | null>(["user", "me"])?.username
                if (currentName === peerUsername) return
                queryClient.cancelQueries({ queryKey: ["user", "me"] })
                queryClient.clear()
                // Hard-reload picks up the new cookie and re-bootstraps
                // every per-user resource against the new identity.
                window.location.href = "/"
            }
        }
        ch.addEventListener("message", onMessage)
        return () => {
            ch.removeEventListener("message", onMessage)
            ch.close()
        }
    }, [queryClient, router, pathname])

    // Handle redirect based on session state (cookie is httpOnly so we drive off /users/me response).
    // IMPORTANT: only act once the query has actually settled. After a 401, `status === "error"` and
    // a subsequent refetch (post-login) keeps `status === "error"` until new data arrives. Gating on
    // `isFetching` prevents the effect from firing with a stale `user = undefined` after the pathname
    // changes (which would bounce the user back to /login after a successful login).
    React.useEffect(() => {
        if (typeof window === "undefined") return
        if (status === "pending") return
        if (isFetching) return

        const isPublicPage = pathname === "/login"

        if (!user && !isPublicPage) {
            const currentUrl = pathname + (searchParams?.toString() ? `?${searchParams.toString()}` : "")
            router.push(`/login?from=${encodeURIComponent(currentUrl)}`)
        } else if (user && isPublicPage) {
            const from = searchParams?.get("from")
            router.push(from || "/")
        }
    }, [user, status, isFetching, pathname, router, searchParams])


    const login = async (params: LoginInput) => {
        try {
            // The login response already returns the authenticated user — write it into the cache
            // synchronously so any consumer (including the redirect effect) sees `user` defined
            // before we navigate. Using invalidateQueries here would cause a refetch race with the
            // pathname-change re-render and bounce the user back to /login.
            const userData = await auth.login(params)
            // Drop every cached query from the previous session before
            // we write the new user — without this, shared-browser
            // scenarios leak the previous user's conversations / logs /
            // preferences for the brief window before each refetch
            // lands. queryClient.clear() is overkill-safe: every
            // listener will re-fetch on demand.
            queryClient.clear()
            queryClient.setQueryData(["user", "me"], userData)
            postAuth({ kind: "login", username: userData.username })

            toast.success("Login successful")

            const from = searchParams?.get("from")
            router.push(from || "/")

        } catch (error: unknown) {
            if (error instanceof ApiError && error.status === 401) {
                toast.error("Invalid username or password")
            } else {
                const msg = error instanceof Error ? error.message : "Login failed"
                toast.error(msg)
            }
            throw error
        }
    }

    const logout = async () => {
        try {
            await auth.logout()
        } catch {
            // Ignore — we still clear local state
        }
        // Drop every cached query so the next login (possibly as a
        // different user) starts from scratch. Conversations, logs,
        // preferences, api keys and any future per-user resource are
        // all server-scoped to userId and must not be reused.
        queryClient.clear()
        queryClient.setQueryData(["user", "me"], null)
        postAuth({ kind: "logout" })
        router.push("/login")
        toast.info("Logged out")
    }

    return (
        <AuthContext.Provider value={{ user: user ?? null, isLoading: status === "pending", login, logout }}>
            {children}
        </AuthContext.Provider>
    )
}

export function useAuth() {
    const context = React.useContext(AuthContext)
    if (context === undefined) {
        throw new Error("useAuth must be used within an AuthProvider")
    }
    return context
}
