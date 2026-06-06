import type { ModelDTO } from "@/lib/schemas/model";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip"
import { Button } from "@/components/ui/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Copy, MoreHorizontal, Pencil, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import { capabilityLabel } from "./capability-label"
import { cn } from "@/lib/utils"

interface Props {
    models: ModelDTO[]
    onEdit?: (model: ModelDTO) => void
    onDelete?: (model: ModelDTO) => void
}

export function ModelsTable({ models, onEdit, onDelete }: Props) {
    const interactive = !!onEdit
    return (
        <Table>
            <TableHeader>
                <TableRow>
                    <TableHead>Model Name</TableHead>
                    <TableHead>ID</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Context</TableHead>
                    <TableHead>Source</TableHead>
                    {onDelete && <TableHead className="w-[40px]" />}
                </TableRow>
            </TableHeader>
            <TableBody>
                {models.map((model) => (
                    <TableRow
                        key={model.id || model.name}
                        onClick={interactive ? () => onEdit?.(model) : undefined}
                        className={cn(interactive && "cursor-pointer")}
                        title={interactive ? (model.is_discovered ? "Click to register override" : "Click to edit") : undefined}
                    >
                        <TableCell className="font-mono max-w-[300px]">
                            <div className="flex items-center justify-between gap-2 group w-full">
                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <span className="truncate cursor-default">{model.name}</span>
                                        </TooltipTrigger>
                                        <TooltipContent side="right" className="break-all">
                                            <p className="font-mono text-xs">{model.name}</p>
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        navigator.clipboard.writeText(model.name)
                                        toast.success("Model name copied to clipboard")
                                    }}
                                >
                                    <Copy className="h-3 w-3 text-muted-foreground" />
                                </Button>
                            </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{model.model_id}</TableCell>
                        <TableCell>
                            <Badge variant="outline">{model.provider}</Badge>
                        </TableCell>
                        <TableCell>
                            <Badge variant="outline">{capabilityLabel(model.type)}</Badge>
                        </TableCell>
                        <TableCell>
                            <Badge variant="outline">
                                {model.context_window
                                    ? (model.context_window >= 1000
                                        ? `${Math.round(model.context_window / 1000)}k`
                                        : model.context_window.toLocaleString())
                                    : '-'}
                            </Badge>
                        </TableCell>
                        <TableCell>
                            {model.is_discovered ? (
                                <Badge variant="secondary" className="text-[10px] uppercase font-semibold">discovered</Badge>
                            ) : (
                                <Badge variant="outline" className="text-[10px] uppercase font-semibold">override</Badge>
                            )}
                        </TableCell>
                        {/* Compact menu — only shows the actions that aren't covered by the
                            row click. Delete is destructive so we keep it explicit (and
                            require the menu so a stray row click doesn't trigger it). */}
                        {onDelete && (
                            <TableCell className="w-[40px] text-right" onClick={(e) => e.stopPropagation()}>
                                {!model.is_discovered && (
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button variant="ghost" size="icon" className="h-7 w-7">
                                                <MoreHorizontal className="h-4 w-4" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end" className="w-32">
                                            {onEdit && (
                                                <DropdownMenuItem onSelect={() => onEdit(model)}>
                                                    <Pencil className="mr-2 h-3.5 w-3.5" /> Edit
                                                </DropdownMenuItem>
                                            )}
                                            {onEdit && <DropdownMenuSeparator />}
                                            <DropdownMenuItem
                                                className="text-destructive focus:text-destructive"
                                                onSelect={() => onDelete(model)}
                                            >
                                                <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
                                            </DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                )}
                            </TableCell>
                        )}
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    )
}
