import "server-only";
import { defineRoute } from "@/lib/server/route";
import { forwardMultipartGeneration } from "@/lib/server/gateway";
import { badRequest } from "@/lib/server/response";

/**
 * POST /v1/videos — OpenAI Sora create. Accepts multipart/form-data
 * with fields: prompt (required), model (required), seconds?, size?,
 * input_reference? (file). Returns the upstream Video JSON (id +
 * queued/in_progress status); the FE polls /v1/videos/{id}.
 */
export const POST = defineRoute({
    auth: "gateway",
    handler: async ({ req, user }) => {
        const ct = req.headers.get("Content-Type") ?? "";
        if (!ct.toLowerCase().startsWith("multipart/form-data")) {
            throw badRequest("POST /v1/videos expects multipart/form-data");
        }
        const form = await req.formData();
        const { response } = await forwardMultipartGeneration(user, "video", form);
        return response;
    },
});
