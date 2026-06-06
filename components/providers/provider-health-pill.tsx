import type { ProviderDTO } from "@/lib/schemas/provider";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

/**
 * Provider health pill.
 *
 * Visibility & color rules (single source of truth — used by both the
 * card grid and the per-provider detail page):
 *   - No `health_check_url`        → render nothing. We have no signal,
 *                                    so claiming Operational would be a lie.
 *   - URL set, status === "ok"     → green "Operational".
 *   - URL set, status === "down"   → red   "Down" + tooltip with error.
 *   - URL set, status === null     → grey  "Unchecked" (never probed).
 *
 * Two `size` variants share the same logic so the card row stays compact
 * and the detail page stays prominent.
 */
type Size = "sm" | "md";

const STATUS = {
    ok: {
        label: "Operational",
        dot: "bg-green-500 ring-green-200",
        text: "text-green-600 dark:text-green-400",
    },
    down: {
        label: "Down",
        dot: "bg-red-500 ring-red-200",
        text: "text-red-600 dark:text-red-400",
    },
    unchecked: {
        label: "Unchecked",
        dot: "bg-muted-foreground/40 ring-muted-foreground/10",
        text: "text-muted-foreground",
    },
} as const;

export function ProviderHealthPill({
    provider,
    size = "sm",
}: {
    provider: Pick<ProviderDTO, "health_check_url" | "last_health_status" | "last_health_checked_at" | "last_health_error">;
    size?: Size;
}) {
    if (!provider.health_check_url) return null;

    const key = provider.last_health_status ?? "unchecked";
    const s = STATUS[key];

    const inner = (
        <div className="flex items-center gap-1.5">
            <span
                className={cn(
                    "rounded-full ring-1 ring-offset-1 transition-colors duration-300",
                    size === "sm" ? "h-1 w-1" : "h-1.5 w-1.5",
                    s.dot,
                )}
            />
            <span
                className={cn(
                    "font-medium uppercase tracking-wide",
                    size === "sm" ? "text-[10px]" : "text-xs",
                    s.text,
                )}
            >
                {s.label}
            </span>
        </div>
    );

    // Tooltip only when there's something useful to show.
    const tooltipBody = tooltipFor(provider);
    if (!tooltipBody) return inner;

    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>{inner}</TooltipTrigger>
                <TooltipContent side="top" className="max-w-[280px] break-words">
                    {tooltipBody}
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
}

function tooltipFor(
    provider: Pick<ProviderDTO, "last_health_status" | "last_health_checked_at" | "last_health_error">,
): React.ReactNode {
    const when = provider.last_health_checked_at;
    if (provider.last_health_status === "down") {
        return (
            <div className="space-y-1 text-xs">
                <div className="font-semibold">Health check failed</div>
                {provider.last_health_error && (
                    <div className="font-mono text-[11px] opacity-80">{provider.last_health_error}</div>
                )}
                {when && <div className="opacity-60">Last checked: {new Date(when).toLocaleString()}</div>}
            </div>
        );
    }
    if (provider.last_health_status === "ok" && when) {
        return <div className="text-xs">Last checked: {new Date(when).toLocaleString()}</div>;
    }
    if (!provider.last_health_status) {
        return <div className="text-xs">Provider has a health-check URL but has not been probed yet.</div>;
    }
    return null;
}
