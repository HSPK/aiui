"use client"

import { cn } from "@/lib/utils"
import { ArrowRight, LucideIcon } from "lucide-react"

export interface Template {
    title: string
    description: string
    icon: LucideIcon
    action: () => void
    disabled: boolean
    gradient: string
    iconColor: string
}

interface TemplateCardProps {
    template: Template
}

export function TemplateCard({ template }: TemplateCardProps) {
    const Icon = template.icon

    return (
        <div
            onClick={!template.disabled ? template.action : undefined}
            className={cn(
                "group relative flex-shrink-0 rounded-xl border px-3 py-2.5 lg:px-4 lg:py-3 transition-all duration-200",
                template.disabled
                    ? "opacity-50 cursor-not-allowed bg-muted/30"
                    : "cursor-pointer hover:shadow-md hover:border-primary/50 bg-gradient-to-br " + template.gradient
            )}
        >
            <div className="flex items-center gap-3">
                <div className={cn(
                    "w-9 h-9 lg:w-10 lg:h-10 rounded-lg flex items-center justify-center shrink-0",
                    template.disabled ? "bg-muted" : "bg-background/80 backdrop-blur-sm shadow-sm"
                )}>
                    <Icon className={cn(
                        "h-4 w-4 lg:h-5 lg:w-5",
                        template.disabled ? "text-muted-foreground" : template.iconColor
                    )} />
                </div>
                <div className="min-w-0">
                    <h3 className="font-medium text-sm flex items-center gap-1.5 whitespace-nowrap">
                        {template.title}
                        {template.disabled && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                                Soon
                            </span>
                        )}
                        {!template.disabled && (
                            <ArrowRight className="h-3 w-3 opacity-0 -translate-x-1 transition-all group-hover:opacity-100 group-hover:translate-x-0" />
                        )}
                    </h3>
                    <p className="text-xs text-muted-foreground line-clamp-1 hidden lg:block">
                        {template.description}
                    </p>
                </div>
            </div>
        </div>
    )
}
