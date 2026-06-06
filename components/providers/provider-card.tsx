import type { ProviderDTO } from "@/lib/schemas/provider";
import { Card, CardContent } from "@/components/ui/card"
import { ProviderIcon } from "@/components/ProviderIcon"
import { FileText, BookOpen, ChevronRight } from "lucide-react"
import { Badge } from "@/components/ui/badge"

interface ProviderCardProps {
    provider: ProviderDTO;
    onClick?: () => void;
    /**
     * Right-hand slot rendered in place of the n_models badge on hover.
     * Used by the providers page to inject admin edit/delete buttons
     * without overlaying the count box.
     */
    hoverActions?: React.ReactNode;
}

export function ProviderCard({
    provider,
    onClick,
    hoverActions,
}: ProviderCardProps) {
    return (
        <Card
            className="group relative transition-all duration-300 hover:shadow-lg border-muted/60 hover:border-primary/20 cursor-pointer bg-card flex flex-col justify-between"
            onClick={onClick}
        >
            <CardContent>
                <div className="flex justify-between items-start mb-2 gap-3">
                    <div className="flex items-center gap-4 min-w-0">
                        {/* Logo */}
                        <div className="h-10 w-10 shrink-0 flex items-center justify-center">
                            <ProviderIcon
                                providerName={provider.provider_name}
                                className="h-10 w-10 text-lg"
                                width={30}
                                height={30}
                            />
                        </div>

                        <div className="space-y-1 min-w-0">
                            <h3 className="font-bold text-base leading-none tracking-tight truncate" title={provider.provider_name}>{provider.provider_name}</h3>
                            <div className="flex items-center gap-2">
                                <div className="flex items-center gap-1.5">
                                    <span className="h-1 w-1 rounded-full ring-1 ring-offset-1 transition-colors duration-300 bg-green-500 ring-green-200" />
                                    <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
                                        Operational
                                    </span>
                                </div>
                                {provider.adapter_id && provider.adapter_id !== "openai" && (
                                    <Badge variant="secondary" className="text-[9px] uppercase font-semibold h-4 px-1.5 tracking-wider">
                                        {provider.adapter_id.replace(/^azure-/, "Azure ")}
                                    </Badge>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Top-right slot: shows model count by default; if hoverActions
                        is supplied, swap to it on group hover. Both share the same
                        bounding box, so they never overlap. */}
                    <div className="shrink-0 relative h-10 min-w-[64px] flex items-start justify-end">
                        <div className={`text-right transition-opacity duration-200 ${hoverActions ? "group-hover:opacity-0" : ""}`}>
                            <div className="text-2xl font-bold tracking-tight text-foreground leading-none">{provider.n_models ?? 0}</div>
                            <div className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest mt-1">Models</div>
                        </div>
                        {hoverActions && (
                            <div className="absolute right-0 top-0 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                {hoverActions}
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex items-end justify-between">
                    <div className="flex flex-col gap-3">
                        {/* External-link icons */}
                        <div className="flex gap-3">
                            {provider.model_page ? (
                                <a
                                    href={provider.model_page}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-muted-foreground/60 hover:text-primary transition-colors p-0.5"
                                    onClick={(e) => e.stopPropagation()}
                                    title="View Models"
                                >
                                    <FileText className="h-4 w-4" strokeWidth={1.5} />
                                </a>
                            ) : <FileText className="h-4 w-4 text-muted-foreground/20 cursor-not-allowed" strokeWidth={1.5} />}

                            {provider.document_page ? (
                                <a
                                    href={provider.document_page}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-muted-foreground/60 hover:text-primary transition-colors p-0.5"
                                    onClick={(e) => e.stopPropagation()}
                                    title="Documentation"
                                >
                                    <BookOpen className="h-4 w-4" strokeWidth={1.5} />
                                </a>
                            ) : <BookOpen className="h-4 w-4 text-muted-foreground/20 cursor-not-allowed" strokeWidth={1.5} />}
                        </div>

                        {/* Endpoint badge */}
                        <Badge
                            variant="outline"
                            className="font-mono font-normal text-[10px] text-foreground/90 cursor-default transition-colors h-5 px-1.5 max-w-[180px] truncate block w-fit"
                            title={`Endpoint: ${provider.proxy}`}
                            onClick={(e) => e.stopPropagation()}
                        >
                            {provider.proxy}
                        </Badge>
                    </div>

                    {/* Arrow */}
                    <div className="opacity-0 group-hover:opacity-100 transition-all duration-300 transform -translate-x-2 group-hover:translate-x-0 pb-0.5">
                        <ChevronRight className="h-4 w-4 text-muted-foreground/80" />
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}
