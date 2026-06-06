import "server-only";
import { defineRoute } from "@/lib/server/route";
import { conversationListQuerySchema } from "@/lib/schemas/conversation";
import { listConversations } from "@/lib/server/conversations";

export const GET = defineRoute({
    query: conversationListQuerySchema,
    handler: ({ user, query }) => listConversations(user.id, query),
});
