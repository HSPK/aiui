import "server-only";
import { z } from "zod";
import { defineRoute } from "@/lib/server/route";
import { listModelsForProvider } from "@/lib/server/models";

export const GET = defineRoute({
    params: z.object({ id: z.string().min(1) }),
    handler: ({ params }) => listModelsForProvider(decodeURIComponent(params.id)),
});
