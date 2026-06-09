"use client";

import * as React from "react";
import { useTheme } from "next-themes";

import { preferences } from "@/lib/api/preferences";
import { resolveTheme, writeStoredTheme } from "@/lib/themes";

/**
 * Syncs the user's chosen preset (preferences.theme_id) and color scheme
 * (preferences.theme_scheme) once the client has the preferences payload.
 *
 *   1. Mirrors prefs to the localStorage key read by the SSR bootstrap
 *      script on next reload (both id and resolved scheme so the script
 *      can paint with the correct .dark class on the first frame).
 *   2. Sets data-theme on <html> immediately for in-session updates.
 *   3. Forwards the scheme to next-themes so its own bookkeeping (system
 *      listener, .dark class on subsequent toggles) stays in sync.
 *
 * Important: when `prefs` is undefined (still fetching, or 401 on the
 * /login route), this hook is a no-op. The SSR bootstrap script has
 * already painted with the last known theme from localStorage — clobbering
 * <html data-theme> with a "default" fallback would cause a one-frame
 * flash on every navigation. Returning early preserves that paint.
 *
 * The compiled stylesheet itself is server-rendered into <head> by
 * RootLayout; this component does not inject CSS.
 */
export function ThemeApplier() {
    const { data: prefs } = preferences.useGet();
    const { setTheme, theme: activeScheme } = useTheme();

    React.useEffect(() => {
        if (!prefs) return;
        if (typeof document === "undefined") return;

        const themeId = prefs.theme_id;
        const preset = resolveTheme(themeId);
        const target = preset.forceScheme ?? prefs.theme_scheme;

        document.documentElement.dataset.theme = themeId;
        writeStoredTheme({ id: themeId, scheme: target });

        if (target !== activeScheme) setTheme(target);
    }, [prefs, activeScheme, setTheme]);

    return null;
}
