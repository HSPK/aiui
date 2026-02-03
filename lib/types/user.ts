export interface User {
    username: string;
    role: "admin" | "user";
    created_at?: string;
}

export interface AuthParams {
    user_name: string;
    user_password: string;
}

export interface UserCreateParams {
    username: string;
    password: string;
    role: "admin" | "user";
}

export interface UserUpdateParams {
    password?: string;
    role?: "admin" | "user";
}

export interface UserListResponse {
    items: User[];
    total: number;
    page: number;
    page_size: number;
}

export interface UserFilterParams {
    page?: number;
    page_size?: number;
    sort?: string;
    keyword?: string;
    filter_admin?: boolean;
}

export interface TokenUsage {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
}
