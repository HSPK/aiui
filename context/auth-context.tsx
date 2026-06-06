"use client"

import * as React from "react"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { api, ApiError } from "@/lib/api"
import { User, AuthParams } from "@/lib/types"
import { toast } from "sonner"

interface AuthContextType {
    user: User | null
    isLoading: boolean
    login: (params: AuthParams) => Promise<void>
    logout: () => void
}

const AuthContext = React.createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const router = useRouter()
    const pathname = usePathname()
    const searchParams = useSearchParams()
    const queryClient = useQueryClient()

    const { data: user, isLoading } = useQuery({
        queryKey: ["user", "me"],
        queryFn: api.getMe,
        retry: false,
    })

    // Handle redirect based on session state (cookie is httpOnly so we drive off /users/me response)
    React.useEffect(() => {
        if (isLoading) return
        if (typeof window === "undefined") return

        const isPublicPage = pathname === "/login"

        if (!user && !isPublicPage) {
            const currentUrl = pathname + (searchParams?.toString() ? `?${searchParams.toString()}` : "")
            router.push(`/login?from=${encodeURIComponent(currentUrl)}`)
        } else if (user && isPublicPage) {
            const from = searchParams?.get("from")
            router.push(from || "/")
        }
    }, [user, isLoading, pathname, router, searchParams])


    const login = async (params: AuthParams) => {
        try {
            await api.login(params)
            await queryClient.invalidateQueries({ queryKey: ["user"] })

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
            await api.logout()
        } catch {
            // Ignore — we still clear local state
        }
        queryClient.setQueryData(["user", "me"], null)
        queryClient.removeQueries({ queryKey: ["user"] })
        router.push("/login")
        toast.info("Logged out")
    }

    return (
        <AuthContext.Provider value={{ user: user ?? null, isLoading, login, logout }}>
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
