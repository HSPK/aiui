"use client"

import * as React from "react"
import { usePathname, useSearchParams } from "next/navigation"

import { modalityFromPath } from "@/components/playground/modalities"
import { useModalityStore } from "@/lib/stores/modality-store"

/**
 * Shared chrome for every `/playground/*` page:
 *   - Records full `pathname?search` to `lastPath` + `modalityPaths[id]`
 *     so the topbar and any in-page surfaces resume the user's exact
 *     workflow (chat conversation, video job, etc.).
 *   - Desktop: no secondary chrome — the topbar's
 *     `TopbarModalityStrip` handles modality switching inline.
 *   - Mobile: no secondary chrome either — the hamburger sheet
 *     already nests every modality as a sub-list, and the bare
 *     `/playground` hub page itself doubles as a discovery / picker
 *     surface (large modality cards). One source of truth for mobile
 *     modality navigation avoids the duplicate-row clutter.
 *
 * So this layout is now pure plumbing — it tracks the user's location
 * and renders children. Chrome lives entirely in the topbar.
 */
export default function PlaygroundLayout({ children }: { children: React.ReactNode }) {
    const pathname = usePathname()
    const searchParams = useSearchParams()
    const setLastPath = useModalityStore((s) => s.setLastPath)
    const setModalityPath = useModalityStore((s) => s.setModalityPath)

    React.useEffect(() => {
        if (!pathname || !pathname.startsWith("/playground/")) return
        const search = searchParams?.toString() ?? ""
        const full = search ? `${pathname}?${search}` : pathname
        setLastPath(full)
        const modality = modalityFromPath(pathname)
        if (modality) setModalityPath(modality.id, full)
    }, [pathname, searchParams, setLastPath, setModalityPath])

    return <div className="flex h-full flex-col overflow-hidden">{children}</div>
}
