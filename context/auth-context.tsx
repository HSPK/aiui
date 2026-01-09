"use client"

import * as React from "react"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { api, setAuthHeader, getAuthHeader, ApiError } from "@/lib/api"
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
    const [isMounting, setIsMounting] = React.useState(true)

    // Check for local credentials on mount
    React.useEffect(() => {
        setIsMounting(false)
    }, [])

    const { data: user, isLoading, isError } = useQuery({
        queryKey: ["user", "me"],
        queryFn: api.getMe,
        retry: false,
        enabled: !!getAuthHeader(), // Only fetch if we have a token
    })

    // Handle redirect if not logged in and not on public page
    React.useEffect(() => {
        if (isMounting) return;

        // Only run this logic on client side 
        if (typeof window === "undefined") return;

        const isPublicPage = pathname === "/login";
        const hasAuth = !!getAuthHeader();

        if (!hasAuth && !isPublicPage) {
            // Redirect to login preserving the current URL
            const currentUrl = pathname + (searchParams?.toString() ? `?${searchParams.toString()}` : "");
            router.push(`/login?from=${encodeURIComponent(currentUrl)}`);
        } else if (hasAuth && isPublicPage) {
            // Already logged in, redirect to home or previous page
            const from = searchParams?.get("from");
            router.push(from || "/");
        }
    }, [user, isLoading, pathname, router, isMounting, searchParams])


    const login = async (params: AuthParams) => {
        try {
            // 1. Validate credentials via API
            await api.login(params);

            // 2. Set credentials for future requests
            setAuthHeader(params.user_name, params.user_password);

            // 3. Invalidate user query to fetch profile
            await queryClient.invalidateQueries({ queryKey: ["user"] });

            toast.success("Login successful");

            // 4. Redirect
            const from = searchParams?.get("from");
            router.push(from || "/");

        } catch (error: any) {
            if (error instanceof ApiError && error.status === 401) {
                toast.error("Invalid username or password");
            } else {
                toast.error(error.message || "Login failed");
            }
            throw error;
        }
    }

    const logout = () => {
        setAuthHeader("check", ""); // clear (using 'check' or any string is odd but ensures 'username' arg is fulfilled, logic clears if no password)
        // Actually setAuthHeader(username, nothing) calls removeItem
        setAuthHeader("logout");

        router.push("/login");
        toast.info("Logged out");
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
