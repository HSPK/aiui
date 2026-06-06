import "server-only";
import { z } from "zod";
import { defineRoute } from "@/lib/server/route";
import { forwardGeneration } from "@/lib/server/gateway";

const bodySchema = z.looseObject({ model: z.string().min(1) });

export const POST = defineRoute({
    auth: "gateway",
    body: bodySchema,
    handler: async ({ user, body }) => {
        const { response } = await forwardGeneration(user, "chat", body);
        return response;
    },
});
