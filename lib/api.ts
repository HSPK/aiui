import { BaseResponse, ModelConfig, ProviderConfig, User, AuthParams, LogFilterParams, LogListResponse, GenerationLogDetail, UserCreateParams, UserUpdateParams, UserListResponse, UserFilterParams } from "./types";
import { ConversationListResponse, MessageListResponse } from "./types/playground";
import type { ApiKey, ProviderCreateParams, ProviderUpdateParams, ModelCreateParams, ModelUpdateParams } from "./types";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "/api";

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

async function fetcher<T>(url: string, options?: RequestInit & { skipAuthRedirect?: boolean }): Promise<T> {
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(options?.headers as Record<string, string>),
    };

    const res = await fetch(`${BASE_URL}${url}`, {
        ...options,
        headers,
        credentials: "include",
    });

    if (!res.ok) {
        if (res.status === 401 && !options?.skipAuthRedirect) {
            if (typeof window !== "undefined" && !window.location.pathname.includes("/login")) {
                const currentPath = window.location.pathname + window.location.search;
                window.location.href = `/login?from=${encodeURIComponent(currentPath)}`;
                throw new ApiError("Unauthorized - redirecting to login", 401);
            }
        }

        let errorMessage = `API Error: ${res.statusText}`;
        let errorCode: number | undefined = undefined;

        try {
            const errorBody = await res.json();
            errorMessage = errorBody.msg || errorMessage;
            errorCode = errorBody.code;
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
    // Auth - skipAuthRedirect to prevent infinite loop on login failure
    login: (data: AuthParams) => fetcher<User>("/login", {
        method: "POST",
        body: JSON.stringify(data),
        skipAuthRedirect: true,
    }),
    logout: () => fetcher<null>("/logout", { method: "POST", skipAuthRedirect: true }),
    getMe: () => fetcher<User>("/users/me"),

    // Providers & Models
    getProviders: () => fetcher<ProviderConfig[]>("/providers"),
    getModels: () => fetcher<ModelConfig[]>("/models"),
    getModel: (id: string) => fetcher<ModelConfig>(`/models/${encodeURIComponent(id)}`),
    getProvider: (id: string) => fetcher<ProviderConfig>(`/providers/${encodeURIComponent(id)}`),
    getProviderModels: (providerId: string) => fetcher<ModelConfig[]>(`/providers/${encodeURIComponent(providerId)}/models`),

    createProvider: (data: ProviderCreateParams) => fetcher<ProviderConfig>("/providers", {
        method: "POST",
        body: JSON.stringify(data),
    }),
    updateProvider: (id: string, data: ProviderUpdateParams) => fetcher<ProviderConfig>(`/providers/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify(data),
    }),
    deleteProvider: (id: string) => fetcher<null>(`/providers/${encodeURIComponent(id)}`, { method: "DELETE" }),

    createModel: (data: ModelCreateParams) => fetcher<ModelConfig>("/models", {
        method: "POST",
        body: JSON.stringify(data),
    }),
    updateModel: (id: string, data: ModelUpdateParams) => fetcher<ModelConfig>(`/models/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify(data),
    }),
    deleteModel: (id: string) => fetcher<null>(`/models/${encodeURIComponent(id)}`, { method: "DELETE" }),

    reloadProviders: () => fetcher<null>("/providers/reload", { method: "POST" }),
    checkProvider: (id: string) => fetcher<{ ok: boolean; models?: number; error?: string }>(`/providers/${encodeURIComponent(id)}/check`, { method: "POST" }),

    health: () => fetcher<{ status: string }>("/health"),
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
    getLogDetail: (id: string) => fetcher<GenerationLogDetail>(`/logs/generations/${encodeURIComponent(id)}`),

    // Playground
    getConversations: async (page: number = 1, pageSize: number = 20, keyword?: string) => {
        const params = new URLSearchParams({
            page: page.toString(),
            page_size: pageSize.toString(),
            sort: "-updated_at",
        });
        if (keyword) {
            params.append("keyword", keyword);
        }
        return fetcher<ConversationListResponse>(`/conversations?${params.toString()}`);
    },

    getConversationMessages: async (
        convId: string,
        params?: {
            page?: number;
            page_size?: number;
            sort?: string;
        }
    ) => {
        const searchParams = new URLSearchParams({
            page: (params?.page || 1).toString(),
            page_size: (params?.page_size || 50).toString(),
            sort: params?.sort || "-created_at",
        });
        return fetcher<MessageListResponse>(`/conversations/${encodeURIComponent(convId)}/messages?${searchParams.toString()}`);
    },

    deleteConversation: async (convId: string) => {
        return fetcher<null>(`/conversations/${encodeURIComponent(convId)}`, {
            method: "DELETE",
        });
    },

    updateConversationTitle: async (convId: string, title: string) => {
        const params = new URLSearchParams({ title });
        return fetcher<null>(`/conversations/${encodeURIComponent(convId)}/title?${params.toString()}`, {
            method: "PUT",
        });
    },

    rateMessage: async (messageId: string, rating: "up" | "down" | "none", feedback?: string) => {
        const params = new URLSearchParams({ rating });
        if (feedback) params.append("feedback", feedback);
        return fetcher<null>(`/messages/${encodeURIComponent(messageId)}/rate?${params.toString()}`, {
            method: "POST",
        });
    },

    // Streaming chat is handled directly by components/playground/chat/stream-client.ts
    // (it needs the raw Response for SSE). Don't add a JSON helper here.

    // Title generation: calls the in-house OpenAI-compatible gateway via cookie.
    generateTitle: async (model: string, userMessage: string, assistantMessage: string): Promise<string> => {
        const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
                model,
                messages: [
                    {
                        role: "system",
                        content: "Generate a concise title (3-6 words) for this conversation. Output only the title, no quotes or extra text.",
                    },
                    {
                        role: "user",
                        content: `User: ${userMessage.slice(0, 500)}\n\nAssistant: ${assistantMessage.slice(0, 500)}`,
                    },
                ],
                max_tokens: 30,
                temperature: 0.7,
                stream: false,
            }),
        });

        if (!res.ok) {
            throw new ApiError(`Failed to generate title`, res.status);
        }

        const json = await res.json();
        const title = json.choices?.[0]?.message?.content?.trim() || "New Chat";
        return title.replace(/^["']|["']$/g, "").slice(0, 50);
    },

    // User Management
    getUsers: (params: UserFilterParams) => {
        const searchParams = new URLSearchParams();
        if (params.page) searchParams.set("page", params.page.toString());
        if (params.page_size) searchParams.set("page_size", params.page_size.toString());
        if (params.sort) searchParams.set("sort", params.sort);
        if (params.keyword) searchParams.set("keyword", params.keyword);
        if (params.filter_admin !== undefined) searchParams.set("filter_admin", params.filter_admin.toString());
        return fetcher<UserListResponse>(`/users?${searchParams.toString()}`);
    },

    createUser: (data: UserCreateParams) => fetcher<User>("/users/create", {
        method: "POST",
        body: JSON.stringify(data),
    }),

    updateUser: (username: string, data: UserUpdateParams) => fetcher<null>(`/users/update/${encodeURIComponent(username)}`, {
        method: "POST",
        body: JSON.stringify(data),
    }),

    deleteUser: (username: string) => fetcher<null>(`/users/delete/${encodeURIComponent(username)}`, {
        method: "DELETE",
    }),

    // API key management for the public OpenAI-compatible gateway
    listApiKeys: () => fetcher<ApiKey[]>("/apikeys"),
    createApiKey: (name: string) => fetcher<ApiKey & { key: string }>("/apikeys", {
        method: "POST",
        body: JSON.stringify({ name }),
    }),
    deleteApiKey: (id: string) => fetcher<null>(`/apikeys/${encodeURIComponent(id)}`, { method: "DELETE" }),
};
