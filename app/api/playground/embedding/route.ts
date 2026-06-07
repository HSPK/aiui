import "server-only";
import { defineRoute } from "@/lib/server/route";
import { playgroundEmbeddingSchema } from "@/lib/schemas/playground";
import { runEmbeddingComparison } from "@/lib/server/playground";

export const POST = defineRoute({
    body: playgroundEmbeddingSchema,
    handler: ({ user, body }) => runEmbeddingComparison(user, body),
});
