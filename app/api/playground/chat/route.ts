import "server-only";
import { defineRoute } from "@/lib/server/route";
import { playgroundChatSchema } from "@/lib/schemas/playground";
import { sendPlaygroundChat } from "@/lib/server/playground";

export const POST = defineRoute({
    body: playgroundChatSchema,
    handler: ({ user, body }) => sendPlaygroundChat(user, body),
});
