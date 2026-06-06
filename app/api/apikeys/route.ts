import "server-only";
import { defineRoute } from "@/lib/server/route";
import {
    apiKeyCreateSchema,
    createUserApiKey,
    listApiKeys,
} from "@/lib/server/apikeys";

export const GET = defineRoute({
    handler: ({ user }) => listApiKeys(user.id),
});

export const POST = defineRoute({
    body: apiKeyCreateSchema,
    handler: ({ user, body }) => createUserApiKey(user.id, body),
});
