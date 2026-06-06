"use client";
import { useMutation, type UseMutationOptions } from "@tanstack/react-query";
import { defineResource } from "./resource";
import type { ApiKeyCreatedDTO, ApiKeyDTO } from "@/lib/schemas/apikey";

const base = defineResource<
    ApiKeyDTO,
    { name: string },
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

    /** API keys take a plain string name + return the plain key once. */
    create: (name: string) =>
        base.create({ name }) as unknown as Promise<ApiKeyCreatedDTO>,

    useCreate: (
        opts?: Omit<UseMutationOptions<ApiKeyCreatedDTO, Error, string>, "mutationFn">,
    ) => {
        const invalidate = base.useInvalidate();
        return useMutation<ApiKeyCreatedDTO, Error, string>({
            mutationFn: apiKeys.create,
            ...opts,
            onSuccess: (data, vars, onMutateResult, context) => {
                invalidate();
                opts?.onSuccess?.(data, vars, onMutateResult, context);
            },
        });
    },
};
