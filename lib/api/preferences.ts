"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetcher } from "./client";
import type {
    UserPreferencesDTO,
    UserPreferencesUpdateInput,
} from "@/lib/schemas/preferences";

const path = "/users/me/preferences";
const keyAll = ["preferences"] as const;

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
    useGet: () =>
        useQuery({
            queryKey: keyAll,
            queryFn: preferences.get,
            staleTime: 60_000,
        }),

    useUpdate: () => {
        const qc = useQueryClient();
        return useMutation({
            mutationFn: preferences.update,
            onSuccess: (next) => {
                qc.setQueryData(keyAll, next);
            },
        });
    },
};
