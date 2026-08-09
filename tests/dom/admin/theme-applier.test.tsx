import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";

import { THEME_STORAGE_KEY } from "@/lib/themes";

// ---- next-themes ----
const setThemeMock = vi.fn();
const useThemeMock = vi.fn(() => ({ theme: "light" as string | undefined, setTheme: setThemeMock }));
vi.mock("next-themes", () => ({ useTheme: () => useThemeMock() }));

// ---- preferences (leaf module import used directly by theme-applier.tsx) ----
const useGetMock = vi.fn();
vi.mock("@/lib/api/preferences", () => ({
    preferences: { useGet: () => useGetMock() },
}));

import { ThemeApplier } from "@/components/theme/theme-applier";

function setPrefs(data: unknown) {
    useGetMock.mockReturnValue({ data });
}

function storedTheme(): { id: string; scheme: string } | null {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
}

beforeEach(() => {
    document.documentElement.removeAttribute("data-theme");
    window.localStorage.clear();
    setThemeMock.mockReset();
    useThemeMock.mockReturnValue({ theme: "light", setTheme: setThemeMock });
    setPrefs(undefined);
});

afterEach(() => {
    document.documentElement.removeAttribute("data-theme");
    window.localStorage.clear();
});

describe("ThemeApplier", () => {
    it("renders nothing (returns null)", () => {
        const { container } = render(<ThemeApplier />);
        expect(container.firstChild).toBeNull();
    });

    it("is a no-op while prefs are still loading (undefined) — preserves the SSR-painted theme", () => {
        // Simulate the bootstrap <script> having already painted a theme
        // before React hydrates.
        document.documentElement.dataset.theme = "paper";
        setPrefs(undefined);

        render(<ThemeApplier />);

        expect(document.documentElement.dataset.theme).toBe("paper");
        expect(setThemeMock).not.toHaveBeenCalled();
        expect(storedTheme()).toBeNull();
    });

    it("applies the resolved preset id + scheme to <html> and localStorage once prefs resolve", () => {
        setPrefs({ theme_id: "default", theme_scheme: "dark" });
        useThemeMock.mockReturnValue({ theme: "light", setTheme: setThemeMock });

        render(<ThemeApplier />);

        expect(document.documentElement.dataset.theme).toBe("default");
        expect(setThemeMock).toHaveBeenCalledWith("dark");
        expect(storedTheme()).toEqual({ id: "default", scheme: "dark" });
    });

    it("does not call setTheme when the resolved scheme already matches next-themes' active theme", () => {
        setPrefs({ theme_id: "default", theme_scheme: "dark" });
        useThemeMock.mockReturnValue({ theme: "dark", setTheme: setThemeMock });

        render(<ThemeApplier />);

        expect(document.documentElement.dataset.theme).toBe("default");
        expect(setThemeMock).not.toHaveBeenCalled();
        // Storage is still (re-)written even when next-themes needn't change.
        expect(storedTheme()).toEqual({ id: "default", scheme: "dark" });
    });

    it("forces the preset's scheme over the user's stored preference (terminal → dark)", () => {
        setPrefs({ theme_id: "terminal", theme_scheme: "light" });
        useThemeMock.mockReturnValue({ theme: "light", setTheme: setThemeMock });

        render(<ThemeApplier />);

        expect(document.documentElement.dataset.theme).toBe("terminal");
        // forceScheme wins over prefs.theme_scheme ("light"), so the applied
        // scheme is "dark" and next-themes is told to switch.
        expect(setThemeMock).toHaveBeenCalledWith("dark");
        expect(storedTheme()).toEqual({ id: "terminal", scheme: "dark" });
    });

    it("silently degrades to the default preset when the stored theme_id no longer exists in the registry", () => {
        setPrefs({ theme_id: "some-removed-preset", theme_scheme: "system" });
        useThemeMock.mockReturnValue({ theme: "light", setTheme: setThemeMock });

        render(<ThemeApplier />);

        // resolveTheme() falls back to the "default" descriptor's id, NOT
        // the raw (unknown) prefs.theme_id — this is a deliberate `<html
        // data-theme="...">`-with-no-matching-CSS-rule safeguard.
        expect(document.documentElement.dataset.theme).toBe("default");
        expect(setThemeMock).toHaveBeenCalledWith("system");
        expect(storedTheme()).toEqual({ id: "default", scheme: "system" });
    });

    it("passes a plain 'system' scheme straight through when the preset does not force one", () => {
        setPrefs({ theme_id: "paper", theme_scheme: "system" });
        useThemeMock.mockReturnValue({ theme: "dark", setTheme: setThemeMock });

        render(<ThemeApplier />);

        expect(document.documentElement.dataset.theme).toBe("paper");
        expect(setThemeMock).toHaveBeenCalledWith("system");
    });

    it("re-applies once prefs resolve after an initial loading render", () => {
        setPrefs(undefined);
        const { rerender } = render(<ThemeApplier />);
        expect(document.documentElement.dataset.theme).toBeUndefined();

        setPrefs({ theme_id: "aurora", theme_scheme: "dark" });
        rerender(<ThemeApplier />);

        expect(document.documentElement.dataset.theme).toBe("aurora");
        expect(setThemeMock).toHaveBeenCalledWith("dark");
    });
});
