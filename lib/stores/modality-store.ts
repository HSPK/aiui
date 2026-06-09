import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

import type {
    ImageGenerationResponse,
    TranscriptionResponse,
    VideoJob,
} from "@/lib/api/gateway";
import type {
    PlaygroundEmbeddingParams,
    PlaygroundEmbeddingResult,
} from "@/lib/schemas/playground";

/**
 * Cross-modality workflow state. Each modality keeps the user's
 * latest inputs + result so navigating away and back via the inline
 * modality nav restores the workflow in place — no lost prompts, no
 * lost generations.
 *
 * Persistence strategy:
 *   - Inputs (model, prompt, params, text, query, docs) → persisted to
 *     localStorage; survive across page reloads.
 *   - Results (image / video / transcription / embedding payloads) →
 *     in-memory only via Zustand singleton; survive across component
 *     remounts (modality navigation) but NOT across full page reloads.
 *     This keeps localStorage well under quota — image / TTS results
 *     can be multi-MB.
 *   - File / Blob objects (transcription audio file, TTS audio blob,
 *     video reference image) → component-local only. Not stored here
 *     because File can't be serialised to JSON. Re-attaching is a
 *     small cost vs the risk of blowing past localStorage quotas.
 *
 * One store, multiple slices — picking up new playgrounds is just
 * appending a new slice + plumbing the partialize filter.
 */

// =============================================================================
// Slice shapes
// =============================================================================

export interface ImageParams {
    n: number
    size?: string
    quality?: string
    style?: string
    response_format?: "url" | "b64_json"
    output_format?: "png" | "jpeg" | "webp"
    background?: "transparent" | "opaque" | "auto"
}

export interface ImageSlice {
    model: string | null
    prompt: string
    params: ImageParams
    /** In-memory only — large b64 payloads, persisting kills localStorage. */
    result: ImageGenerationResponse | null
    error: string | null
}

export interface SpeechParams {
    voice: string
    response_format: "mp3" | "opus" | "aac" | "flac" | "wav" | "pcm"
    speed: number
    instructions?: string
}

export interface SpeechResult {
    /** ObjectURL is in-memory only, regenerated when blob is restored. */
    url: string
    format: SpeechParams["response_format"]
    bytes: number
    elapsed_ms: number
}

export interface SpeechSlice {
    model: string | null
    text: string
    params: SpeechParams
    /** Result + blob are in-memory only. */
    result: SpeechResult | null
    error: string | null
}

export interface TranscriptionParams {
    language?: string
    prompt?: string
    response_format: "json" | "text" | "srt" | "verbose_json" | "vtt"
    temperature?: number
}

export interface TranscriptionResult {
    payload: TranscriptionResponse | string
    format: TranscriptionParams["response_format"]
    file_name: string
    file_bytes: number
    elapsed_ms: number
}

export interface TranscriptionSlice {
    model: string | null
    params: TranscriptionParams
    /** Result preserved across nav; file itself stays component-local. */
    result: TranscriptionResult | null
    error: string | null
}

export interface VideoParams {
    seconds?: string
    size?: string
}

export interface VideoSlice {
    model: string | null
    prompt: string
    params: VideoParams
    /** The most recent submitted job — kept in-memory so polling can
     *  resume / status stays visible across modality switches. */
    job: VideoJob | null
    error: string | null
}

export interface EmbeddingSlice {
    modelIds: string[]
    query: string
    docsText: string
    params: PlaygroundEmbeddingParams
    /** In-memory only — embedding vector arrays can be large. */
    result: PlaygroundEmbeddingResult | null
    error: string | null
}

// =============================================================================
// Defaults
// =============================================================================

export const DEFAULT_IMAGE_PARAMS: ImageParams = { n: 1 }
export const DEFAULT_SPEECH_PARAMS: SpeechParams = {
    voice: "alloy",
    response_format: "mp3",
    speed: 1,
}
export const DEFAULT_TRANSCRIPTION_PARAMS: TranscriptionParams = {
    response_format: "verbose_json",
}
export const DEFAULT_VIDEO_PARAMS: VideoParams = {}

const initialImage: ImageSlice = {
    model: null,
    prompt: "",
    params: DEFAULT_IMAGE_PARAMS,
    result: null,
    error: null,
}
const initialSpeech: SpeechSlice = {
    model: null,
    text: "",
    params: DEFAULT_SPEECH_PARAMS,
    result: null,
    error: null,
}
const initialTranscription: TranscriptionSlice = {
    model: null,
    params: DEFAULT_TRANSCRIPTION_PARAMS,
    result: null,
    error: null,
}
const initialVideo: VideoSlice = {
    model: null,
    prompt: "",
    params: DEFAULT_VIDEO_PARAMS,
    job: null,
    error: null,
}
const initialEmbedding: EmbeddingSlice = {
    modelIds: [],
    query: "",
    docsText: "",
    params: {},
    result: null,
    error: null,
}

// =============================================================================
// Store
// =============================================================================

interface ModalityStoreState {
    image: ImageSlice
    speech: SpeechSlice
    transcription: TranscriptionSlice
    video: VideoSlice
    embedding: EmbeddingSlice

