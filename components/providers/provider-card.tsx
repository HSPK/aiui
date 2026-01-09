import { ProviderConfig } from "@/lib/types"
import { Card, CardContent } from "@/components/ui/card"
import { ProviderIcon } from "@/components/ProviderIcon"
import { FileText, BookOpen, ChevronRight } from "lucide-react"
import { Badge } from "@/components/ui/badge"

interface ProviderCardProps {
    provider: ProviderConfig;
    onClick?: () => void;
}

export function ProviderCard({
    provider,
    onClick
}: ProviderCardProps) {
    return (
        <Card
            className="group relative transition-all duration-300 hover:shadow-lg border-muted/60 hover:border-primary/20 cursor-pointer bg-card flex flex-col justify-between"
            onClick={onClick}
        >
            <CardContent>
                <div className="flex justify-between items-start mb-2">
                    <div className="flex items-center gap-4">
                        {/* Logo Placeholder */}
                        <div className="h-10 w-10 shrink-0 flex items-center justify-center">
                            <ProviderIcon
                                providerName={provider.provider_name}
                                className="h-10 w-10 text-lg"
                                width={30}
                                height={30}
                            />
                        </div>

                        <div className="space-y-1">
                            <h3 className="font-bold text-base leading-none tracking-tight">{provider.provider_name}</h3>
                            <div className="flex items-center gap-2">
                                {/* Status Indicator */}
                                <div className="flex items-center gap-1.5">
                                    <span className="h-1 w-1 rounded-full ring-1 ring-offset-1 transition-colors duration-300 bg-green-500 ring-green-200" />
                                    <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
                                        Operational
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="text-right">
                        <div className="text-2xl font-bold tracking-tight text-foreground">{provider.n_models || 0}</div>
                        <div className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest mt-0.5">Models</div>
                    </div>
                </div>

                <div className="flex items-end justify-between">
                    <div className="flex flex-col gap-3">
                        {/* Action Icons */}
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

                        {/* Capability Badges / Endpoint */}
                        <Badge
                            variant="outline"
                            className="font-mono font-normal text-[10px] text-foreground/90  cursor-default transition-colors h-5 px-1.5 max-w-[160px] truncate block w-fit"
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
