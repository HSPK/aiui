import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CANCEL = Symbol("cancel-sentinel");

vi.mock("@clack/prompts", () => ({
    cancel: vi.fn(),
    isCancel: (v: unknown) => v === CANCEL,
}));

import { cancel } from "@clack/prompts";
import { ask, bail, defined } from "@/lib/cli/init/prompts";

describe("lib/cli/init/prompts", () => {
    let exitSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.mocked(cancel).mockReset();
        // Throwing (rather than a silent `undefined as never`) faithfully
        // mimics process.exit's real synchronous-terminal behaviour so we
        // don't fall through into code that assumes the process is gone.
        exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
            throw new Error(`__PROCESS_EXIT_${code}__`);
        });
    });

    afterEach(() => {
        exitSpy.mockRestore();
    });

    describe("bail", () => {
        it("calls cancel(reason) then process.exit(1)", () => {
            expect(() => bail("Cancelled.")).toThrow("__PROCESS_EXIT_1__");
            expect(cancel).toHaveBeenCalledWith("Cancelled.");
            expect(exitSpy).toHaveBeenCalledWith(1);
        });
    });

    describe("ask", () => {
        it("resolves to the value when it isn't a cancellation", async () => {
            await expect(ask(Promise.resolve("hello"))).resolves.toBe("hello");
            expect(cancel).not.toHaveBeenCalled();
            expect(exitSpy).not.toHaveBeenCalled();
        });

        it("passes through falsy-but-valid values (empty string) untouched", async () => {
            await expect(ask(Promise.resolve(""))).resolves.toBe("");
        });

        it("bails when the awaited value is the cancel sentinel", async () => {
            await expect(ask(Promise.resolve(CANCEL))).rejects.toThrow("__PROCESS_EXIT_1__");
            expect(cancel).toHaveBeenCalledWith("Cancelled.");
        });
    });

    describe("defined", () => {
        it("short-circuits to undefined without calling the wrapped validator", () => {
            const inner = vi.fn(() => "should not run");
            const wrapped = defined(inner);
            expect(wrapped(undefined)).toBeUndefined();
            expect(inner).not.toHaveBeenCalled();
        });

        it("delegates to the wrapped validator for a defined string, returning its verdict", () => {
            const inner = vi.fn((v: string) => (v.length >= 2 ? undefined : "too short"));
            const wrapped = defined(inner);

            expect(wrapped("ab")).toBeUndefined();
            expect(wrapped("a")).toBe("too short");
            expect(inner).toHaveBeenCalledWith("ab");
            expect(inner).toHaveBeenCalledWith("a");
        });

        it("passes an empty string through to the validator (not treated as undefined)", () => {
            const inner = vi.fn(() => "empty!");
            const wrapped = defined(inner);
            expect(wrapped("")).toBe("empty!");
            expect(inner).toHaveBeenCalledWith("");
        });
    });
});
