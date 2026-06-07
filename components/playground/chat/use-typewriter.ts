"use client";

import * as React from "react";

interface UseTypewriterOptions {
    /** When false, the hook is a pass-through (returns `text` unchanged). */
    enabled: boolean;
    /** Characters per second to reveal. */
    cps: number;
}

/**
 * Reveals characters from `text` at the given speed. While `text` is still
 * growing (streaming), the hook tracks the leading edge so it never lags
 * more than one frame behind the source. When the source stops growing, the
 * remaining tail is revealed at the same cps without an instant snap.
 *
 * All state mutations happen inside requestAnimationFrame callbacks — never
 * synchronously inside the effect body — so the hook satisfies the
 * react-hooks/set-state-in-effect rule.
 */
export function useTypewriter(text: string, opts: UseTypewriterOptions): string {
    const { enabled, cps } = opts;
    const [animated, setAnimated] = React.useState("");
    const shownRef = React.useRef(0);

    React.useEffect(() => {
        if (!enabled) return;
        // Clamp if the source shrunk (e.g., regenerate cleared the message).
        if (shownRef.current > text.length) shownRef.current = text.length;

        let cancelled = false;
        let lastTick: number | null = null;
        let raf: number | null = null;

        const step = (now: number) => {
            if (cancelled) return;
            const last = lastTick ?? now;
            const delta = (now - last) / 1000;
            lastTick = now;
            const advance = Math.max(1, Math.round(delta * cps));
            const next = Math.min(text.length, shownRef.current + advance);
            shownRef.current = next;
            setAnimated(text.slice(0, next));
            if (next < text.length) {
                raf = requestAnimationFrame(step);
            }
        };
        raf = requestAnimationFrame(step);
        return () => {
            cancelled = true;
            if (raf !== null) cancelAnimationFrame(raf);
        };
    }, [enabled, text, cps]);

    return enabled ? animated : text;
}
