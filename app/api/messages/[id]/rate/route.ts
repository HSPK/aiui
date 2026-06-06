import "server-only";
import { z } from "zod";
import { defineRoute } from "@/lib/server/route";
import { messageRatingSchema, rateMessage } from "@/lib/server/messages";

export const POST = defineRoute({
    params: z.object({ id: z.string().min(1) }),
    body: messageRatingSchema,
    handler: ({ user, params, body }) => {
        rateMessage(user.id, params.id, body);
    },
});
