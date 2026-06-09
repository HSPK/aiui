"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"

import { useModalityStore } from "@/lib/stores/modality-store"
import { cn } from "@/lib/utils"
import { MODALITIES, isModalityActive } from "./modalities"

/**
 * Compact modality strip rendered INSIDE the topbar (desktop only)
 * when the user is on a `/playground/*` route. Replaces the second
 * row of chrome with an inline horizontal switcher styled to match
 * the surrounding topbar nav buttons:
 *
 *   - Active modality: icon + label, `bg-muted` (same active token as
 *     Dashboard / Logs / Providers / MCP — keeps the bar visually
 *     unified, no "special" segmented-control look)
 *   - Inactive modality: icon only, transparent bg, label via native
 *     tooltip; hover gives the same `hover:bg-muted/50` lift as the
 *     rest of the topbar
 *
 * That keeps the strip narrow enough to coexist with the primary nav
 * even on 1280-wide desktops, while sharing one design language with
 * the rest of the chrome.
 *
 * Each tab href resolves through `modalityPaths[id]` so clicking
 * Chat returns to the conversation you were in, Video returns to the
 * job you were polling, etc.
 */
export function TopbarModalityStrip() {
    const pathname = usePathname()
    const modalityPaths = useModalityStore((s) => s.modalityPaths)

    return (
        <div
            className={cn(
                "flex items-center gap-0.5 min-w-0 overflow-x-auto",
                "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            )}
            aria-label="Playground modalities"
        >
            {MODALITIES.map((m) => {
                const Icon = m.icon
                const active = isModalityActive(pathname, m)
                const accentText = m.accent.split(" ").find((c) => c.startsWith("text-"))
                if (m.disabled) {
                    return (
                        <span
                            key={m.id}
                            className="inline-flex items-center justify-center h-7 w-7 text-muted-foreground/40 cursor-not-allowed shrink-0"
                            title={`${m.title} (coming soon)`}
                            aria-disabled
                        >
                            <Icon className="h-3.5 w-3.5" />
                        </span>
                    )
                }
                const href = modalityPaths[m.id] ?? m.href
                return (
                    <Link
                        key={m.id}
                        href={href}
                        aria-current={active ? "page" : undefined}
                        title={m.title}
                        className={cn(
                            "inline-flex items-center gap-1.5 rounded-md h-7 text-xs whitespace-nowrap shrink-0 transition-colors",
                            active
                                ? "bg-muted text-foreground font-medium px-2"
                                : "text-muted-foreground hover:text-foreground hover:bg-muted/50 w-7 justify-center",
                        )}
                    >
                        <Icon className={cn("h-3.5 w-3.5", active && accentText)} />
                        {active && <span>{m.title}</span>}
                    </Link>
                )
            })}
        </div>
    )
}
