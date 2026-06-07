"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import {
    Box,
    Calendar,
    Copy,
    Cpu,
    Image as ImageIcon,
    Layers,
    MessageSquare,
    Mic,
    MoreHorizontal,
    Pencil,
    ScanSearch,
    Trash2,
    Volume2,
} from "lucide-react"

import type { ModelDTO } from "@/lib/schemas/model"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

import { capabilityLabel } from "./capability-label"

interface ModelCardProps {
    model: ModelDTO
    /** When set (admin), surfaces an Edit menu item. */
    onEdit?: (model: ModelDTO) => void
    /** When set (admin), surfaces a Delete menu item (override rows only). */
    onDelete?: (model: ModelDTO) => void
}

const CAPABILITY_PRESENTATION: Record<
    string,
    { color: string; icon: React.ComponentType<{ className?: string }> }
> = {
    chat: { color: "text-blue-600 dark:text-blue-400", icon: MessageSquare },
    embedding: { color: "text-purple-600 dark:text-purple-400", icon: Layers },
    image: { color: "text-pink-600 dark:text-pink-400", icon: ImageIcon },
    "audio.speech": { color: "text-amber-600 dark:text-amber-400", icon: Volume2 },
    "audio.transcription": { color: "text-amber-600 dark:text-amber-400", icon: Mic },
    rerank: { color: "text-orange-600 dark:text-orange-400", icon: ScanSearch },
}

/** Dense model row used on provider detail pages. The card body is a
 *  link to the per-model dashboard; admin actions live in a dropdown so
 *  meta pills and the menu trigger never collide. */
export function ModelCard({ model, onEdit, onDelete }: ModelCardProps) {
    const presentation =
        CAPABILITY_PRESENTATION[model.type] ?? { color: "text-foreground", icon: Box }
    const TypeIcon = presentation.icon
    const canDelete = !!onDelete && !model.is_discovered
    const hasMenu = !!onEdit || canDelete
    const dashboardHref = `/models/${encodeURIComponent(model.name)}`

    return (
        <Card className="group/card relative bg-card border hover:border-primary/40 hover:shadow-sm transition-all p-0 overflow-hidden">
            <Link
                href={dashboardHref}
                className="block p-4 pr-12 space-y-2"
                aria-label={`Open ${model.name} dashboard`}
            >
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <h3
                        className="font-semibold text-sm leading-snug truncate min-w-0 flex-1"
                        title={model.name}
                    >
                        {model.name}
                    </h3>
                    {model.is_discovered ? (
                        <Badge
                            variant="secondary"
                            className="text-[9px] uppercase font-semibold tracking-wider shrink-0"
                        >
                            discovered
                        </Badge>
                    ) : (
                        <Badge
                            variant="outline"
                            className="text-[9px] uppercase font-semibold tracking-wider shrink-0"
                        >
                            override
                        </Badge>
                    )}
                </div>

                <ModelIdRow modelId={model.model_id ?? ""} />

                {model.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2">
                        {model.description}
                    </p>
                )}

                <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                    <MetaPill icon={TypeIcon} className={presentation.color}>
                        {capabilityLabel(model.type)}
                    </MetaPill>
                    {model.context_window != null && (
                        <MetaPill icon={Box}>{formatTokens(model.context_window)} ctx</MetaPill>
                    )}
                    {model.max_tokens != null && (
                        <MetaPill icon={Cpu}>{formatTokens(model.max_tokens)} out</MetaPill>
                    )}
                    {model.output_dimension != null && (
                        <MetaPill icon={Layers}>
                            {model.output_dimension.toLocaleString()} dim
                        </MetaPill>
                    )}
                    {model.knowledge_date && (
                        <MetaPill icon={Calendar}>{model.knowledge_date}</MetaPill>
                    )}
                </div>
            </Link>

            {hasMenu && (
                <div className="absolute top-3 right-3">
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 opacity-0 group-hover/card:opacity-100 data-[state=open]:opacity-100 transition-opacity"
                                onClick={(e) => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                }}
                            >
                                <MoreHorizontal className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                            align="end"
                            className="w-36"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {onEdit && (
                                <DropdownMenuItem onSelect={() => onEdit(model)}>
                                    <Pencil className="mr-2 h-3.5 w-3.5" />
                                    Edit
                                </DropdownMenuItem>
                            )}
                            {onEdit && canDelete && <DropdownMenuSeparator />}
                            {canDelete && (
                                <DropdownMenuItem
                                    className="text-destructive focus:text-destructive"
                                    onSelect={() => onDelete?.(model)}
                                >
                                    <Trash2 className="mr-2 h-3.5 w-3.5" />
                                    Delete
                                </DropdownMenuItem>
                            )}
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            )}
        </Card>
    )
}

function ModelIdRow({ modelId }: { modelId: string }) {
    if (!modelId) return null
    return (
        <div className="group/id flex items-center gap-1.5 text-[11px] text-muted-foreground font-mono">
            <span className="truncate" title={modelId}>
                {modelId}
            </span>
            <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 opacity-0 group-hover/id:opacity-100 transition-opacity shrink-0"
                onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    navigator.clipboard.writeText(modelId)
                    toast.success("Model ID copied to clipboard")
                }}
            >
                <Copy className="h-3 w-3" />
            </Button>
        </div>
    )
}

function MetaPill({
    icon: Icon,
    children,
    className,
}: {
    icon: React.ComponentType<{ className?: string }>
    children: React.ReactNode
    className?: string
}) {
    return (
        <span
            className={cn(
                "inline-flex items-center gap-1 rounded-md border bg-muted/40 px-1.5 py-0.5 text-[11px] font-mono leading-none",
                className
            )}
        >
            <Icon className="h-3 w-3" />
            {children}
        </span>
    )
}

function formatTokens(n: number): string {
    if (n >= 1000) return `${Math.round(n / 1000)}k`
    return n.toLocaleString()
}
