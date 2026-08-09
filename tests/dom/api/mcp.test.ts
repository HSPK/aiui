import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { mcpServers } from "@/lib/api/mcp";
import type { McpServerDTO } from "@/lib/schemas/mcp";
import { createQueryWrapper, installFetchMock, okJson, sseResponse } from "./test-helpers";

function serverFixture(overrides: Partial<McpServerDTO> = {}): McpServerDTO {
    return {
        id: "1",
        name: "filesystem",
        description: "",
        transport: "stdio",
        config: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem"] },
        enabled: true,
        last_check_status: null,
        last_check_at: null,
        last_check_error: null,
        tools_cache: null,
        ...overrides,
    } as McpServerDTO;
}

function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

describe("lib/api/mcp base CRUD", () => {
    it("is wired to /mcp/servers with key 'mcp-servers' and array listShape", async () => {
        const fetchMock = installFetchMock();
        fetchMock.mockResolvedValueOnce(okJson([serverFixture()]));
        await mcpServers.list();
        expect(fetchMock.mock.calls[0][0]).toBe("/api/mcp/servers");
        expect(mcpServers.keys.all()).toEqual(["mcp-servers"]);
    });
});

describe("lib/api/mcp presets", () => {
    it("listPresets() GETs /mcp/presets", async () => {
        const fetchMock = installFetchMock();
        fetchMock.mockResolvedValueOnce(okJson([{ id: "fs", name: "Filesystem", category: "files" }]));
        const data = await mcpServers.listPresets();
        expect(fetchMock.mock.calls[0][0]).toBe("/api/mcp/presets");
        expect(data).toEqual([{ id: "fs", name: "Filesystem", category: "files" }]);
    });

    it("usePresets() fetches on mount with a 5-minute staleTime key", async () => {
        const fetchMock = installFetchMock();
        fetchMock.mockResolvedValueOnce(okJson([]));
        const { Wrapper } = createQueryWrapper();
        const { result } = renderHook(() => mcpServers.usePresets(), { wrapper: Wrapper });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(fetchMock.mock.calls[0][0]).toBe("/api/mcp/presets");
    });
});

describe("lib/api/mcp check (one-shot)", () => {
    it("check() POSTs /mcp/servers/<id>/check", async () => {
        const fetchMock = installFetchMock();
        fetchMock.mockResolvedValueOnce(okJson(serverFixture({ last_check_status: "ok" })));
        const data = await mcpServers.check("1");
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("/api/mcp/servers/1/check");
        expect(init.method).toBe("POST");
        expect(data.last_check_status).toBe("ok");
    });

    describe("useCheck", () => {
        it("tracks per-id pending state and invalidates base keys on success", async () => {
            const fetchMock = installFetchMock();
            const d1 = deferred<Response>();
            fetchMock.mockImplementationOnce(() => d1.promise);
            const { Wrapper, queryClient } = createQueryWrapper();
            const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
            const onSuccess = vi.fn();

            const { result } = renderHook(() => mcpServers.useCheck({ onSuccess }), { wrapper: Wrapper });
            expect(result.current.anyPending).toBe(false);

            act(() => {
                result.current.mutate("1");
            });
            await waitFor(() => expect(result.current.isPendingId("1")).toBe(true));
            expect(result.current.pendingCount).toBe(1);

            await act(async () => {
                d1.resolve(okJson(serverFixture({ last_check_status: "ok" })));
                await d1.promise;
            });
            await waitFor(() => expect(result.current.isPendingId("1")).toBe(false));
            expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ last_check_status: "ok" }));
            expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["mcp-servers"] });
        });

        it("calls onError without invalidating on failure", async () => {
            const fetchMock = installFetchMock();
            fetchMock.mockResolvedValueOnce(
                new Response(JSON.stringify({ code: 500, msg: "spawn failed" }), { status: 500 })
            );
            const { Wrapper, queryClient } = createQueryWrapper();
            const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
            const onError = vi.fn();

            const { result } = renderHook(() => mcpServers.useCheck({ onError }), { wrapper: Wrapper });
            await act(async () => {
                await expect(result.current.mutateAsync("1")).rejects.toThrow();
            });
            expect(onError).toHaveBeenCalledWith(expect.any(Error));
            expect(invalidateSpy).not.toHaveBeenCalled();
            await waitFor(() => expect(result.current.isPendingId("1")).toBe(false));
        });
    });
});

