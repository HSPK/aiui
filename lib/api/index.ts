// Re-export everything from each domain-specific API module so callers can
// either do `import { api } from "@/lib/api"` (legacy aggregate) or
// `import { providersApi } from "@/lib/api/providers"` (lean per-domain).

import { authApi } from "./auth";
import { usersApi } from "./users";
import { providersApi } from "./providers";
import { modelsApi } from "./models";
import { apiKeysApi } from "./apikeys";
import { logsApi } from "./logs";
import { conversationsApi, messagesApi } from "./conversations";
import { gatewayApi } from "./gateway";
import { capabilitiesApi } from "./capabilities";

export { ApiError, fetcher, rawFetch, withQuery, API_BASE } from "./client";

export {
    authApi,
    usersApi,
    providersApi,
    modelsApi,
    apiKeysApi,
    logsApi,
    conversationsApi,
    messagesApi,
    gatewayApi,
    capabilitiesApi,
};

/**
 * Convenience aggregate: matches the historic `api.*` shape so existing
 * callers can be migrated incrementally. New code should import the
 * per-domain modules directly.
 */
export const api = {
    // Auth
    login: authApi.login,
    logout: authApi.logout,
    getMe: authApi.me,

    // Providers
    getProviders: providersApi.list,
    getProvider: providersApi.get,
    getProviderModels: providersApi.listModels,
    createProvider: providersApi.create,
    updateProvider: providersApi.update,
    deleteProvider: providersApi.remove,
    reloadProviders: providersApi.reload,
    checkProvider: providersApi.check,

    // Models
    getModels: modelsApi.list,
    getModel: modelsApi.get,
    createModel: modelsApi.create,
    updateModel: modelsApi.update,
    deleteModel: modelsApi.remove,

    // Users
    getUsers: usersApi.list,
    createUser: usersApi.create,
    updateUser: usersApi.update,
    deleteUser: usersApi.remove,

    // API keys
    listApiKeys: apiKeysApi.list,
    createApiKey: apiKeysApi.create,
    deleteApiKey: apiKeysApi.remove,

    // Capabilities
    listCapabilities: capabilitiesApi.list,

    // Logs
    getLogs: logsApi.list,
    getLogDetail: logsApi.get,

    // Conversations / messages
    getConversations: conversationsApi.list,
    getConversationMessages: conversationsApi.listMessages,
    deleteConversation: conversationsApi.remove,
    updateConversationTitle: conversationsApi.updateTitle,
    rateMessage: messagesApi.rate,

    // Gateway streaming
    playgroundChat: gatewayApi.playgroundChat,
    generateTitle: (model: string, user: string, assistant: string) =>
        gatewayApi.generateTitle({ model, user, assistant }),

    // Misc
    ping: () => fetch(`${process.env.NEXT_PUBLIC_API_URL || "/api"}/ping`, { credentials: "include" }).then((r) => r.text()),
    health: () => fetch(`${process.env.NEXT_PUBLIC_API_URL || "/api"}/health`, { credentials: "include" }).then((r) => r.json()),
};
