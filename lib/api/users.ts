import { defineResource } from "./resource";
import type { Paginated } from "@/lib/schemas/common";
import type { UserCreateInput, UserDTO, UserFilterParams, UserUpdateInput } from "@/lib/schemas/user";

export const users = defineResource<
    UserDTO,
    UserCreateInput,
    UserUpdateInput,
    UserFilterParams,
    Paginated<UserDTO>
>({
    path: "/users",
    key: "users",
    staleTime: 60_000,
});
