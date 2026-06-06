import "server-only";
import { defineRoute } from "@/lib/server/route";
import { providerCreateSchema } from "@/lib/schemas/provider";
import { createProvider, listProviders } from "@/lib/server/providers";

export const GET = defineRoute({
    handler: () => listProviders(),
});

export const POST = defineRoute({
    auth: "admin",
    body: providerCreateSchema,
    handler: ({ body }) => createProvider(body),
});
