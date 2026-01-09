export interface User {
    username: string;
    role: "admin" | "user";
}

export interface AuthParams {
    user_name: string;
    user_password: string;
}

export interface TokenUsage {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
}
