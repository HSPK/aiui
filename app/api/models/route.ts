import "server-only";
import { defineRoute } from "@/lib/server/route";
import { modelCreateSchema } from "@/lib/schemas/model";
import { createModel, listAllModels } from "@/lib/server/models";

export const GET = defineRoute({
    handler: () => listAllModels(),
});

export const POST = defineRoute({
    auth: "admin",
    body: modelCreateSchema,
    handler: ({ body }) => createModel(body),
});
