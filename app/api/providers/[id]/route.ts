import "server-only";
import { z } from "zod";
import { defineRoute } from "@/lib/server/route";
import { providerUpdateSchema } from "@/lib/schemas/provider";
import { deleteProvider, getProvider, updateProvider } from "@/lib/server/providers";

const paramsSchema = z.object({ id: z.string().min(1) });

export const GET = defineRoute({
    params: paramsSchema,
    handler: ({ params }) => getProvider(decodeURIComponent(params.id)),
});

export const PATCH = defineRoute({
    auth: "admin",
    params: paramsSchema,
    body: providerUpdateSchema,
    handler: ({ params, body }) => updateProvider(decodeURIComponent(params.id), body),
});

export const DELETE = defineRoute({
    auth: "admin",
    params: paramsSchema,
    handler: async ({ params }) => {
        await deleteProvider(decodeURIComponent(params.id));
    },
});
