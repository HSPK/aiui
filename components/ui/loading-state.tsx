"use client"

import * as React from "react"
import { Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

interface LoadingStateProps {
    label?: React.ReactNode
    /** Visual size. Default "md". */
    size?: "sm" | "md" | "lg"
    /** Layout: "centered" fills its container (e.g. inside a card / panel);
     *  "inline" lays out horizontally for in-row use. Default "centered". */
    variant?: "centered" | "inline"
    className?: string
}

const SPINNER_SIZE: Record<NonNullable<LoadingStateProps["size"]>, string> = {
    sm: "h-3.5 w-3.5",
    md: "h-5 w-5",
    lg: "h-8 w-8",
}

/**
 * Single primitive for "loading…" UI everywhere a list/page/section is
 * waiting on data. Standardizes spinner glyph, animation, color, and
 * label placement so all pages look the same.
 */
export function LoadingState({
    label = "Loading…",
    size = "md",
    variant = "centered",
    className,
}: LoadingStateProps) {
    if (variant === "inline") {
        return (
            <div className={cn("flex items-center gap-2 text-sm text-muted-foreground", className)}>
                <Loader2 className={cn(SPINNER_SIZE[size], "animate-spin")} />
                {label && <span>{label}</span>}
            </div>
        )
    }
    return (
        <div
            className={cn(
                "flex flex-col items-center justify-center gap-3 py-12 text-muted-foreground",
                className,
            )}
        >
            <Loader2 className={cn(SPINNER_SIZE[size], "animate-spin")} />
            {label && <p className="text-sm">{label}</p>}
        </div>
    )
}
