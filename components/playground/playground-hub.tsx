"use client"

import * as React from "react"
import Link from "next/link"
import {
    Sparkles,
    MessageSquare,
    Database,
    ImageIcon,
    Mic,
    Volume2,
    ListOrdered,
    Film,
    ArrowRight,
} from "lucide-react"

import { cn } from "@/lib/utils"

interface Modality {
    id: string
    title: string
    description: string
    icon: React.ElementType
    href: string
    accent: string
    disabled?: boolean
}

const MODALITIES: Modality[] = [
    {
        id: "chat",
        title: "Chat",
        description: "Multi-turn conversations across one or many models.",
        icon: MessageSquare,
        href: "/playground/chat",
        accent: "from-blue-500/20 to-cyan-500/20 text-blue-500",
    },
    {
        id: "embedding",
        title: "Embeddings",
        description: "Generate vector embeddings and inspect dimensions.",
        icon: Database,
        href: "/playground/embedding",
        accent: "from-emerald-500/20 to-green-500/20 text-emerald-500",
    },
    {
        id: "image",
        title: "Image generation",
        description: "Prompt-to-image via /v1/images/generations.",
        icon: ImageIcon,
        href: "/playground/image",
        accent: "from-pink-500/20 to-rose-500/20 text-pink-500",
        disabled: true,
    },
    {
        id: "audio-transcription",
        title: "Audio transcription",
        description: "Whisper-compatible speech-to-text.",
        icon: Mic,
        href: "/playground/audio/transcription",
        accent: "from-amber-500/20 to-orange-500/20 text-amber-500",
        disabled: true,
    },
    {
        id: "audio-speech",
        title: "Text to speech",
        description: "Synthesize audio from text via /v1/audio/speech.",
        icon: Volume2,
        href: "/playground/audio/speech",
        accent: "from-violet-500/20 to-purple-500/20 text-violet-500",
        disabled: true,
    },
    {
        id: "rerank",
        title: "Rerank",
        description: "Score and reorder documents against a query.",
        icon: ListOrdered,
        href: "/playground/rerank",
        accent: "from-teal-500/20 to-cyan-500/20 text-teal-500",
        disabled: true,
    },
    {
        id: "video",
        title: "Video generation",
        description: "Coming soon. Prompt-to-video.",
        icon: Film,
        href: "/playground/video",
        accent: "from-fuchsia-500/20 to-pink-500/20 text-fuchsia-500",
        disabled: true,
    },
]

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