describe("lib/api/mcp checkStream (SSE)", () => {
    it("parses one frame per chunk in order and resolves with the last result's server", async () => {
        const fetchMock = installFetchMock();
        fetchMock.mockResolvedValueOnce(
            sseResponse([
                `data: ${JSON.stringify({ type: "phase", phase: "spawning" })}\n\n`,
                `data: ${JSON.stringify({ type: "result", server: serverFixture({ last_check_status: "ok" }) })}\n\n`,
            ])
        );
        const onEvent = vi.fn();
        const result = await mcpServers.checkStream("1", onEvent);

        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("/api/mcp/servers/1/check");
        expect(init.method).toBe("POST");
        expect((init.headers as Record<string, string>).Accept).toBe("text/event-stream");
        expect(onEvent).toHaveBeenNthCalledWith(1, { type: "phase", phase: "spawning" });
        expect(onEvent).toHaveBeenNthCalledWith(2, { type: "result", server: expect.objectContaining({ last_check_status: "ok" }) });
        expect(result?.last_check_status).toBe("ok");
    });

    it("reassembles a single SSE frame split across multiple stream chunks", async () => {
        const fetchMock = installFetchMock();
        const full = `data: ${JSON.stringify({ type: "log", line: "hello world" })}\n\n`;
        const splitAt = 20;
        fetchMock.mockResolvedValueOnce(sseResponse([full.slice(0, splitAt), full.slice(splitAt)]));
        const onEvent = vi.fn();
        await mcpServers.checkStream("1", onEvent);
        expect(onEvent).toHaveBeenCalledTimes(1);
        expect(onEvent).toHaveBeenCalledWith({ type: "log", line: "hello world" });
    });

    it("parses multiple frames delivered within a single chunk", async () => {
        const fetchMock = installFetchMock();
        fetchMock.mockResolvedValueOnce(
            sseResponse([
                `data: ${JSON.stringify({ type: "log", line: "one" })}\n\n` +
                    `data: ${JSON.stringify({ type: "log", line: "two" })}\n\n`,
            ])
        );
        const onEvent = vi.fn();
        await mcpServers.checkStream("1", onEvent);
        expect(onEvent).toHaveBeenNthCalledWith(1, { type: "log", line: "one" });
        expect(onEvent).toHaveBeenNthCalledWith(2, { type: "log", line: "two" });
    });

    it("silently skips a frame whose data line is not valid JSON", async () => {
        const fetchMock = installFetchMock();
        fetchMock.mockResolvedValueOnce(
            sseResponse([
                "data: {not valid json\n\n",
                `data: ${JSON.stringify({ type: "log", line: "ok" })}\n\n`,
            ])
        );
        const onEvent = vi.fn();
        await mcpServers.checkStream("1", onEvent);
        expect(onEvent).toHaveBeenCalledTimes(1);
        expect(onEvent).toHaveBeenCalledWith({ type: "log", line: "ok" });
    });

    it("silently skips a frame with no 'data: ' line", async () => {
        const fetchMock = installFetchMock();
        fetchMock.mockResolvedValueOnce(
            sseResponse([
                "event: ping\n\n",
                `data: ${JSON.stringify({ type: "log", line: "ok" })}\n\n`,
            ])
        );
        const onEvent = vi.fn();
        await mcpServers.checkStream("1", onEvent);
        expect(onEvent).toHaveBeenCalledTimes(1);
    });

    it("throws 'No response body' when the response has a null body", async () => {
        const fetchMock = installFetchMock();
        fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
        await expect(mcpServers.checkStream("1", vi.fn())).rejects.toThrow("No response body");
    });

    it("forwards the AbortSignal to the underlying fetch call", async () => {
        const fetchMock = installFetchMock();
        fetchMock.mockResolvedValueOnce(sseResponse([]));
        const ctrl = new AbortController();
        await mcpServers.checkStream("1", vi.fn(), { signal: ctrl.signal });
        const [, init] = fetchMock.mock.calls[0];
        expect(init.signal).toBe(ctrl.signal);
    });

    it("keeps the server payload from an error event as the resolved value", async () => {
        const fetchMock = installFetchMock();
        fetchMock.mockResolvedValueOnce(
            sseResponse([
                `data: ${JSON.stringify({ type: "error", message: "boom", server: serverFixture({ last_check_status: "error" }) })}\n\n`,
            ])
        );
        const onEvent = vi.fn();
        const result = await mcpServers.checkStream("1", onEvent);
        expect(onEvent).toHaveBeenCalledWith({ type: "error", message: "boom", server: expect.objectContaining({ last_check_status: "error" }) });
        expect(result?.last_check_status).toBe("error");
    });

    it("resolves with null when no result/error-with-server event was ever seen", async () => {
        const fetchMock = installFetchMock();
        fetchMock.mockResolvedValueOnce(
            sseResponse([`data: ${JSON.stringify({ type: "error", message: "boom" })}\n\n`])
        );
        const result = await mcpServers.checkStream("1", vi.fn());
        expect(result).toBeNull();
    });
});

