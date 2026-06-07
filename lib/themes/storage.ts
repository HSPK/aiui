/**
 * Storage layer for theme preferences. Single source of truth for the
 * localStorage key used both by the SSR bootstrap <script> (in root layout)
 * and the client-side ThemeApplier. Centralising the key + accessors here
 * keeps the no-flash contract enforceable from one place.
 */

export const THEME_STORAGE_KEY = "aiui-theme";

export type StoredThemeScheme = "light" | "dark" | "system";

export interface StoredTheme {
    id: string;
    /** Resolved scheme — already accounts for the preset's forceScheme. */
    scheme: StoredThemeScheme;
}

function isScheme(v: unknown): v is StoredThemeScheme {
    return v === "light" || v === "dark" || v === "system";
}

export function readStoredTheme(): StoredTheme | null {
    if (typeof window === "undefined") return null;
    try {
        const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<StoredTheme>;
        if (typeof parsed?.id !== "string" || !isScheme(parsed?.scheme)) return null;
        return { id: parsed.id, scheme: parsed.scheme };
    } catch {
        return null;
    }
}

export function writeStoredTheme(state: StoredTheme): void {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(state));
    } catch {
        /* quota exceeded / private mode — best-effort */
    }
}

/**
 * Inline script body executed as the very first thing in <head>. Reads
 * the persisted theme + scheme and applies BOTH `data-theme` and the
 * `.dark` class to <html> synchronously, before any CSS matches and
 * before React (or next-themes) hydrates.
 *
 * Must be self-contained (no module imports — runs in raw browser
 * context). The storage key is embedded as a JSON literal so it can be
 * inlined via dangerouslySetInnerHTML.
 *
 * This script owns the first-paint contract. The client-side ThemeApplier
 * keeps both this storage entry and next-themes' own state in sync; on
 * subsequent reloads, this script (running before any framework code) is
 * what eliminates the white flash.
 */
export const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var raw=localStorage.getItem(${JSON.stringify(
    THEME_STORAGE_KEY,
)});if(!raw)return;var t=JSON.parse(raw);if(t&&typeof t.id==="string")document.documentElement.dataset.theme=t.id;var s=t&&t.scheme;if(s==="system")s=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";if(s==="dark")document.documentElement.classList.add("dark");else if(s==="light")document.documentElement.classList.remove("dark");}catch(e){}})();`;

