import { ModelConfig } from "@/lib/types"
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
import { Copy, Pencil, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"

interface Props {
    models: ModelConfig[]
    onEdit?: (model: ModelConfig) => void
    onDelete?: (model: ModelConfig) => void
}

export function ModelsTable({ models, onEdit, onDelete }: Props) {
    const showActions = !!(onEdit || onDelete)
    return (
        <Table>
            <TableHeader>
                <TableRow>
                    <TableHead>Model Name</TableHead>
                    <TableHead>ID</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Context</TableHead>
                    {showActions && <TableHead className="w-[100px] text-right">Actions</TableHead>}
                </TableRow>
            </TableHeader>
            <TableBody>
                {models.map((model) => (
                    <TableRow key={model.id || model.name}>
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
                                    onClick={() => {
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
                            <Badge variant="outline">{model.type}</Badge>
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
                        {showActions && (
                            <TableCell className="text-right">
                                <div className="flex justify-end gap-1">
                                    {onEdit && (
                                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit(model)} title="Edit">
                                            <Pencil className="h-3.5 w-3.5" />
                                        </Button>
                                    )}
                                    {onDelete && (
                                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => onDelete(model)} title="Delete">
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </Button>
                                    )}
                                </div>
                            </TableCell>
                        )}
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    )
}
