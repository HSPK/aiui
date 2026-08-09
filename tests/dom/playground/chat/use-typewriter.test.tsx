import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useTypewriter } from "@/components/playground/chat/use-typewriter";

describe("useTypewriter", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        return () => vi.useRealTimers();
    });

    it("is a pass-through returning the raw text immediately when disabled", () => {
        const { result } = renderHook(() => useTypewriter("Hello world", { enabled: false, cps: 20 }));
        expect(result.current).toBe("Hello world");
        // No rAF should have been scheduled at all.
        expect(vi.getTimerCount()).toBe(0);
    });

    it("starts empty and has not revealed anything before the first frame", () => {
        const { result } = renderHook(() => useTypewriter("Hello", { enabled: true, cps: 20 }));
        expect(result.current).toBe("");
    });

    it("reveals exactly one character on the very first frame regardless of cps", () => {
        const { result } = renderHook(() => useTypewriter("Hello", { enabled: true, cps: 1 }));
        act(() => {
            vi.advanceTimersToNextFrame();
        });
        expect(result.current).toBe("H");
    });

    it("reveals the whole text after exactly text.length frames with a very low cps (1 char/frame floor)", () => {
        const text = "Hi";
        const { result } = renderHook(() => useTypewriter(text, { enabled: true, cps: 0.001 }));

        act(() => {
            vi.advanceTimersToNextFrame();
        });
        expect(result.current).toBe("H");

        act(() => {
            vi.advanceTimersToNextFrame();
        });
        expect(result.current).toBe("Hi");

        // The rAF chain self-terminates once caught up — no more pending timers.
        expect(vi.getTimerCount()).toBe(0);
    });

    it("completes much faster with a very high cps (2nd frame reveals the remainder)", () => {
        const text = "Hello world, this is a longer message";
        const { result } = renderHook(() => useTypewriter(text, { enabled: true, cps: 1_000_000 }));

        act(() => {
            vi.advanceTimersToNextFrame(); // first frame: always exactly 1 char (delta=0 on first tick)
        });
        expect(result.current).toBe(text.slice(0, 1));

        act(() => {
            vi.advanceTimersToNextFrame(); // second frame: huge delta*cps clamps straight to the end
        });
        expect(result.current).toBe(text);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("continues revealing seamlessly when the source text grows mid-stream (no restart to 0)", () => {
        const { result, rerender } = renderHook(
            ({ text }: { text: string }) => useTypewriter(text, { enabled: true, cps: 1 }),
            { initialProps: { text: "Hello" } }
        );

        act(() => {
            vi.advanceTimersToNextFrame();
        });
        expect(result.current).toBe("H");

        // Streaming delivered more text before "Hello" was fully revealed.
        rerender({ text: "Hello world" });

        act(() => {
            vi.advanceTimersToNextFrame();
        });
        // Picks up from shownRef=1, not from 0 — 2nd character of the NEW text.
        expect(result.current).toBe("He");
    });

    it("clamps shownRef when the source text shrinks, catching up to the empty string on the next frame", () => {
        const { result, rerender } = renderHook(
            ({ text }: { text: string }) => useTypewriter(text, { enabled: true, cps: 0.001 }),
            { initialProps: { text: "Hello" } }
        );

        act(() => {
            vi.advanceTimersToNextFrame();
        });
        act(() => {
            vi.advanceTimersToNextFrame();
        });
        expect(result.current).toBe("He");

        // Simulate "regenerate" clearing the message.
        rerender({ text: "" });

        act(() => {
            vi.advanceTimersToNextFrame();
        });
        expect(result.current).toBe("");
        expect(vi.getTimerCount()).toBe(0);
    });

    it("switches to raw-text pass-through immediately when disabled mid-reveal, cancelling the pending frame", () => {
        const { result, rerender } = renderHook(
            ({ enabled }: { enabled: boolean }) => useTypewriter("Hello world", { enabled, cps: 1 }),
            { initialProps: { enabled: true } }
        );

        act(() => {
            vi.advanceTimersToNextFrame();
        });
        expect(result.current).toBe("H");

        rerender({ enabled: false });
        expect(result.current).toBe("Hello world");
        expect(vi.getTimerCount()).toBe(0);
    });

    it("resumes from the previous shownRef (not from 0) when re-enabled", () => {
        const { result, rerender } = renderHook(
            ({ enabled }: { enabled: boolean }) => useTypewriter("Hello", { enabled, cps: 0.001 }),
            { initialProps: { enabled: true } }
        );

        act(() => {
            vi.advanceTimersToNextFrame();
        });
        expect(result.current).toBe("H");

        rerender({ enabled: false });
        expect(result.current).toBe("Hello"); // pass-through while disabled

        rerender({ enabled: true }); // re-enabling restarts the effect
        act(() => {
            vi.advanceTimersToNextFrame();
        });
        // Continues from shownRef=1 (unaffected by the disabled interval) → 2nd char.
        expect(result.current).toBe("He");
    });

    it("reads cps changes via a ref without restarting the in-flight rAF chain", () => {
        const { result, rerender } = renderHook(
            ({ cps }: { cps: number }) => useTypewriter("Hello world", { enabled: true, cps }),
            { initialProps: { cps: 1 } }
        );

        act(() => {
            vi.advanceTimersToNextFrame(); // 1st frame — always exactly 1 char
        });
        expect(result.current).toBe("H");

        // Bump cps steeply without touching enabled/text — must NOT reset progress.
        rerender({ cps: 1_000_000 });

        act(() => {
            vi.advanceTimersToNextFrame(); // now uses the fresh (huge) cps value
        });
        expect(result.current).toBe("Hello world");
    });

    it("cancels the pending frame on unmount", () => {
        const { unmount } = renderHook(() => useTypewriter("Hello world", { enabled: true, cps: 1 }));
        expect(vi.getTimerCount()).toBeGreaterThan(0);
        unmount();
        expect(vi.getTimerCount()).toBe(0);
    });
});
