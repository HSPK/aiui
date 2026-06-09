import type { ModelDTO } from "@/lib/schemas/model"

/** Name/upstream-id heuristics applied as a fallback when discovery
 *  didn't classify a model into the requested capability. Mirrors the
 *  regexes used by each backend capability handler's `matches`. */
export const CAPABILITY_HEURISTIC: Record<string, RegExp> = {
    embedding: /\b(embedding|embed|bge|gte|m3e|e5|cohere-embed|text-embedding|nomic-embed|jina-embed)/i,
    rerank: /\b(rerank|reranker|cohere-rerank)/i,
    image: /\b(dall-?e|stable-?diffusion|sd-?xl|flux|midjourney|imagen|kandinsky|gpt-image)/i,
    "audio.speech": /\b(tts|speech|polly|elevenlabs|cosyvoice)/i,
    "audio.transcription": /\b(whisper|stt|transcribe|asr|conformer|paraformer)/i,
    video: /\b(sora|veo|kling|runway|gen-?\d|luma|pika|wan|hailuo|cogvideo|mochi|hunyuan-video)/i,
    chat: /\b(gpt|claude|gemini|llama|mistral|qwen|deepseek|yi-|glm-|moonshot|kimi|phi-?|grok|hunyuan|step-)/i,
}

/** True if a model belongs to the requested capability via its discovery
 *  type OR a name-based fallback heuristic. Used by both single- and
 *  multi-model modality selectors. */
export function matchesCapability(m: ModelDTO, capability: string): boolean {
    if (m.type === capability) return true
    const re = CAPABILITY_HEURISTIC[capability]
    if (!re) return false
    return re.test(m.name) || re.test(m.model_id ?? "")
}
