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
    // Forward-compatible merge: start from defaults, layer the stored
    // partial on top. We deliberately use `safeParse` rather than
    // `parse` so a legacy row that violates a TIGHTENED bound (e.g.
    // an older deployment let users save `default_history_limit: 100`
    // before R1 capped it at 50) doesn't 500 the whole preferences
    // endpoint — that would deadlock the user out of Settings, the
    // only place they could fix it. Per-field salvage: keep every
    // valid field, drop only the offending ones to defaults.
    const merged = { ...defaultUserPreferences, ...stored };
    const parsed = userPreferencesDTOSchema.safeParse(merged);
    if (parsed.success) return parsed.data;
    return salvagePreferences(merged);
}

/** Per-field validation salvage: when the whole-object parse fails,
 *  validate each known field in isolation against its own schema slice
 *  and fall back to the default for any field that fails. Guarantees
 *  the returned DTO always satisfies the strict schema, even when the
 *  stored JSON has legacy out-of-range values from before a tightening
 *  of bounds. */
function salvagePreferences(merged: Record<string, unknown>): UserPreferencesDTO {
    const shape = userPreferencesDTOSchema.shape;
    const out = { ...defaultUserPreferences } as Record<string, unknown>;
    for (const [key, fieldSchema] of Object.entries(shape)) {
        const candidate = merged[key];
        if (candidate === undefined) continue;
        const fieldParsed = (fieldSchema as { safeParse: (v: unknown) => { success: boolean; data?: unknown } })
            .safeParse(candidate);
        if (fieldParsed.success) out[key] = fieldParsed.data;
    }
    return out as UserPreferencesDTO;
}

/**
 * Patch a user's preferences. Provided fields are merged on top of the
 * existing row (upserted as needed). Returns the post-update full DTO.
 *
 * The whole read → merge → upsert sequence is wrapped in a single
 * better-sqlite3 transaction so concurrent PATCHes from two tabs (or
 * two rapid blur-commits from the same tab) can't clobber each other
 * via a lost-update race. better-sqlite3 serializes transactions
 * per-connection, so any second tx waits for the first to commit
 * before reading.
 */
export function updatePreferences(
    userId: string,
    patch: UserPreferencesUpdateInput,
): UserPreferencesDTO {
    const now = new Date().toISOString();
    return db.transaction((): UserPreferencesDTO => {
        const current = getPreferences(userId);
        const next: UserPreferencesDTO = { ...current, ...patch };
        db.insert(userPreferences)
            .values({ userId, preferences: next, updatedAt: now })
            .onConflictDoUpdate({
                target: userPreferences.userId,
                set: { preferences: next, updatedAt: now },
            })
            .run();
        return next;
    });
}
