"use client";
import { useMutation, type UseMutationOptions } from "@tanstack/react-query";
import { defineResource } from "./resource";
import type { ApiKeyCreateInput, ApiKeyCreatedDTO, ApiKeyDTO } from "@/lib/schemas/apikey";

const base = defineResource<
    ApiKeyDTO,
    ApiKeyCreateInput,
    never,
    Record<string, unknown>,
    ApiKeyDTO[]
>({
    path: "/apikeys",
    key: "apikeys",
    listShape: "array",
});

export const apiKeys = {
    ...base,

    /** API keys take a name + optional expiry, return the plain key once. */
    create: (input: ApiKeyCreateInput) =>
        base.create(input) as unknown as Promise<ApiKeyCreatedDTO>,

    useCreate: (
        opts?: Omit<UseMutationOptions<ApiKeyCreatedDTO, Error, ApiKeyCreateInput>, "mutationFn">,
    ) => {
        const invalidate = base.useInvalidate();
        return useMutation<ApiKeyCreatedDTO, Error, ApiKeyCreateInput>({
            mutationFn: apiKeys.create,
            ...opts,
            onSuccess: (data, vars, onMutateResult, context) => {
                invalidate();
                opts?.onSuccess?.(data, vars, onMutateResult, context);
            },
        });
    },
};
