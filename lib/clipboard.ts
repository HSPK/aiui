/**
 * Clipboard helper that works in non-secure contexts.
 *
 * `navigator.clipboard.writeText` is only defined when
 * `window.isSecureContext === true` (https or localhost). Loom is
 * commonly self-hosted on LAN over plain http — there the global is
 * undefined and `.writeText(...)` throws synchronously, silently
 * losing critical one-shot data (newly-minted API keys, generated
 * model names, log IDs, etc).
 *
 * Returns `true` on success. Falls back to the deprecated-but-still-
 * universal `document.execCommand("copy")` via a temporary textarea
 * when the modern API is unavailable. Never throws — caller decides
 * whether to toast success/error.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
    if (typeof window === "undefined") return false;

    if (navigator.clipboard && window.isSecureContext) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            // Fall through to legacy path; some browsers throw on
            // permission-denied / focus-lost edge cases even in
            // secure contexts.
        }
    }

    try {
        const ta = document.createElement("textarea");
        ta.value = text;
        // Off-screen + readonly + tabindex=-1 keeps the textarea
        // invisible and unselectable in the tab order.
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.top = "-9999px";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        return ok;
    } catch {
        return false;
    }
}
