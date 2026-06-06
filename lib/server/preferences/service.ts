import "server-only";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { userPreferences } from "../db/schema";
import {
    defaultUserPreferences,
    userPreferencesDTOSchema,
    type UserPreferencesDTO,
    type UserPreferencesUpdateInput,
} from "@/lib/schemas/preferences";

/**
 * Read the preferences row for a user, merged over server defaults. Always
 * returns a full DTO — fields the user has never set fall back to the
 * defaults defined in lib/schemas/preferences.ts.
 */
export function getPreferences(userId: string): UserPreferencesDTO {
    const row = db
        .select({ preferences: userPreferences.preferences })
        .from(userPreferences)
        .where(eq(userPreferences.userId, userId))
        .get();

    const stored = (row?.preferences ?? {}) as Partial<UserPreferencesDTO>;
    // Validate stored shape against the schema, falling back to defaults on
    // missing keys or invalid values. Forward-compatible with new fields.
    const merged = { ...defaultUserPreferences, ...stored };
    return userPreferencesDTOSchema.parse(merged);
}

/**
 * Patch a user's preferences. Provided fields are merged on top of the
 * existing row (upserted as needed). Returns the post-update full DTO.
 */
export function updatePreferences(
    userId: string,
    patch: UserPreferencesUpdateInput,
): UserPreferencesDTO {
    const current = getPreferences(userId);
    const next: UserPreferencesDTO = { ...current, ...patch };
    const now = new Date().toISOString();

    db.insert(userPreferences)
        .values({ userId, preferences: next, updatedAt: now })
        .onConflictDoUpdate({
            target: userPreferences.userId,
            set: { preferences: next, updatedAt: now },
        })
        .run();

    return next;
}
