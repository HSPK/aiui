import "server-only";
import { defineRoute } from "@/lib/server/route";
import {
    createModel,
    listAllModels,
    modelCreateSchema,
} from "@/lib/server/models";

export const GET = defineRoute({
    handler: () => listAllModels(),
});

export const POST = defineRoute({
    auth: "admin",
    body: modelCreateSchema,
    handler: ({ body }) => createModel(body),
});