describe("lib/api/mcp useCheckStream", () => {
    it("run() streams phase/log events into state and resolves with the final server", async () => {
        const fixture = serverFixture({ last_check_status: "ok" });
        const streamSpy = vi.spyOn(mcpServers, "checkStream").mockImplementation(async (_id, onEvent) => {
            onEvent({ type: "phase", phase: "connecting" });
            onEvent({ type: "log", line: "line1" });
            onEvent({ type: "result", server: fixture });
            return fixture;
        });
        try {
            const { Wrapper, queryClient } = createQueryWrapper();
            const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
            const { result } = renderHook(() => mcpServers.useCheckStream(), { wrapper: Wrapper });

            let final: McpServerDTO | null = null;
            await act(async () => {
                final = await result.current.run("1");
            });

            expect(final).toEqual(fixture);
            expect(result.current.phase).toBe("connecting");
            expect(result.current.logs).toEqual(["line1"]);
            expect(result.current.result).toEqual(fixture);
            expect(result.current.error).toBeNull();
            expect(result.current.isChecking).toBe(false);
            expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["mcp-servers"] });
        } finally {
            streamSpy.mockRestore();
        }
    });

    it("reset()s phase/logs/error/result back to defaults at the start of every run()", async () => {
        const fixture = serverFixture();
        const first = deferred<McpServerDTO | null>();
        const streamSpy = vi.spyOn(mcpServers, "checkStream")
            .mockImplementationOnce(async (_id, onEvent) => {
                onEvent({ type: "phase", phase: "connecting" });
                onEvent({ type: "log", line: "from-first-run" });
                return first.promise;
            });
        try {
            const { Wrapper } = createQueryWrapper();
            const { result } = renderHook(() => mcpServers.useCheckStream(), { wrapper: Wrapper });

            let firstRunPromise!: Promise<McpServerDTO | null>;
            act(() => {
                firstRunPromise = result.current.run("1");
            });
            await waitFor(() => expect(result.current.phase).toBe("connecting"));
            expect(result.current.logs).toEqual(["from-first-run"]);

            await act(async () => {
                first.resolve(fixture);
                await firstRunPromise;
            });
            expect(result.current.logs).toEqual(["from-first-run"]);

            // Second run should synchronously clear state via reset() before
            // any new events arrive — verify with a still-pending mock.
            const second = deferred<McpServerDTO | null>();
            streamSpy.mockImplementationOnce(() => second.promise);
            act(() => {
                void result.current.run("2");
            });
            expect(result.current.phase).toBeNull();
            expect(result.current.logs).toEqual([]);
            expect(result.current.result).toBeNull();
            expect(result.current.isChecking).toBe(true);

            await act(async () => {
                second.resolve(null);
                await second.promise.catch(() => undefined);
            });
        } finally {
            streamSpy.mockRestore();
        }
    });

    it("cancel() aborts the in-flight run and immediately flips isChecking off", async () => {
        let capturedSignal: AbortSignal | undefined;
        const pending = deferred<McpServerDTO | null>();
        const streamSpy = vi.spyOn(mcpServers, "checkStream").mockImplementation(async (_id, _onEvent, opts) => {
            capturedSignal = opts?.signal;
            opts?.signal?.addEventListener("abort", () => {
                pending.reject(new DOMException("Aborted", "AbortError"));
            });
            return pending.promise;
        });
        try {
            const { Wrapper } = createQueryWrapper();
            const { result } = renderHook(() => mcpServers.useCheckStream(), { wrapper: Wrapper });

            let runPromise!: Promise<McpServerDTO | null>;
            act(() => {
                runPromise = result.current.run("1");
            });
            await waitFor(() => expect(result.current.isChecking).toBe(true));

            act(() => {
                result.current.cancel();
            });
            expect(result.current.isChecking).toBe(false);
            expect(capturedSignal?.aborted).toBe(true);

            await act(async () => {
                await expect(runPromise).resolves.toBeNull();
            });
            // Aborted requests must not surface as a user-visible error.
            expect(result.current.error).toBeNull();
        } finally {
            streamSpy.mockRestore();
        }
    });

    it("an in-stream error event (with a partial server payload) sets both error and result", async () => {
        const partial = serverFixture({ last_check_status: "error", last_check_error: "spawn ENOENT" });
        const streamSpy = vi.spyOn(mcpServers, "checkStream").mockImplementation(async (_id, onEvent) => {
            onEvent({ type: "error", message: "spawn ENOENT", server: partial });
            return partial;
        });
        try {
            const { Wrapper } = createQueryWrapper();
            const { result } = renderHook(() => mcpServers.useCheckStream(), { wrapper: Wrapper });
            await act(async () => {
                await result.current.run("1");
            });
            expect(result.current.error).toBe("spawn ENOENT");
            expect(result.current.result).toEqual(partial);
        } finally {
            streamSpy.mockRestore();
        }
    });

    it("an in-stream error event without a server payload sets error but leaves result untouched", async () => {
        const streamSpy = vi.spyOn(mcpServers, "checkStream").mockImplementation(async (_id, onEvent) => {
            onEvent({ type: "error", message: "no server info" });
            return null;
        });
        try {
            const { Wrapper } = createQueryWrapper();
            const { result } = renderHook(() => mcpServers.useCheckStream(), { wrapper: Wrapper });
            await act(async () => {
                await result.current.run("1");
            });
            expect(result.current.error).toBe("no server info");
            expect(result.current.result).toBeNull();
        } finally {
            streamSpy.mockRestore();
        }
    });

    it("sets error (and resolves null) when checkStream rejects with a non-abort error", async () => {
        const streamSpy = vi.spyOn(mcpServers, "checkStream").mockRejectedValueOnce(new Error("connection refused"));
        try {
            const { Wrapper } = createQueryWrapper();
            const { result } = renderHook(() => mcpServers.useCheckStream(), { wrapper: Wrapper });

            let final: McpServerDTO | null = null;
            await act(async () => {
                final = await result.current.run("1");
            });
            expect(final).toBeNull();            expect(result.current.error).toBe("connection refused");
            expect(result.current.isChecking).toBe(false);
        } finally {
            streamSpy.mockRestore();
        }
    });

    it("aborts any in-flight run when the component unmounts", async () => {
        let capturedSignal: AbortSignal | undefined;
        const pending = deferred<McpServerDTO | null>();
        const streamSpy = vi.spyOn(mcpServers, "checkStream").mockImplementation(async (_id, _onEvent, opts) => {
            capturedSignal = opts?.signal;
            return pending.promise;
        });
        try {
            const { Wrapper } = createQueryWrapper();
            const { result, unmount } = renderHook(() => mcpServers.useCheckStream(), { wrapper: Wrapper });
            act(() => {
                void result.current.run("1");
            });
            await waitFor(() => expect(capturedSignal).toBeDefined());
            unmount();
            expect(capturedSignal?.aborted).toBe(true);
            pending.resolve(null);
        } finally {
            streamSpy.mockRestore();
        }
    });

    it("reset() clears state on demand without an in-flight run", async () => {
        const fixture = serverFixture();
        const streamSpy = vi.spyOn(mcpServers, "checkStream").mockImplementation(async (_id, onEvent) => {
            onEvent({ type: "phase", phase: "ready" });
            onEvent({ type: "result", server: fixture });
            return fixture;
        });
        try {
            const { Wrapper } = createQueryWrapper();
            const { result } = renderHook(() => mcpServers.useCheckStream(), { wrapper: Wrapper });
            await act(async () => {
                await result.current.run("1");
            });
            expect(result.current.phase).toBe("ready");

            act(() => {
                result.current.reset();
            });
            expect(result.current.phase).toBeNull();
            expect(result.current.logs).toEqual([]);
            expect(result.current.result).toBeNull();
            expect(result.current.error).toBeNull();
        } finally {
            streamSpy.mockRestore();
        }
    });
});

