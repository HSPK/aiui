"use client"

import * as React from "react"
import {
    ArrowLeft,
    Beaker,
    Boxes,
    Code,
    Database,
    ExternalLink,
    Globe,
    Network,
    Search,
    Sparkles,
    Terminal,
} from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { mcpServers } from "@/lib/api"
import { useAuth } from "@/context/auth-context"
import type { McpPreset, McpPresetCategory, McpServerDTO } from "@/lib/schemas/mcp"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { LoadingState } from "@/components/ui/loading-state"
import { McpFormDialog } from "@/components/tools/mcp-form-dialog"
import { cn } from "@/lib/utils"

interface CategoryMeta {
    label: string
    icon: React.ElementType
}

const CATEGORIES: Record<McpPresetCategory, CategoryMeta> = {
    official: { label: "Official", icon: Sparkles },
    system: { label: "System", icon: Terminal },
    dev: { label: "Developer", icon: Code },
    academic: { label: "Academic", icon: Beaker },
    data: { label: "Data", icon: Database },
    web: { label: "Web", icon: Network },
    productivity: { label: "Productivity", icon: Boxes },
    community: { label: "Community", icon: Globe },
}

const CATEGORY_ORDER: McpPresetCategory[] = [
    "official",
    "system",
    "dev",
    "academic",
    "data",
    "web",
    "productivity",
    "community",
]

type FilterKey = "all" | McpPresetCategory

/** Catalogue page — searchable, category-filtered grid of preset
 *  cards. Cards open the existing McpFormDialog pre-filled, so the
 *  preset path is just "fill in the slots and save". The current
 *  /mcp listing is unchanged; this page lives as a sibling under
 *  /mcp/presets and links back via a small breadcrumb. */
export default function McpPresetsPage() {
    const { user } = useAuth()
    const router = useRouter()
    const isAdmin = user?.role === "admin"

    const { data: presets, isLoading: loadingPresets } = mcpServers.usePresets()
    const { data: installedServers } = mcpServers.useList()

    const [query, setQuery] = React.useState("")
    const [filter, setFilter] = React.useState<FilterKey>("all")
    const [preselect, setPreselect] = React.useState<McpPreset | null>(null)

    const installedNames = React.useMemo(
        () => new Set((installedServers ?? []).map((s) => s.name)),
        [installedServers],
    )

    const counts = React.useMemo(() => {
        const out: Record<FilterKey, number> = {
            all: 0,
            official: 0, system: 0, dev: 0, academic: 0,
            data: 0, web: 0, productivity: 0, community: 0,
        }
        for (const p of presets ?? []) {
            out.all += 1
            out[p.category] = (out[p.category] ?? 0) + 1
        }
        return out
    }, [presets])

    const visible = React.useMemo(() => {
        const all = presets ?? []
        const q = query.trim().toLowerCase()
        const matchesQuery = (p: McpPreset) => {
            if (!q) return true
            return (
                p.name.toLowerCase().includes(q)
                || p.description.toLowerCase().includes(q)
                || p.id.toLowerCase().includes(q)
            )
        }
        const matchesFilter = (p: McpPreset) => filter === "all" || p.category === filter
        return all.filter((p) => matchesFilter(p) && matchesQuery(p))
    }, [presets, query, filter])

    const grouped = React.useMemo(() => {
        const map = new Map<McpPresetCategory, McpPreset[]>()
        for (const p of visible) {
            const bucket = map.get(p.category) ?? []
            bucket.push(p)
            map.set(p.category, bucket)
        }
        return map
    }, [visible])

    return (
        <div className="h-full overflow-y-auto scrollbar-thin">
            <div className="mx-auto max-w-6xl px-4 md:px-6 py-4 md:py-6 space-y-5">
                <header className="space-y-3">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Link href="/mcp" className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
                            <ArrowLeft className="h-3 w-3" />
                            MCP servers
                        </Link>
                        <span>/</span>
                        <span className="text-foreground">Catalogue</span>
                    </div>
                    <h1 className="text-lg font-semibold leading-none">Preset catalogue</h1>

                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                        <Input
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Search…"
                            className="h-9 pl-8 text-sm"
                        />
                    </div>

                    <CategoryChips
                        active={filter}
                        onSelect={setFilter}
                        counts={counts}
                    />
                </header>

                {loadingPresets ? (
                    <div className="py-12 flex justify-center">
                        <LoadingState label="Loading catalogue…" />
                    </div>
                ) : visible.length === 0 ? (
                    <div className="py-12 text-center text-sm text-muted-foreground">
                        No presets match.
                    </div>
                ) : filter !== "all" ? (
                    <PresetGrid
                        presets={visible}
                        installedNames={installedNames}
                        onUse={isAdmin ? setPreselect : undefined}
                    />
                ) : (
                    // "All" view groups by category so the visual order
                    // matches the chip row.
                    <div className="space-y-6">
                        {CATEGORY_ORDER.map((cat) => {
                            const bucket = grouped.get(cat)
                            if (!bucket || bucket.length === 0) return null
                            const meta = CATEGORIES[cat]
                            const Icon = meta.icon
                            return (
                                <section key={cat} className="space-y-2.5">
                                    <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                        <Icon className="h-3.5 w-3.5" />
                                        {meta.label}
                                        <span className="text-[10px] font-mono text-muted-foreground/60">
                                            ({bucket.length})
                                        </span>
                                    </h2>
                                    <PresetGrid
                                        presets={bucket}
                                        installedNames={installedNames}
                                        onUse={isAdmin ? setPreselect : undefined}
                                    />
                                </section>
                            )
                        })}
                    </div>
                )}
            </div>

            <McpFormDialog
                open={!!preselect}
                onOpenChange={(open) => {
                    if (!open) setPreselect(null)
                }}
                mode="create"
                preset={preselect ?? undefined}
                onSaved={(server: McpServerDTO) => {
                    setPreselect(null)
                    router.push(`/mcp?selected=${encodeURIComponent(server.id)}`)
                }}
            />
        </div>
    )
}

