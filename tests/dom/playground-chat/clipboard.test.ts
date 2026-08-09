// Coverage for lib/clipboard.ts — the non-secure-context-safe clipboard
// helper. Pure async function, no React involved.
import { afterEach, describe, expect, it, vi } from "vitest";

import { copyToClipboard } from "@/lib/clipboard";

/** Defines `navigator.clipboard` for the duration of one test. jsdom
 *  doesn't implement the Clipboard API, so the property doesn't exist
 *  by default — this adds a configurable stand-in that `afterEach`
 *  below tears down. */
function stubClipboard(impl: { writeText: (text: string) => Promise<void> } | undefined) {
    Object.defineProperty(navigator, "clipboard", {
        value: impl,
        configurable: true,
        writable: true,
    });
}

function stubSecureContext(value: boolean) {
    Object.defineProperty(window, "isSecureContext", {
        value,
        configurable: true,
        writable: true,
    });
}

/** jsdom doesn't implement `document.execCommand` at all (the property
 *  doesn't exist), so `vi.spyOn` can't wrap it — define it directly. */
function stubExecCommand(impl: (command: string) => boolean) {
    const fn = vi.fn(impl);
    Object.defineProperty(document, "execCommand", {
        value: fn,
        configurable: true,
        writable: true,
    });
    return fn;
}

afterEach(() => {
    vi.unstubAllGlobals();
    stubClipboard(undefined);
    stubSecureContext(true);
    document.body.innerHTML = "";
});

describe("copyToClipboard", () => {
    it("returns false immediately when window is undefined (SSR guard)", async () => {
        vi.stubGlobal("window", undefined);
        const ok = await copyToClipboard("hello");
        expect(ok).toBe(false);
    });

    it("uses navigator.clipboard.writeText when available in a secure context", async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        stubClipboard({ writeText });
        stubSecureContext(true);

        const ok = await copyToClipboard("secret-key-123");

        expect(ok).toBe(true);
        expect(writeText).toHaveBeenCalledWith("secret-key-123");
        // Modern path succeeded — no leftover legacy textarea in the DOM.
        expect(document.body.querySelector("textarea")).toBeNull();
    });

    it("falls back to document.execCommand when navigator.clipboard.writeText rejects", async () => {
        const writeText = vi.fn().mockRejectedValue(new Error("permission denied"));
        stubClipboard({ writeText });
        stubSecureContext(true);
        const execCommand = stubExecCommand(() => true);

        const ok = await copyToClipboard("fallback-text");

        expect(writeText).toHaveBeenCalledWith("fallback-text");
        expect(execCommand).toHaveBeenCalledWith("copy");
        expect(ok).toBe(true);
        // Temporary textarea must be cleaned up after the copy.
        expect(document.body.querySelector("textarea")).toBeNull();
    });

    it("skips the modern API entirely outside a secure context (plain-http LAN deployment)", async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        stubClipboard({ writeText });
        stubSecureContext(false);
        const execCommand = stubExecCommand(() => true);

        const ok = await copyToClipboard("lan-text");

        expect(writeText).not.toHaveBeenCalled();
        expect(execCommand).toHaveBeenCalledWith("copy");
        expect(ok).toBe(true);
    });

    it("skips the modern API when navigator.clipboard is undefined", async () => {
        stubClipboard(undefined);
        stubSecureContext(true);
        const execCommand = stubExecCommand(() => true);

        const ok = await copyToClipboard("no-clipboard-api");

        expect(execCommand).toHaveBeenCalledWith("copy");
        expect(ok).toBe(true);
    });

    it("returns false when the legacy execCommand fallback reports failure", async () => {
        stubClipboard(undefined);
        stubExecCommand(() => false);

        const ok = await copyToClipboard("nope");

        expect(ok).toBe(false);
        expect(document.body.querySelector("textarea")).toBeNull();
    });

    it("returns false when the legacy fallback throws (e.g. execCommand unsupported)", async () => {
        stubClipboard(undefined);
        stubExecCommand(() => {
            throw new Error("not supported");
        });

        const ok = await copyToClipboard("throws");

        expect(ok).toBe(false);
    });

    it("creates an off-screen, readonly textarea for the legacy path", async () => {
        stubClipboard(undefined);
        let capturedTextarea: HTMLTextAreaElement | null = null;
        stubExecCommand(() => {
            capturedTextarea = document.body.querySelector("textarea");
            return true;
        });

        await copyToClipboard("off-screen-value");

        expect(capturedTextarea).not.toBeNull();
        expect(capturedTextarea!.value).toBe("off-screen-value");
        expect(capturedTextarea!.getAttribute("readonly")).toBe("");
        expect(capturedTextarea!.style.position).toBe("fixed");
    });
});