describe("lib/api/mcp runtime status + lifecycle", () => {
    it("runtimeKey(id) builds a stable tuple", () => {
        expect(mcpServers.runtimeKey("1")).toEqual(["mcp-servers", "1", "runtime"]);
    });

    it("runtime(id) GETs /mcp/servers/<id>/runtime with no query when logLines is omitted", async () => {
        const fetchMock = installFetchMock();
        fetchMock.mockResolvedValueOnce(
            okJson({ server_id: "1", status: "connected", pid: 123, started_at: null, built_for: null, error: null, recent_logs: [] })
        );
        await mcpServers.runtime("1");
        expect(fetchMock.mock.calls[0][0]).toBe("/api/mcp/servers/1/runtime");
    });

    it("runtime(id, logLines) appends ?log_lines=<n>", async () => {
        const fetchMock = installFetchMock();
        fetchMock.mockResolvedValueOnce(
            okJson({ server_id: "1", status: "connected", pid: 123, started_at: null, built_for: null, error: null, recent_logs: [] })
        );
        await mcpServers.runtime("1", 50);
        expect(fetchMock.mock.calls[0][0]).toBe("/api/mcp/servers/1/runtime?log_lines=50");
    });

    describe("useRuntime", () => {
        it("is disabled (uses a sentinel key) when id is null", () => {
            const fetchMock = installFetchMock();
            const { Wrapper } = createQueryWrapper();
            const { result } = renderHook(() => mcpServers.useRuntime(null), { wrapper: Wrapper });
            expect(result.current.fetchStatus).toBe("idle");
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it("is disabled when opts.enabled is explicitly false, even with an id", () => {
            const fetchMock = installFetchMock();
            const { Wrapper } = createQueryWrapper();
            const { result } = renderHook(() => mcpServers.useRuntime("1", { enabled: false }), { wrapper: Wrapper });
            expect(result.current.fetchStatus).toBe("idle");
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it("fetches when an id is supplied and enabled is not false", async () => {
            const fetchMock = installFetchMock();
            fetchMock.mockResolvedValueOnce(
                okJson({ server_id: "1", status: "connected", pid: 1, started_at: null, built_for: null, error: null, recent_logs: [] })
            );
            const { Wrapper } = createQueryWrapper();
            const { result } = renderHook(() => mcpServers.useRuntime("1"), { wrapper: Wrapper });
            await waitFor(() => expect(result.current.isSuccess).toBe(true));
            expect(fetchMock.mock.calls[0][0]).toBe("/api/mcp/servers/1/runtime");
        });
    });

    describe("stop / useStop", () => {
        it("stop() POSTs /mcp/servers/<id>/stop", async () => {
            const fetchMock = installFetchMock();
            fetchMock.mockResolvedValueOnce(
                okJson({ server_id: "1", status: "idle", pid: null, started_at: null, built_for: null, error: null, recent_logs: [] })
            );
            await mcpServers.stop("1");
            const [url, init] = fetchMock.mock.calls[0];
            expect(url).toBe("/api/mcp/servers/1/stop");
            expect(init.method).toBe("POST");
        });

        it("useStop invalidates both the runtime key and the base list on success", async () => {
            const fetchMock = installFetchMock();
            fetchMock.mockResolvedValueOnce(
                okJson({ server_id: "1", status: "idle", pid: null, started_at: null, built_for: null, error: null, recent_logs: [] })
            );
            const { Wrapper, queryClient } = createQueryWrapper();
            const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
            const onSuccess = vi.fn();
            const { result } = renderHook(() => mcpServers.useStop({ onSuccess }), { wrapper: Wrapper });
            await act(async () => {
                await result.current.mutateAsync("1");
            });
            expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["mcp-servers", "1", "runtime"] });
            expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["mcp-servers"] });
            expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ status: "idle" }));
        });

        it("useStop calls onError on failure", async () => {
            const fetchMock = installFetchMock();
            fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ code: 500, msg: "fail" }), { status: 500 }));
            const onError = vi.fn();
            const { Wrapper } = createQueryWrapper();
            const { result } = renderHook(() => mcpServers.useStop({ onError }), { wrapper: Wrapper });
            await act(async () => {
                await expect(result.current.mutateAsync("1")).rejects.toThrow();
            });
            expect(onError).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe("restart / useRestart", () => {
        it("restart() POSTs /mcp/servers/<id>/restart", async () => {
            const fetchMock = installFetchMock();
            fetchMock.mockResolvedValueOnce(okJson(serverFixture({ last_check_status: "ok" })));
            await mcpServers.restart("1");
            const [url, init] = fetchMock.mock.calls[0];
            expect(url).toBe("/api/mcp/servers/1/restart");
            expect(init.method).toBe("POST");
        });

        it("useRestart invalidates both the runtime key and the base list on success", async () => {
            const fetchMock = installFetchMock();
            fetchMock.mockResolvedValueOnce(okJson(serverFixture({ last_check_status: "ok" })));
            const { Wrapper, queryClient } = createQueryWrapper();
            const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
            const onSuccess = vi.fn();
            const { result } = renderHook(() => mcpServers.useRestart({ onSuccess }), { wrapper: Wrapper });
            await act(async () => {
                await result.current.mutateAsync("1");
            });
            expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["mcp-servers", "1", "runtime"] });
            expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["mcp-servers"] });
            expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ last_check_status: "ok" }));
        });

        it("useRestart calls onError on failure", async () => {
            const fetchMock = installFetchMock();
            fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ code: 500, msg: "fail" }), { status: 500 }));
            const onError = vi.fn();
            const { Wrapper } = createQueryWrapper();
            const { result } = renderHook(() => mcpServers.useRestart({ onError }), { wrapper: Wrapper });
            await act(async () => {
                await expect(result.current.mutateAsync("1")).rejects.toThrow();
            });
            expect(onError).toHaveBeenCalledWith(expect.any(Error));
        });
    });
});
