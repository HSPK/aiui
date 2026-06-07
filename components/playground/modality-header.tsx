"use client"

import * as React from "react"
import Link from "next/link"
import { ChevronLeft } from "lucide-react"

import { cn } from "@/lib/utils"

interface ModalityHeaderProps {
    title: string
    description?: React.ReactNode
    icon?: React.ElementType
    accent?: string
    actions?: React.ReactNode
    className?: string
}

/** Small breadcrumb-style header shared by non-chat playground pages.
 *  Keeps the page chrome minimal — topbar already supplies the global
 *  navigation context; this just identifies which modality you're in
 *  and offers a way back to the hub. */
export function ModalityHeader({
    title,
    description,
    icon: Icon,
    accent,
    actions,
    className,
}: ModalityHeaderProps) {
    return (
        <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between", className)}>
            <div className="min-w-0 space-y-1">
                <Link
                    href="/playground"
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                    <ChevronLeft className="h-3 w-3" />
                    Playground
                </Link>
                <div className="flex items-center gap-2">
                    {Icon && (
                        <span
                            className={cn(
                                "flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br",
                                accent ?? "from-primary/20 to-primary/5"
                            )}
                        >
                            <Icon className="h-3.5 w-3.5" />
                        </span>
                    )}
                    <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
                </div>
                {description && (
                    <p className="text-xs text-muted-foreground">{description}</p>
                )}
            </div>
            {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </div>
    )
}
