"use client"

import { auth, ApiError } from "@/lib/api";
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
            queryClient.setQueryData(["user", "me"], userData)

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
        queryClient.setQueryData(["user", "me"], null)
        queryClient.removeQueries({ queryKey: ["user"] })
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
