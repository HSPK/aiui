import { BaseResponse, ModelConfig, ProviderConfig, User, AuthParams, LogFilterParams, LogListResponse, GenerationLogDetail } from "./types";
import { ConversationListResponse, MessageListResponse, Conversation, Message } from "./types/playground";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "/api";


const AUTH_STORAGE_KEY = "aiui_auth_credentials";

export function getAuthHeader(): string | null {
    if (typeof window !== "undefined") {
        return localStorage.getItem(AUTH_STORAGE_KEY);
    }
    return null;
}

export function setAuthHeader(username: string, password?: string) {
    if (typeof window !== "undefined") {
        if (password) {
            // Storing as "username:password" as requested.
            // Note: In production, consider more secure storage or token-based auth.
            localStorage.setItem(AUTH_STORAGE_KEY, `${username}:${password}`);
        } else {
            localStorage.removeItem(AUTH_STORAGE_KEY);
        }
    }
}

export class ApiError extends Error {
    status: number;
    code?: number;

    constructor(message: string, status: number, code?: number) {
        super(message);
        this.status = status;
        this.code = code;
        this.name = "ApiError";
    }
}

async function fetcher<T>(url: string, options?: RequestInit): Promise<T> {
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(options?.headers as Record<string, string>),
    };

    const auth = getAuthHeader();
    if (auth) {
        headers["Authorization"] = auth;
    }

    const res = await fetch(`${BASE_URL}${url}`, {
        ...options,
        headers,
    });

    if (!res.ok) {
        // Handle 401 specifically
        if (res.status === 401) {
            // Only redirect if NOT on the login page already
            if (typeof window !== 'undefined' && !window.location.pathname.includes('/login')) {
                const currentPath = window.location.pathname + window.location.search;
                window.location.href = `/login?from=${encodeURIComponent(currentPath)}`;
            }
        }

        let errorMessage = `API Error: ${res.statusText}`;
        let errorCode = undefined;

        try {
            const errorBody = await res.json();
            errorMessage = errorBody.msg || errorMessage;
            errorCode = errorBody.code; // Backend specific error code
        } catch {
            // ignore JSON parse error
        }

        throw new ApiError(errorMessage, res.status, errorCode);
    }

    const json = (await res.json()) as BaseResponse<T>;

    if (json.code !== 0) {
        throw new ApiError(json.msg || "Unknown API Error", 200, json.code);
    }

    return json.data;
}

export const api = {
    // Auth
    login: (data: AuthParams) => fetcher<void>("/login", {
        method: "POST",
        body: JSON.stringify(data)
    }),
    getMe: () => fetcher<User>("/users/me"),

    // Providers & Models
    getProviders: () => fetcher<ProviderConfig[]>("/providers"),
    getModels: () => fetcher<ModelConfig[]>("/models"),
    getModel: (id: string) => fetcher<ModelConfig>(`/models/${id}`),
    getProvider: (id: string) => fetcher<ProviderConfig>(`/providers/${id}`),
    getProviderModels: (providerId: string) => fetcher<ModelConfig[]>(`/providers/${providerId}/models`),

    reloadProviders: () => fetcher<void>("/providers/reload", { method: "POST" }),
    checkProvider: (id: string) => fetcher<void>(`/providers/${id}/check`, { method: "POST" }),

    health: () => fetcher<void>("/health"),
    ping: () => fetcher<string>("/ping"),

    // Logs
    getLogs: (params: LogFilterParams) => {
        const searchParams = new URLSearchParams();
        if (params.page) searchParams.set("page", params.page.toString());
        if (params.page_size) searchParams.set("page_size", params.page_size.toString());
        if (params.sort) searchParams.set("sort", params.sort);
        if (params.user_id) searchParams.set("user_id", params.user_id);
        if (params.model_name) searchParams.set("model_name", params.model_name);
        if (params.status) searchParams.set("status", params.status);

        return fetcher<LogListResponse>(`/logs/generations?${searchParams.toString()}`);
    },
    getLogDetail: (id: string) => fetcher<GenerationLogDetail>(`/logs/generations/${id}`),

    // Playground
    getConversations: async (page: number = 1, pageSize: number = 20, keyword?: string) => {
        const params = new URLSearchParams({
            page: page.toString(),
            page_size: pageSize.toString(),
            sort: "updated_at:desc",
        });
        if (keyword) {
            params.append("keyword", keyword);
        }
        return fetcher<BaseResponse<ConversationListResponse>>(`/conversations?${params.toString()}`);
    },

    getConversationMessages: async (convId: string) => {
        const params = new URLSearchParams({
            page: "1",
            page_size: "100",
            sort: "created_at:asc",
        });
        return fetcher<BaseResponse<MessageListResponse>>(`/conversations/${convId}/messages?${params.toString()}`);
    },

    deleteConversation: async (convId: string) => {
        return fetcher<BaseResponse<void>>(`/conversations/${convId}`, {
            method: "DELETE",
        });
    },

    updateConversationTitle: async (convId: string, title: string) => {
        const params = new URLSearchParams({ title });
        return fetcher<BaseResponse<void>>(`/conversations/${convId}/title?${params.toString()}`, {
            method: "PUT",
        });
    },
};
