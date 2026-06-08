import "server-only";
import { defineRoute } from "@/lib/server/route";
import { listVariants } from "@/lib/server/api-variants";
import "@/lib/server/api-variants/register";

export const GET = defineRoute({
    handler: () =>
        listVariants().map((v) => ({
            id: v.id,
            capability: v.capability,
            path: v.path,
            supports_streaming: v.supportsStreaming,
        })),
});