function CategoryChips({
    active,
    onSelect,
    counts,
}: {
    active: FilterKey
    onSelect: (k: FilterKey) => void
    counts: Record<FilterKey, number>
}) {
    const items: Array<{ key: FilterKey; label: string; icon?: React.ElementType }> = [
        { key: "all", label: "All" },
        ...CATEGORY_ORDER.map((cat) => ({
            key: cat,
            label: CATEGORIES[cat].label,
            icon: CATEGORIES[cat].icon,
        })),
    ]
    return (
        <div className="flex flex-wrap gap-1">
            {items.map((it) => {
                const count = counts[it.key] ?? 0
                if (it.key !== "all" && count === 0) return null
                const Icon = it.icon
                const isActive = active === it.key
                return (
                    <button
                        key={it.key}
                        type="button"
                        onClick={() => onSelect(it.key)}
                        className={cn(
                            "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors",
                            // Match the tabs / settings-nav active state
                            // pattern: subtle bg-muted fill, no inverse
                            // colours. Inactive uses the project-wide
                            // hover:bg-muted/50 + muted text -> foreground.
                            isActive
                                ? "bg-muted font-medium text-foreground"
                                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                        )}
                    >
                        {Icon && <Icon className="h-3 w-3" />}
                        {it.label}
                        <span className="font-mono text-[10px] text-muted-foreground/70">
                            {count}
                        </span>
                    </button>
                )
            })}
        </div>
    )
}

function PresetGrid({
    presets,
    installedNames,
    onUse,
}: {
    presets: McpPreset[]
    installedNames: Set<string>
    onUse?: (p: McpPreset) => void
}) {
    return (
        <div className="grid gap-2.5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {presets.map((p) => (
                <PresetCard
                    key={p.id}
                    preset={p}
                    installed={installedNames.has(p.name)}
                    onUse={onUse}
                />
            ))}
        </div>
    )
}

function PresetCard({
    preset,
    installed,
    onUse,
}: {
    preset: McpPreset
    installed: boolean
    onUse?: (p: McpPreset) => void
}) {
    const meta = CATEGORIES[preset.category]
    const Icon = meta.icon
    return (
        <div className="rounded-lg border bg-card p-3 flex flex-col gap-2 hover:bg-muted/30 transition-colors">
            <div className="flex items-start gap-2 min-w-0">
                <span className="shrink-0 mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-md bg-muted/50 text-muted-foreground">
                    <Icon className="h-3.5 w-3.5" />
                </span>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-mono text-sm text-foreground truncate">
                            {preset.name}
                        </span>
                        <Badge variant="outline" className="text-[10px] uppercase font-mono">
                            {preset.transport}
                        </Badge>
                        {preset.slots.length > 0 && (
                            <Badge variant="secondary" className="text-[10px] font-mono">
                                {preset.slots.length} slot{preset.slots.length === 1 ? "" : "s"}
                            </Badge>
                        )}
                    </div>
                </div>
                {preset.homepage && (
                    <a
                        href={preset.homepage}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
                        title="Open homepage"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <ExternalLink className="h-3 w-3" />
                    </a>
                )}
            </div>

            <p className="text-xs text-muted-foreground line-clamp-2 leading-snug">
                {preset.description}
            </p>

            <div className="flex items-center justify-end gap-2 pt-1 mt-auto">
                {installed && (
                    <span className="text-[10px] text-muted-foreground mr-auto font-mono">
                        already installed
                    </span>
                )}
                {onUse && (
                    <Button
                        size="sm"
                        // `secondary` for installed: subtle gray fill +
                        // text-secondary-foreground stays readable on
                        // top of the card's hover:bg-muted/30 without
                        // the `outline` variant's text-accent-foreground
                        // swap (which composes poorly with parent hover).
                        variant={installed ? "secondary" : "default"}
                        className="h-7 text-xs"
                        onClick={() => onUse(preset)}
                    >
                        {installed ? "Add another" : "Use preset"}
                    </Button>
                )}
            </div>
        </div>
    )
}
