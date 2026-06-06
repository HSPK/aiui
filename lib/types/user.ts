import type {
    LoginInput,
    UserCreateInput,
    UserDTO,
    UserListQuery,
    UserUpdateInput,
} from "@/lib/schemas/user";
import type { Paginated } from "@/lib/schemas/common";

export type User = UserDTO;
export type AuthParams = LoginInput;
export type UserCreateParams = UserCreateInput;
export type UserUpdateParams = UserUpdateInput;
export type UserListResponse = Paginated<User>;
export type UserFilterParams = Partial<Omit<UserListQuery, "filter_admin">> & { filter_admin?: boolean };
