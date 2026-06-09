"use client"

import * as React from "react"
import Link from "next/link"
import { Sparkles, ArrowRight } from "lucide-react"

import { cn } from "@/lib/utils"
import { MODALITIES, type Modality } from "./modalities"

function ModalityCard({ modality }: { modality: Modality }) {
    const Icon = modality.icon
    const inner = (
        <div
            className={cn(
                "group relative h-full rounded-xl border p-4 transition-all",
                modality.disabled
                    ? "opacity-60 cursor-not-allowed bg-muted/20"
                    : "hover:border-primary/50 hover:shadow-md cursor-pointer bg-card"
            )}
        >
            <div className="flex items-start gap-3">
                <div
                    className={cn(
                        "flex h-10 w-10 items-center justify-center rounded-lg shrink-0 bg-gradient-to-br",
                        modality.accent.split(" ").filter((c) => !c.startsWith("text-")).join(" ")
                    )}
                >
                    <Icon
                        className={cn(
                            "h-5 w-5",
                            modality.accent.split(" ").find((c) => c.startsWith("text-"))
                        )}
                    />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                        <h3 className="font-medium text-sm">{modality.title}</h3>
                        {modality.disabled && (
                            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                                Soon
                            </span>
                        )}
                        {!modality.disabled && (
                            <ArrowRight className="h-3 w-3 opacity-0 -translate-x-1 transition-all group-hover:opacity-100 group-hover:translate-x-0" />
                        )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                        {modality.description}
                    </p>
                </div>
            </div>
        </div>
    )
    return modality.disabled ? inner : <Link href={modality.href}>{inner}</Link>
}

export function PlaygroundHub() {
    return (
        <div className="h-full overflow-y-auto">
            <div className="mx-auto w-full max-w-5xl space-y-6 p-4 md:p-8">
                <div className="space-y-1">
                    <div className="flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-primary" />
                        <h1 className="text-lg font-semibold tracking-tight">Playground</h1>
                    </div>
                    <p className="text-sm text-muted-foreground">
                        Test any capability over your registered providers. Pick a modality to begin.
                    </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {MODALITIES.map((m) => (
                        <ModalityCard key={m.id} modality={m} />
                    ))}
                </div>
            </div>
        </div>
    )
}
