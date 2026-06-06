import "server-only";
import { z } from "zod";
import { defineRoute } from "@/lib/server/route";
import { modelUpdateSchema } from "@/lib/schemas/model";
import { deleteModel, getModel, updateModel } from "@/lib/server/models";

const paramsSchema = z.object({ id: z.string().min(1) });

export const GET = defineRoute({
    params: paramsSchema,
    handler: ({ params }) => getModel(decodeURIComponent(params.id)),
});

export const PATCH = defineRoute({
    auth: "admin",
    params: paramsSchema,
    body: modelUpdateSchema,
    handler: ({ params, body }) => updateModel(decodeURIComponent(params.id), body),
});

export const DELETE = defineRoute({
    auth: "admin",
    params: paramsSchema,
    handler: async ({ params }) => {
        await deleteModel(decodeURIComponent(params.id));
    },
});
