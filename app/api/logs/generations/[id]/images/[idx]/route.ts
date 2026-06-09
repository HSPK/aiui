import "server-only";
import { z } from "zod";
import { defineRoute } from "@/lib/server/route";
import { readArtifact } from "@/lib/server/gateway/artifacts";
import { assertLogReadable } from "@/lib/server/logs";
import { notFound } from "@/lib/server/response";

/**
 * GET /api/logs/generations/{id}/images/{idx}
 *
 * Returns one persisted image artifact from an image-generation log.
 * Auth: piggy-backs on `assertLogReadable` (admin OR log owner) —
 * lightweight {id, user_id} select, not the full log DTO. The
 * artifact file naming is opaque to the client — we probe known
 * extensions inside the per-log directory and return the matching
 * mime.
 */
const paramsSchema = z.object({
    id: z.string().min(1),
    idx: z.coerce.number().int().min(0).max(100),
});

export const GET = defineRoute({
    params: paramsSchema,
    handler: async ({ user, params }) => {
        assertLogReadable(user, params.id);

        const found = await readArtifact(params.id, params.idx);
        if (!found) throw notFound("Artifact not found");

        return new Response(new Uint8Array(found.buf), {
            headers: {
                "Content-Type": found.mime,
                "Content-Length": String(found.buf.byteLength),
                // Artifacts are immutable per (log_id, index), so a
                // long max-age + immutable is safe.
                "Cache-Control": "private, max-age=31536000, immutable",
            },
        });
    },
});
