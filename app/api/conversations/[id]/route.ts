import "server-only";
import { z } from "zod";
import { defineRoute } from "@/lib/server/route";
import {
    conversationTitleSchema,
    softDeleteConversation,
    updateConversationTitle,
} from "@/lib/server/conversations";

const paramsSchema = z.object({ id: z.string().min(1) });

export const DELETE = defineRoute({
    params: paramsSchema,
    handler: ({ user, params }) => {
        softDeleteConversation(user.id, params.id);
    },
});

export const PATCH = defineRoute({
    params: paramsSchema,
    body: conversationTitleSchema,
    handler: ({ user, params, body }) => {
        updateConversationTitle(user.id, params.id, body);
    },
});