    /** Most-recent `/playground/*` URL (pathname + search) — drives the
     *  topbar "Playground" link so it re-enters wherever the user
     *  left off. Persisted. */
    lastPath: string | null

    /** Per-modality last URL — drives the inline modality nav tabs so
     *  clicking e.g. "Chat" from another modality returns to the exact
     *  conversation the user was reading, not a fresh chat. Keys are
     *  modality.id (`chat`, `image`, …). Persisted. */
    modalityPaths: Record<string, string>

    /** Modality tab nav collapsed state. Persisted across page loads;
     *  power users tend to hide chrome to maximise their workspace. */
    navCollapsed: boolean

    /** Per-conversation scroll offset for the chat playground. Restored
     *  when the user navigates back to chat so the conversation picks
     *  up exactly where they left reading, not at the bottom. */
    chatScrollOffsets: Record<string, number>

    /** Mobile-only: controls the conversation-history Sheet. Lifted to
     *  the store so the trigger can live in the topbar (contextual to
     *  the chat page) while the Sheet itself lives in
     *  ConversationSidebar. */
    chatHistoryOpen: boolean

    setLastPath: (path: string) => void
    setModalityPath: (modalityId: string, path: string) => void
    setNavCollapsed: (collapsed: boolean) => void
    toggleNav: () => void

    setChatScrollOffset: (conversationId: string, offset: number) => void
    getChatScrollOffset: (conversationId: string) => number | undefined

    setChatHistoryOpen: (open: boolean) => void

    patchImage: (patch: Partial<ImageSlice>) => void
    resetImage: () => void

    patchSpeech: (patch: Partial<SpeechSlice>) => void
    resetSpeech: () => void

    patchTranscription: (patch: Partial<TranscriptionSlice>) => void
    resetTranscription: () => void

    patchVideo: (patch: Partial<VideoSlice>) => void
    resetVideo: () => void

    patchEmbedding: (patch: Partial<EmbeddingSlice>) => void
    resetEmbedding: () => void
}

export const useModalityStore = create<ModalityStoreState>()(
    persist(
        (set, get) => ({
            image: initialImage,
            speech: initialSpeech,
            transcription: initialTranscription,
            video: initialVideo,
            embedding: initialEmbedding,
            lastPath: null,
            modalityPaths: {},
            navCollapsed: false,
            chatScrollOffsets: {},
            chatHistoryOpen: false,

            setLastPath: (path) => set({ lastPath: path }),
            setModalityPath: (modalityId, path) =>
                set((s) => ({
                    modalityPaths: { ...s.modalityPaths, [modalityId]: path },
                })),
            setNavCollapsed: (collapsed) => set({ navCollapsed: collapsed }),
            toggleNav: () => set((s) => ({ navCollapsed: !s.navCollapsed })),

            setChatScrollOffset: (id, offset) =>
                set((s) => ({
                    chatScrollOffsets: { ...s.chatScrollOffsets, [id]: offset },
                })),
            getChatScrollOffset: (id) => get().chatScrollOffsets[id],

            setChatHistoryOpen: (open) => set({ chatHistoryOpen: open }),

            patchImage: (patch) =>
                set((s) => ({ image: { ...s.image, ...patch } })),
            resetImage: () => set({ image: initialImage }),

            patchSpeech: (patch) =>
                set((s) => ({ speech: { ...s.speech, ...patch } })),
            resetSpeech: () => set({ speech: initialSpeech }),

            patchTranscription: (patch) =>
                set((s) => ({ transcription: { ...s.transcription, ...patch } })),
            resetTranscription: () => set({ transcription: initialTranscription }),

            patchVideo: (patch) =>
                set((s) => ({ video: { ...s.video, ...patch } })),
            resetVideo: () => set({ video: initialVideo }),

            patchEmbedding: (patch) =>
                set((s) => ({ embedding: { ...s.embedding, ...patch } })),
            resetEmbedding: () => set({ embedding: initialEmbedding }),
        }),
        {
            name: "loom-modality-state",
            storage: createJSONStorage(() => localStorage),
            // Drop large / non-serialisable fields from persistence so
            // localStorage stays well under quota.
            partialize: (s) => ({
                lastPath: s.lastPath,
                modalityPaths: s.modalityPaths,
                navCollapsed: s.navCollapsed,
                chatScrollOffsets: s.chatScrollOffsets,
                image: { ...s.image, result: null, error: null },
                speech: { ...s.speech, result: null, error: null },
                transcription: { ...s.transcription, result: null, error: null },
                video: { ...s.video, job: null, error: null },
                embedding: { ...s.embedding, result: null, error: null },
            }),
        },
    ),
)

/** Resolve where a Playground click should land. Default to chat. The
 *  stored value may include search params (e.g. `?c=<conv-id>`) so the
 *  chat resumes the exact conversation the user was in. */
export function entryPath(lastPath: string | null): string {
    if (!lastPath) return "/playground/chat"
    if (!lastPath.startsWith("/playground/")) return "/playground/chat"
    return lastPath
}
