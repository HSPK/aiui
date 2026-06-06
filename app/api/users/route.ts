import "server-only";
import { defineRoute } from "@/lib/server/route";
import { userCreateSchema, userListQuerySchema } from "@/lib/schemas/user";
import { createUser, listUsers } from "@/lib/server/users";

export const GET = defineRoute({
    auth: "admin",
    query: userListQuerySchema,
    handler: ({ query }) => listUsers(query),
});

export const POST = defineRoute({
    auth: "admin",
    body: userCreateSchema,
    handler: ({ body }) => createUser(body),
});
