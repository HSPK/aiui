import { describe, expect, it } from "vitest";
import "@/lib/server/capabilities/register";
import { getCapability } from "@/lib/server/capabilities";

const chat = getCapability("chat")!;
const embedding = getCapability("embedding")!;
const image = getCapability("image")!;
const audioSpeech = getCapability("audio.speech")!;
const audioTranscription = getCapability("audio.transcription")!;
const rerank = getCapability("rerank")!;
const video = getCapability("video")!;

describe("capabilities/chat", () => {
    it("declares the expected wiring", () => {
        expect(chat.defaultVariantId).toBe("chat.completions");
        expect(chat.variantPreference).toEqual(["responses", "chat.completions"]);
        expect(chat.priority).toBe(10);
    });

    it.each([
        "gpt-4o", "chatgpt-4o-latest", "o1-preview", "o3-mini", "claude-3-opus", "gemini-1.5-pro",
        "llama-3-70b", "qwen2.5-72b-instruct", "deepseek-chat", "deepseek-r1", "deepseek-reasoner",
        "deepseek-v3", "mistral-large", "mixtral-8x7b", "grok-2", "yi-34b", "baichuan2-13b",
        "moonshot-v1-8k", "kimi-k1.5", "hunyuan-turbo", "glm-4", "spark-3.5", "abab6.5", "step-1",
        "doubao-pro", "ernie-4.0", "some-custom-model-instruct", "another-model-chat",
    ])("matches(%s) === true", (id) => {
        expect(chat.matches!(id)).toBe(true);
    });

    it.each(["text-embedding-3-small", "dall-e-3", "whisper-1", "tts-1", "bge-reranker-large", "sora-2", "random-xyz"])(
        "matches(%s) === false",
        (id) => {
            expect(chat.matches!(id)).toBe(false);
        },
    );

    it("summarizes the last user message (text-only, ≤200 chars)", () => {
        expect(
            chat.summarizeInput!({
                messages: [
                    { role: "system", content: "be nice" },
                    { role: "user", content: "first question" },
                    { role: "assistant", content: "first answer" },
                    { role: "user", content: "second question" },
                ],
            }),
        ).toBe("second question");
    });

    it("falls back to the last message overall when no user-role message is present", () => {
        expect(
            chat.summarizeInput!({
                messages: [
                    { role: "system", content: "be nice" },
                    { role: "assistant", content: "unsolicited answer" },
                ],
            }),
        ).toBe("unsolicited answer");
    });

    it("extracts only text parts from multimodal content, ignoring images", () => {
        expect(
            chat.summarizeInput!({
                messages: [
                    {
                        role: "user",
                        content: [
                            { type: "text", text: "describe this" },
                            { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
                        ],
                    },
                ],
            }),
        ).toBe("describe this");
    });

    it("returns '' when messages is missing, empty, or not an array", () => {
        expect(chat.summarizeInput!({})).toBe("");
        expect(chat.summarizeInput!({ messages: [] })).toBe("");
        expect(chat.summarizeInput!({ messages: "not-an-array" })).toBe("");
    });

    it("truncates to 200 characters", () => {
        const long = "x".repeat(250);
        expect(chat.summarizeInput!({ messages: [{ role: "user", content: long }] })).toHaveLength(200);
    });

    it("returns '' when the resolved target message has no content field", () => {
        expect(chat.summarizeInput!({ messages: [{ role: "user" }] })).toBe("");
    });

    it("returns '' rather than throwing when the resolved target message itself is nullish", () => {
        expect(chat.summarizeInput!({ messages: [null] })).toBe("");
    });
});

describe("capabilities/embedding", () => {
    it("declares the expected wiring", () => {
        expect(embedding.defaultVariantId).toBe("embeddings");
        expect(embedding.priority).toBe(20);
    });

    it.each(["text-embedding-3-small", "bge-large-en", "gte-large", "m3e-base", "e5-mistral-7b-instruct", "cohere-embed-v3", "embed-english-v3.0"])(
        "matches(%s) === true",
        (id) => {
            expect(embedding.matches!(id)).toBe(true);
        },
    );

    it.each(["gpt-4o", "dall-e-3", "whisper-1"])("matches(%s) === false", (id) => {
        expect(embedding.matches!(id)).toBe(false);
    });

    it("summarizes a string input, truncated to 200 chars", () => {
        expect(embedding.summarizeInput!({ input: "hello world" })).toBe("hello world");
        expect(embedding.summarizeInput!({ input: "x".repeat(250) })).toHaveLength(200);
    });

    it("summarizes an array input with a count prefix, blanking non-string entries", () => {
        expect(embedding.summarizeInput!({ input: ["a", "b", "c"] })).toBe("3 input(s): a / b / c");
        expect(embedding.summarizeInput!({ input: ["a", 42, "c"] })).toBe("3 input(s): a /  / c");
    });

    it("returns '' for a non-string, non-array input", () => {
        expect(embedding.summarizeInput!({ input: 42 })).toBe("");
        expect(embedding.summarizeInput!({})).toBe("");
    });
});

describe("capabilities/image", () => {
    it("declares the expected wiring", () => {
        expect(image.defaultVariantId).toBe("images.generations");
        expect(image.priority).toBe(30);
    });

    it.each([
        "dall-e-3", "dall-e-2", "gpt-image-1", "stable-diffusion-xl", "sd-3", "sdxl-turbo",
        "flux-1-schnell", "imagen-3", "midjourney-v6", "kandinsky-3", "playground-v2.5", "cogview-3", "ideogram-v2",
    ])("matches(%s) === true", (id) => {
        expect(image.matches!(id)).toBe(true);
    });

    it.each(["gpt-4o", "whisper-1"])("matches(%s) === false", (id) => {
        expect(image.matches!(id)).toBe(false);
    });

    it("summarizes the prompt, with an (×n) prefix only when n > 1", () => {
        expect(image.summarizeInput!({ prompt: "a cat" })).toBe("a cat");
        expect(image.summarizeInput!({ prompt: "a cat", n: 1 })).toBe("a cat");
        expect(image.summarizeInput!({ prompt: "a cat", n: 4 })).toBe("(×4) a cat");
    });

    it("returns '' text when prompt is missing or not a string", () => {
        expect(image.summarizeInput!({})).toBe("");
        expect(image.summarizeInput!({ prompt: ["not", "a", "string"] })).toBe("");
        expect(image.summarizeInput!({ prompt: 42, n: 2 })).toBe("(×2) ");
    });

    it("truncates the prompt to 180 chars", () => {
        expect(image.summarizeInput!({ prompt: "x".repeat(250) })).toHaveLength(180);
    });
});

describe("capabilities/audio-speech", () => {
    it("declares the expected wiring", () => {
        expect(audioSpeech.defaultVariantId).toBe("audio.speech");
        expect(audioSpeech.priority).toBe(25);
    });

    it.each(["tts-1", "tts-1-hd", "elevenlabs-v2", "piper-en", "xtts-v2", "fish-speech-1.4", "some-voice-model"])(
        "matches(%s) === true",
        (id) => {
            expect(audioSpeech.matches!(id)).toBe(true);
        },
    );

    it.each(["gpt-4o", "whisper-1"])("matches(%s) === false", (id) => {
        expect(audioSpeech.matches!(id)).toBe(false);
    });

    it("prefixes the voice tag when present", () => {
        expect(audioSpeech.summarizeInput!({ input: "hello", voice: "alloy" })).toBe("[alloy] hello");
        expect(audioSpeech.summarizeInput!({ input: "hello" })).toBe("hello");
    });

    it("returns '' text for a non-string input, truncates to 180 chars", () => {
        expect(audioSpeech.summarizeInput!({ input: 42 })).toBe("");
        expect(audioSpeech.summarizeInput!({ input: "x".repeat(250) })).toHaveLength(180);
    });
});

describe("capabilities/audio-transcription", () => {
    it("declares the expected wiring", () => {
        expect(audioTranscription.defaultVariantId).toBe("audio.transcriptions");
        expect(audioTranscription.priority).toBe(25);
    });

    it.each(["whisper-1", "whisper-large-v3", "some-stt-model", "transcribe-v2", "asr-model", "conformer-ctc", "paraformer-zh"])(
        "matches(%s) === true",
        (id) => {
            expect(audioTranscription.matches!(id)).toBe(true);
        },
    );

    it.each(["tts-1", "gpt-4o"])("matches(%s) === false", (id) => {
        expect(audioTranscription.matches!(id)).toBe(false);
    });

    it("always summarizes to the constant 'audio input'", () => {
        expect(audioTranscription.summarizeInput!({})).toBe("audio input");
        expect(audioTranscription.summarizeInput!({ anything: "whatever" })).toBe("audio input");
    });
});

describe("capabilities/rerank", () => {
    it("declares the expected wiring", () => {
        expect(rerank.defaultVariantId).toBe("rerank");
        expect(rerank.priority).toBe(30);
    });

    it.each(["rerank-english-v3.0", "bge-reranker-large", "jina-reranker-v2", "cohere-rerank-v3"])(
        "matches(%s) === true",
        (id) => {
            expect(rerank.matches!(id)).toBe(true);
        },
    );

    it.each(["gpt-4o", "text-embedding-3-small"])("matches(%s) === false", (id) => {
        expect(rerank.matches!(id)).toBe(false);
    });

    it("summarizes with a document-count prefix, singular vs plural", () => {
        expect(rerank.summarizeInput!({ query: "best pizza", documents: ["a"] })).toBe("(over 1 doc) best pizza");
        expect(rerank.summarizeInput!({ query: "best pizza", documents: ["a", "b"] })).toBe("(over 2 docs) best pizza");
        expect(rerank.summarizeInput!({ query: "best pizza" })).toBe("(over 0 docs) best pizza");
    });

    it("returns '' query text when query is missing or not a string, truncates to 160", () => {
        expect(rerank.summarizeInput!({ documents: ["a"] })).toBe("(over 1 doc) ");
        expect(rerank.summarizeInput!({ query: "x".repeat(200), documents: [] })).toHaveLength("(over 0 docs) ".length + 160);
    });
});

describe("capabilities/video", () => {
    it("declares the expected wiring", () => {
        expect(video.defaultVariantId).toBe("videos");
        expect(video.priority).toBe(30);
    });

    it.each([
        "sora-2", "veo-2", "kling-1.5", "runway-gen-3", "gen-3-alpha", "luma-dream-machine",
        "pika-1.5", "wan-2.1", "hailuo-ai", "cogvideo-x", "mochi-1", "hunyuan-video",
    ])("matches(%s) === true", (id) => {
        expect(video.matches!(id)).toBe(true);
    });

    it("matches(gpt-4o) === false", () => {
        expect(video.matches!("gpt-4o")).toBe(false);
    });

    it("tags [Ns size] only when seconds/size are present", () => {
        expect(video.summarizeInput!({ prompt: "a dog running" })).toBe("a dog running");
        expect(video.summarizeInput!({ prompt: "a dog running", seconds: 8 })).toBe("[8s] a dog running");
        expect(video.summarizeInput!({ prompt: "a dog running", size: "1024x1024" })).toBe("[1024x1024] a dog running");
        expect(video.summarizeInput!({ prompt: "a dog running", seconds: 8, size: "1024x1024" })).toBe("[8s 1024x1024] a dog running");
    });

    it("returns '' text when prompt is missing or not a string, truncates to 160", () => {
        expect(video.summarizeInput!({})).toBe("");
        expect(video.summarizeInput!({ prompt: "x".repeat(200) })).toHaveLength(160);
    });
});
