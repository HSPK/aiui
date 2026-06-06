import "server-only";
import { defineRoute } from "@/lib/server/route";
import { playgroundChatSchema, sendPlaygroundChat } from "@/lib/server/playground";

export const POST = defineRoute({
    body: playgroundChatSchema,
    handler: ({ user, body }) => sendPlaygroundChat(user, body),
});
