"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { usersApi } from "@/lib/api/users";
import { queryKeys } from "./query-keys";
import type { UserCreateInput, UserFilterParams, UserUpdateInput } from "@/lib/schemas/user";

export function useUsers(filters: UserFilterParams) {
    return useQuery({
        queryKey: queryKeys.users.list(filters as Record<string, unknown>),
        queryFn: () => usersApi.list(filters),
        placeholderData: (prev) => prev,
    });
}

export function useCreateUser() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (data: UserCreateInput) => usersApi.create(data),
        onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.users.all() }),
    });
}

export function useUpdateUser() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ username, data }: { username: string; data: UserUpdateInput }) =>
            usersApi.update(username, data),
        onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.users.all() }),
    });
}

export function useDeleteUser() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (username: string) => usersApi.remove(username),
        onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.users.all() }),
    });
}
