"use client"

import * as React from "react"
import { AlertTriangle, RefreshCcw } from "lucide-react"
import { Button } from "@/components/ui/button"

/**
 * Dashboard-scoped error boundary. Catches client-render exceptions
 * (e.g. a bad message payload that crashes ChatMessage) and shows a
 * recoverable inline panel instead of the white-screen Next.js
 * fallback. Each segment under `(dashboard)/` opts into this via
 * the App Router error.tsx convention.
 */
export default function DashboardError({
    error,
    reset,
}: {
    error: Error & { digest?: string }
    reset: () => void
}) {
    React.useEffect(() => {
        // Surface to the browser console with the Next digest so the
        // user can quote it in a bug report. We deliberately do NOT
        // ship a third-party telemetry pipeline here — that's a
        // product decision the operator can layer on.
        console.error("[loom] dashboard segment crashed:", error)
    }, [error])

    return (
        <div className="flex h-full w-full items-center justify-center p-6 bg-background">
            <div className="max-w-md w-full space-y-4 rounded-lg border border-destructive/30 bg-destructive/5 p-6">
                <div className="flex items-center gap-3">
                    <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
                    <h2 className="text-base font-semibold text-foreground">
                        Something went wrong
                    </h2>
                </div>
                <p className="text-sm text-muted-foreground break-words">
                    {error.message || "An unexpected error occurred."}
                </p>
                {error.digest && (
                    <p className="text-[11px] text-muted-foreground/70 font-mono">
                        digest: {error.digest}
                    </p>
                )}
                <div className="flex items-center gap-2 pt-1">
                    <Button onClick={reset} size="sm" className="gap-1.5">
                        <RefreshCcw className="h-3.5 w-3.5" />
                        Try again
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => { window.location.href = "/" }}
                    >
                        Back to dashboard
                    </Button>
                </div>
            </div>
        </div>
    )
}
