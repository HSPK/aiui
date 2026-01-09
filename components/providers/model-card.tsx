import { ModelConfig } from "@/lib/types"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Copy, Box, Cpu, Calendar, MessageSquare, List } from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

interface ModelCardProps {
    model: ModelConfig;
}

export function ModelCard({ model }: ModelCardProps) {
    const isChat = model.type === "chat";
    const isEmbedding = model.type === "embedding";

    return (
        <Card className="flex flex-col md:flex-row items-start md:items-center p-4 gap-4 hover:bg-accent/5 transition-colors">
            <div className="flex-1 min-w-0 space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-base md:text-lg leading-none truncate" title={model.name}>
                        {model.name}
                    </h3>
                    <Badge
                        variant="secondary"
                        className={cn(
                            "capitalize text-[10px] px-1.5 h-5 pointer-events-none rounded-sm font-medium",
                            isChat && "bg-blue-500/10 text-blue-600 hover:bg-blue-500/15",
                            isEmbedding && "bg-purple-500/10 text-purple-600 hover:bg-purple-500/15"
                        )}
                    >
                        {isChat && <MessageSquare className="mr-1 h-3 w-3" />}
                        {isEmbedding && <List className="mr-1 h-3 w-3" />}
                        {model.type}
                    </Badge>
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
                    <p className="text-sm text-foreground/80 line-clamp-2 max-w-2xl">
                        {model.description}
                    </p>
                )}
            </div>

            <div className="flex items-center gap-6 shrink-0 w-full md:w-auto pt-2 md:pt-0 border-t md:border-t-0 mt-2 md:mt-0">
                <div className="grid grid-cols-2 md:flex md:items-center gap-x-8 gap-y-4 w-full md:w-auto">
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
