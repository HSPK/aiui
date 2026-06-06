import type { ModelDTO } from "@/lib/schemas/model";
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Copy, Box, Cpu, Calendar, MessageSquare, Layers, ScanSearch, Image as ImageIcon, Mic, Volume2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { capabilityLabel } from "./capability-label"

interface ModelCardProps {
    model: ModelDTO;
}

// CapabilityDTO → (color, icon) — kept here in the UI layer so the registry stays
// transport-only on the server. Unknown capabilities fall back to a neutral
// box icon so the page never breaks when a new modality is added.
const CAPABILITY_PRESENTATION: Record<string, { color: string; icon: React.ComponentType<{ className?: string }> }> = {
    chat: { color: "text-blue-600 dark:text-blue-400", icon: MessageSquare },
    embedding: { color: "text-purple-600 dark:text-purple-400", icon: Layers },
    image: { color: "text-pink-600 dark:text-pink-400", icon: ImageIcon },
    "audio.speech": { color: "text-amber-600 dark:text-amber-400", icon: Volume2 },
    "audio.transcription": { color: "text-amber-600 dark:text-amber-400", icon: Mic },
    rerank: { color: "text-orange-600 dark:text-orange-400", icon: ScanSearch },
}

export function ModelCard({ model }: ModelCardProps) {
    const presentation = CAPABILITY_PRESENTATION[model.type] ?? { color: "text-foreground", icon: Box }
    const TypeIcon = presentation.icon

    return (
        <Card className="flex flex-col md:flex-row items-start md:items-center p-4 gap-4 bg-muted/10 border-transparent shadow-none hover:border-border hover:shadow-sm transition-all group/card">
            <div className="flex-1 min-w-0 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-base md:text-lg leading-snug truncate py-0.5" title={model.name}>
                        {model.name}
                    </h3>
                    {model.is_discovered ? (
                        <Badge variant="secondary" className="text-[9px] uppercase font-semibold tracking-wider">discovered</Badge>
                    ) : (
                        <Badge variant="outline" className="text-[9px] uppercase font-semibold tracking-wider">override</Badge>
                    )}
                    {model.schema_adapter_id && (
                        <Badge
                            variant="outline"
                            className="text-[9px] uppercase font-semibold tracking-wider border-amber-500/40 text-amber-700 dark:text-amber-300"
                            title={`Schema adapter override: ${model.schema_adapter_id}`}
                        >
                            schema: {model.schema_adapter_id}
                        </Badge>
                    )}
                </div>

                <div className="group flex items-center gap-1.5 text-xs text-muted-foreground font-mono">
                    <span className="truncate max-w-[300px]" title={model.model_id || ""}>
                        {model.model_id}
                    </span>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => {
                            navigator.clipboard.writeText(model.model_id || "")
                            toast.success("Model ID copied to clipboard")
                        }}
                    >
                        <Copy className="h-3 w-3" />
                    </Button>
                </div>

                {model.description && (
                    <p className="text-sm text-muted-foreground/80 line-clamp-2 max-w-2xl">
                        {model.description}
                    </p>
                )}
            </div>

            <div className="flex items-center gap-6 shrink-0 w-full md:w-auto pt-2 md:pt-0 border-t md:border-t-0 mt-2 md:mt-0">
                <div className="grid grid-cols-2 md:flex md:items-center gap-x-6 gap-y-4 w-full md:w-auto">
                    <div className="flex flex-col md:items-end gap-0.5">
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1">
                            <TypeIcon className="h-3 w-3" /> Type
                        </span>
                        <span className={cn("font-mono text-sm font-medium", presentation.color)}>
                            {capabilityLabel(model.type)}
                        </span>
                    </div>

                    {(model.context_window !== null && model.context_window !== undefined) && (
                        <div className="flex flex-col md:items-end gap-0.5">
                            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1">
                                <Box className="h-3 w-3" /> Context
                            </span>
                            <span className="font-mono text-sm">
                                {model.context_window >= 1000
                                    ? `${Math.round(model.context_window / 1000)}k`
                                    : model.context_window.toLocaleString()}
                            </span>
                        </div>
                    )}

                    {(model.max_tokens !== null && model.max_tokens !== undefined) && (
                        <div className="flex flex-col md:items-end gap-0.5">
                            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1">
                                <Cpu className="h-3 w-3" /> Max Output
                            </span>
                            <span className="font-mono text-sm">
                                {model.max_tokens >= 1000
                                    ? `${Math.round(model.max_tokens / 1000)}k`
                                    : model.max_tokens.toLocaleString()}
                            </span>
                        </div>
                    )}

                    {(model.output_dimension !== null && model.output_dimension !== undefined) && (
                        <div className="flex flex-col md:items-end gap-0.5">
                            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1">
                                <Layers className="h-3 w-3" /> Dim
                            </span>
                            <span className="font-mono text-sm">
                                {model.output_dimension.toLocaleString()}
                            </span>
                        </div>
                    )}

                    {model.knowledge_date && (
                        <div className="flex flex-col md:items-end gap-0.5">
                            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1">
                                <Calendar className="h-3 w-3" /> Knowledge
                            </span>
                            <span className="font-mono text-sm">
                                {model.knowledge_date}
                            </span>
                        </div>
                    )}
                </div>
            </div>
        </Card>
    )
}
