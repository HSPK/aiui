// Centralized TanStack Query keys. Importing these from one place keeps
// invalidations and prefetches in sync as the API surface grows.

type Filters = Record<string, unknown>;

export const queryKeys = {
    me: () => ["user", "me"] as const,

    providers: {
        all: () => ["providers"] as const,
        one: (id: string) => ["providers", id] as const,
        models: (id: string) => ["providers", id, "models"] as const,
    },

    models: {
        all: () => ["models"] as const,
        one: (id: string) => ["models", id] as const,
    },

    users: {
        all: () => ["users"] as const,
        list: (filters: Filters) => ["users", filters as unknown] as const,
    },

    apikeys: {
        all: () => ["apikeys"] as const,
    },

    capabilities: {
        all: () => ["capabilities"] as const,
    },

    logs: {
        all: () => ["logs"] as const,
        list: (filters: Filters) => ["logs", filters as unknown] as const,
        one: (id: string) => ["logs", id] as const,
    },

    conversations: {
        all: () => ["conversations"] as const,
        list: (filters: Filters) => ["conversations", filters as unknown] as const,
        messages: (id: string) => ["conversations", id, "messages"] as const,
    },
} as const;
