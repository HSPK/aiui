import * as React from "react"
import { cn } from "@/lib/utils"

interface PageHeaderProps {
    title: React.ReactNode
    description?: React.ReactNode
    actions?: React.ReactNode
    className?: string
    /** Render a smaller header (h2 + smaller spacing) for sub-pages. */
    compact?: boolean
}

/**
 * Common page header used across dashboard pages. Provides consistent spacing,
 * type scale, and an actions slot so individual pages don't reinvent it.
 *
 *   <PageHeader
 *     title="API Keys"
 *     description="Use these keys with any OpenAI-compatible client."
 *     actions={<Button>Create Key</Button>}
 *   />
 */
export function PageHeader({ title, description, actions, className, compact }: PageHeaderProps) {
    return (
        <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between", className)}>
            <div className="min-w-0">
                {compact ? (
                    <h2 className="text-xl font-semibold tracking-tight truncate">{title}</h2>
                ) : (
                    <h2 className="text-3xl font-bold tracking-tight">{title}</h2>
                )}
                {description && (
                    <p className="text-muted-foreground text-sm mt-1">{description}</p>
                )}
            </div>
            {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
        </div>
    )
}
