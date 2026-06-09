import "server-only";
import { registerVariant, type UpstreamApiVariant } from ".";

/**
 * OpenAI Sora `POST /v1/videos` — async multipart create. The wire
 * shape is multipart/form-data so the JSON gateway pipeline does NOT
 * route through this variant's `transformRequest`; instead the v1
 * route forwards the multipart payload verbatim via
 * `forwardMultipartGeneration`. `parseResponse` still runs on the
 * upstream JSON so the create-time Video object lands in the
 * generation log.
 */
export const videosVariant: UpstreamApiVariant = {
    id: "videos",
    capability: "video",
    path: "/videos",
    supportsStreaming: false,

    parseResponse(json) {
        const j = json as {
            id?: string;
            status?: string;
            progress?: number;
            seconds?: string | number;
            size?: string;
            model?: string;
        };
        const id = typeof j?.id === "string" ? j.id : null;
        const status = typeof j?.status === "string" ? j.status : null;
        const summary = id
            ? `${id}${status ? ` (${status})` : ""}`
            : status ?? "video job created";
        return {
            output: summary,
            promptTokens: null,
            completionTokens: null,
            totalTokens: null,
            normalized: (j ?? {}) as Record<string, unknown>,
        };
    },

    parseStreamChunk() {
        return null;
    },
};

registerVariant(videosVariant);
