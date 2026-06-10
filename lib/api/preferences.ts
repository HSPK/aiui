"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { fetcher } from "./client";
import type {
    UserPreferencesDTO,
    UserPreferencesUpdateInput,
} from "@/lib/schemas/preferences";

const path = "/users/me/preferences";
const keyAll = ["preferences"] as const;
const CHANNEL_NAME = "loom-preferences";

/** Broadcast envelope.
 *
 *  We deliberately do NOT carry the DTO payload — earlier shape
 *  `{kind:"update", payload}` had a last-writer-wins ordering bug
 *  when two tabs PATCH near-simultaneously (each peer received the
 *  other's payload AFTER its own write landed, clobbering newer
 *  state with older). Carrying just a notification + invalidating
 *  peer caches lets the server stay the single arbiter of truth —
 *  the refetch pulls whichever PATCH committed last, identical
 *  across all tabs. Costs one extra GET per cross-tab edit; prefs
 *  is low-frequency enough that this is invisible. */
type PrefsBroadcast = { kind: "update" };

function getChannel(): BroadcastChannel | null {
    if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null;
    return new BroadcastChannel(CHANNEL_NAME);
}

export const preferences = {
    keys: { all: () => keyAll },

    // ---- raw ----
    get: () => fetcher<UserPreferencesDTO>(path),
    update: (patch: UserPreferencesUpdateInput) =>
        fetcher<UserPreferencesDTO>(path, {
            method: "PATCH",
            body: JSON.stringify(patch),
        }),

    // ---- hooks ----
    useGet: () => {
        const qc = useQueryClient();
        // Cross-tab listener: each tab subscribes to the channel and
        // invalidates its own cache on broadcast. Server stays the
        // single source of truth (no payload-ordering race).
        useEffect(() => {
            const channel = getChannel();
            if (!channel) return;
            const onMessage = (e: MessageEvent<PrefsBroadcast>) => {
                if (e.data?.kind === "update") {
                    qc.invalidateQueries({ queryKey: keyAll });
                }
            };
            channel.addEventListener("message", onMessage);
            return () => {
                channel.removeEventListener("message", onMessage);
                channel.close();
            };
        }, [qc]);

        return useQuery({
            queryKey: keyAll,
            queryFn: preferences.get,
            staleTime: 60_000,
        });
    },

    useUpdate: () => {
        const qc = useQueryClient();
        return useMutation({
            mutationFn: preferences.update,
            onSuccess: () => {
                // Invalidate (not setQueryData) so the originating tab
                // re-fetches authoritative server state. Without this,
                // rapid clicks on theme tiles / avatar grid / blur-
                // commits can land HTTP responses out of issue-order
                // (HTTP/2 multiplexing, slow upstream), and the
                // unconditional `setQueryData(next)` would settle the
                // local cache on the OLDER response while the DB
                // already holds the newer write — UI silently reverts.
                // Peers also invalidate via the broadcast below.
                qc.invalidateQueries({ queryKey: keyAll });
                const channel = getChannel();
                if (channel) {
                    try {
                        channel.postMessage({ kind: "update" } satisfies PrefsBroadcast);
                    } finally {
                        channel.close();
                    }
                }
            },
        });
    },
};
