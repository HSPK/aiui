import "server-only";
import { defineRoute } from "@/lib/server/route";
import { userPreferencesUpdateSchema } from "@/lib/schemas/preferences";
import { getPreferences, updatePreferences } from "@/lib/server/preferences";

export const GET = defineRoute({
    handler: ({ user }) => getPreferences(user.id),
});

export const PATCH = defineRoute({
    body: userPreferencesUpdateSchema,
    handler: ({ user, body }) => updatePreferences(user.id, body),
});
