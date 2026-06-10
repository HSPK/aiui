import "server-only";
import { defineRoute } from "@/lib/server/route";
import { forwardMultipartGeneration } from "@/lib/server/gateway";
import { badRequest } from "@/lib/server/response";

export const POST = defineRoute({
    auth: "gateway",
    handler: async ({ req, user }) => {
        const ct = req.headers.get("Content-Type") ?? "";
        if (!ct.toLowerCase().startsWith("multipart/form-data")) {
            throw badRequest("POST /v1/audio/transcriptions expects multipart/form-data");
        }
        const form = await req.formData();
        const { response } = await forwardMultipartGeneration(user, "audio.transcription", form, { signal: req.signal });
        return response;
    },
});

