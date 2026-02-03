"use client"

import { Button } from "@/components/ui/button"
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip"
import { RefreshCcw, Loader2 } from "lucide-react"

interface RefreshButtonProps {
    onClick: () => void
    isLoading?: boolean
    tooltip?: string
    className?: string
}

export function RefreshButton({
    onClick,
    isLoading,
    tooltip = "Refresh",
    className,
}: RefreshButtonProps) {
    return (
        <TooltipProvider delayDuration={300}>
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={onClick}
                        disabled={isLoading}
                        className={`h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors ${className || ""}`}
                    >
                        {isLoading ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <RefreshCcw className="h-4 w-4" />
                        )}
                    </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                    {tooltip}
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    )
}
