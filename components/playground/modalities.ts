import {
    MessageSquare,
    Database,
    ImageIcon,
    Mic,
    Volume2,
    ListOrdered,
    Film,
} from "lucide-react"

/**
 * Single source of truth for playground modalities. Imported by:
 *   - `components/Topbar.tsx` (Playground dropdown)
 *   - `components/playground/modality-nav.tsx` (inline tab bar)
 *   - `components/playground/playground-hub.tsx` (discovery cards)
 *
 * Order here is the display order in every surface. Disabled
 * entries are still rendered as greyed-out (with a "Soon" badge in
 * the hub) so users see the roadmap without having to navigate.
 */

export interface Modality {
    id: string
    title: string
    description: string
    icon: React.ElementType
    href: string
    /** Tailwind gradient + text color tokens — "from-X to-Y text-Z". */
    accent: string
    disabled?: boolean
}

export const MODALITIES: Modality[] = [
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
    },
    {
        id: "audio-transcription",
        title: "Audio transcription",
        description: "Whisper-compatible speech-to-text.",
        icon: Mic,
        href: "/playground/audio/transcription",
        accent: "from-amber-500/20 to-orange-500/20 text-amber-500",
    },
    {
        id: "audio-speech",
        title: "Text to speech",
        description: "Synthesize audio from text via /v1/audio/speech.",
        icon: Volume2,
        href: "/playground/audio/speech",
        accent: "from-violet-500/20 to-purple-500/20 text-violet-500",
    },
    {
        id: "video",
        title: "Video generation",
        description: "Sora-compatible text-to-video with status polling.",
        icon: Film,
        href: "/playground/video",
        accent: "from-fuchsia-500/20 to-pink-500/20 text-fuchsia-500",
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
]

/** Default landing modality when a user clicks "Playground" without
 *  picking a specific one. Chat is by far the most common entry point. */
export const DEFAULT_MODALITY_HREF = "/playground/chat"

/** True when the given pathname matches the modality's href, treating
 *  trailing segments as the same modality (so `/playground/chat?c=…`
 *  highlights `Chat` and `/playground/audio/transcription/foo` highlights
 *  `Audio transcription`). */
export function isModalityActive(pathname: string, modality: Modality): boolean {
    return pathname === modality.href || pathname.startsWith(modality.href + "/")
}

/** Find the modality the current path falls under, if any. */
export function modalityFromPath(pathname: string): Modality | undefined {
    return MODALITIES.find((m) => isModalityActive(pathname, m))
}
