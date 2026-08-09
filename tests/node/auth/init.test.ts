// lib/server/init.ts — ensureInit(): a memoised, run-once startup hook
// (config file hoisting -> admin bootstrap) invoked by every defineRoute
// call. Both `bootstrapAdmin` and `loadConfigFile` are mocked so we can
// drive each branch without touching the filesystem or hashing a real
// password; `initPromise` is a module-level flag, so every test gets a
// fully fresh module graph via vi.resetModules() + dynamic import.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/bootstrap", () => ({ bootstrapAdmin: vi.fn() }));
vi.mock("@/lib/server/config", () => ({ loadConfigFile: vi.fn() }));

async function freshInit() {
    vi.resetModules();
    const { bootstrapAdmin } = await import("@/lib/server/bootstrap");
    const { loadConfigFile } = await import("@/lib/server/config");
    const { ensureInit } = await import("@/lib/server/init");
    const bootstrapAdminMock = vi.mocked(bootstrapAdmin).mockReset().mockResolvedValue(undefined);
    const loadConfigFileMock = vi.mocked(loadConfigFile).mockReset().mockReturnValue(undefined);
    return { ensureInit, bootstrapAdminMock, loadConfigFileMock };
}

describe("init: ensureInit", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it("calls loadConfigFile() then bootstrapAdmin(), in that order, on the first call", async () => {
        const { ensureInit, bootstrapAdminMock, loadConfigFileMock } = await freshInit();
        const order: string[] = [];
        loadConfigFileMock.mockImplementation(() => {
            order.push("config");
        });
        bootstrapAdminMock.mockImplementation(async () => {
            order.push("bootstrap");
        });

        await ensureInit();

        expect(order).toEqual(["config", "bootstrap"]);
        expect(loadConfigFileMock).toHaveBeenCalledTimes(1);
        expect(bootstrapAdminMock).toHaveBeenCalledTimes(1);
    });

    it("memoises: concurrent calls before the first resolves share one underlying run", async () => {
        const { ensureInit, bootstrapAdminMock, loadConfigFileMock } = await freshInit();

        const [a, b, c] = await Promise.all([ensureInit(), ensureInit(), ensureInit()]);
        expect(a).toBe(undefined);
        expect(b).toBe(undefined);
        expect(c).toBe(undefined);
        expect(loadConfigFileMock).toHaveBeenCalledTimes(1);
        expect(bootstrapAdminMock).toHaveBeenCalledTimes(1);
    });

    it("memoises: sequential calls after the first has resolved never re-run either step", async () => {
        const { ensureInit, bootstrapAdminMock, loadConfigFileMock } = await freshInit();

        await ensureInit();
        await ensureInit();
        await ensureInit();

        expect(loadConfigFileMock).toHaveBeenCalledTimes(1);
        expect(bootstrapAdminMock).toHaveBeenCalledTimes(1);
    });

    it("returns the exact same promise reference on every call", async () => {
        const { ensureInit } = await freshInit();
        const p1 = ensureInit();
        const p2 = ensureInit();
        expect(p1).toBe(p2);
        await p1;
        expect(ensureInit()).toBe(p1);
    });

    it("a synchronous throw from loadConfigFile() is caught + logged, and bootstrapAdmin() still runs", async () => {
        const { ensureInit, bootstrapAdminMock, loadConfigFileMock } = await freshInit();
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});
        loadConfigFileMock.mockImplementation(() => {
            throw new Error("config file is malformed");
        });

        await expect(ensureInit()).resolves.toBeUndefined();

        expect(spy).toHaveBeenCalledWith("[loom] config file load failed:", expect.any(Error));
        expect(bootstrapAdminMock).toHaveBeenCalledTimes(1);
    });

    it("a rejection from bootstrapAdmin() propagates from ensureInit(), and is NOT retried on later calls", async () => {
        const { ensureInit, bootstrapAdminMock, loadConfigFileMock } = await freshInit();
        bootstrapAdminMock.mockRejectedValue(new Error("db is locked"));

        await expect(ensureInit()).rejects.toThrow("db is locked");
        // Calling again returns the SAME already-rejected promise rather than
        // retrying the (possibly transient) failure — documents current
        // behaviour: neither dependency is invoked a second time.
        await expect(ensureInit()).rejects.toThrow("db is locked");

        expect(loadConfigFileMock).toHaveBeenCalledTimes(1);
        expect(bootstrapAdminMock).toHaveBeenCalledTimes(1);
    });
});
