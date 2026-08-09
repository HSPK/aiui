import { describe, expect, it } from "vitest";

import * as barrel from "@/lib/api/index";
import { auth } from "@/lib/api/auth";
import { users } from "@/lib/api/users";
import { providers } from "@/lib/api/providers";
import { models } from "@/lib/api/models";
import { apiKeys } from "@/lib/api/apikeys";
import { logs } from "@/lib/api/logs";
import { conversations, messages } from "@/lib/api/conversations";
import { gateway } from "@/lib/api/gateway";
import { capabilities } from "@/lib/api/capabilities";
import { preferences } from "@/lib/api/preferences";
import { adapters } from "@/lib/api/adapters";
import { variants } from "@/lib/api/variants";
import { tools } from "@/lib/api/tools";
import { mcpServers } from "@/lib/api/mcp";
import { stats } from "@/lib/api/stats";
import { ApiError, fetcher, rawFetch, withQuery, API_BASE } from "@/lib/api/client";
import { defineResource } from "@/lib/api/resource";

// `lib/api/index.ts` is a pure barrel: every export must be the exact same
// reference as the underlying domain module's export (no wrapping/cloning)
// and nothing should be missing or renamed.
describe("lib/api/index (barrel re-export)", () => {
    it("re-exports every domain resource object by identity", () => {
        expect(barrel.auth).toBe(auth);
        expect(barrel.users).toBe(users);
        expect(barrel.providers).toBe(providers);
        expect(barrel.models).toBe(models);
        expect(barrel.apiKeys).toBe(apiKeys);
        expect(barrel.logs).toBe(logs);
        expect(barrel.conversations).toBe(conversations);
        expect(barrel.messages).toBe(messages);
        expect(barrel.gateway).toBe(gateway);
        expect(barrel.capabilities).toBe(capabilities);
        expect(barrel.preferences).toBe(preferences);
        expect(barrel.adapters).toBe(adapters);
        expect(barrel.variants).toBe(variants);
        expect(barrel.tools).toBe(tools);
        expect(barrel.mcpServers).toBe(mcpServers);
        expect(barrel.stats).toBe(stats);
    });

    it("re-exports the client primitives by identity", () => {
        expect(barrel.ApiError).toBe(ApiError);
        expect(barrel.fetcher).toBe(fetcher);
        expect(barrel.rawFetch).toBe(rawFetch);
        expect(barrel.withQuery).toBe(withQuery);
        expect(barrel.API_BASE).toBe(API_BASE);
    });

    it("re-exports the defineResource factory by identity", () => {
        expect(barrel.defineResource).toBe(defineResource);
    });

    it("does not export anything unexpected", () => {
        const expectedKeys = [
            "auth",
            "users",
            "providers",
            "models",
            "apiKeys",
            "logs",
            "conversations",
            "messages",
            "gateway",
            "capabilities",
            "preferences",
            "adapters",
            "variants",
            "tools",
            "mcpServers",
            "stats",
            "ApiError",
            "fetcher",
            "rawFetch",
            "withQuery",
            "API_BASE",
            "defineResource",
        ].sort();
        expect(Object.keys(barrel).sort()).toEqual(expectedKeys);
    });
});
