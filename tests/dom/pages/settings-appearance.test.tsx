import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AppearanceSection } from "@/app/(dashboard)/settings/_sections/appearance";
import { defaultUserPreferences, type UserPreferencesDTO } from "@/lib/schemas/preferences";
import { mutationResult, queryResult, renderWithClient } from "./_helpers";

const useGetMock = vi.fn();
const useUpdateMock = vi.fn();
vi.mock("@/lib/api/preferences", () => ({
    preferences: {
        useGet: (...a: unknown[]) => useGetMock(...a),
        useUpdate: (...a: unknown[]) => useUpdateMock(...a),
    },
}));

const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a) } }));

function setPrefs(overrides: Partial<UserPreferencesDTO> = {}) {
    useGetMock.mockReturnValue(queryResult<UserPreferencesDTO>({ data: { ...defaultUserPreferences, ...overrides } }));
}

describe("AppearanceSection", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setPrefs();
        useUpdateMock.mockReturnValue(mutationResult({}));
    });

    it("renders all theme presets with the active one marked", () => {
        renderWithClient(<AppearanceSection />);
        expect(screen.getByText("Default")).toBeInTheDocument();
        expect(screen.getByText("Aurora")).toBeInTheDocument();
        expect(screen.getByText("Paper")).toBeInTheDocument();
        expect(screen.getByText("Terminal")).toBeInTheDocument();

        const activeTile = screen.getByText("Default").closest("button")!;
        expect(activeTile.className).toContain("border-primary");
    });

    it("selects a theme by clicking its tile", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn();
        useUpdateMock.mockReturnValue(mutationResult({ mutate }));
        renderWithClient(<AppearanceSection />);

        await user.click(screen.getByText("Aurora").closest("button")!);
        expect(mutate).toHaveBeenCalledWith({ theme_id: "aurora" }, expect.anything());
    });

    it("shows the free-form scheme description and lets the user switch scheme", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn();
        useUpdateMock.mockReturnValue(mutationResult({ mutate }));
        renderWithClient(<AppearanceSection />);

        expect(screen.getByText("Light, dark, or follow the OS preference.")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Dark" }));
        expect(mutate).toHaveBeenCalledWith({ theme_scheme: "dark" }, expect.anything());
    });

    it("forces + disables the scheme toggle when the active theme is dark-only (terminal)", () => {
        setPrefs({ theme_id: "terminal", theme_scheme: "light" });
        renderWithClient(<AppearanceSection />);

        expect(screen.getByText(/"Terminal" theme is dark-only/)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Light" })).toBeDisabled();
        expect(screen.getByRole("button", { name: "Dark" })).toBeDisabled();
        expect(screen.getByRole("button", { name: "System" })).toBeDisabled();
    });

    it("does not fire onChange for a disabled scheme toggle", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn();
        useUpdateMock.mockReturnValue(mutationResult({ mutate }));
        setPrefs({ theme_id: "terminal" });
        renderWithClient(<AppearanceSection />);

        await user.click(screen.getByRole("button", { name: "Light" }));
        expect(mutate).not.toHaveBeenCalled();
    });

    it("hides the typewriter speed slider unless render mode is typewriter", () => {
        setPrefs({ chat_render_mode: "stream" });
        renderWithClient(<AppearanceSection />);
        expect(screen.queryByRole("slider")).not.toBeInTheDocument();
    });

    it("switches render mode via the segmented control", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn();
        useUpdateMock.mockReturnValue(mutationResult({ mutate }));
        renderWithClient(<AppearanceSection />);

        await user.click(screen.getByRole("button", { name: "Typewriter" }));
        expect(mutate).toHaveBeenCalledWith({ chat_render_mode: "typewriter" }, expect.anything());
    });

    it("shows the slider and live cps text when render mode is typewriter", () => {
        setPrefs({ chat_render_mode: "typewriter", typewriter_cps: 80 });
        renderWithClient(<AppearanceSection />);
        expect(screen.getByText("80 characters per second.")).toBeInTheDocument();
        expect(screen.getByRole("slider")).toBeInTheDocument();
    });

    it("updates the live label while dragging and commits on release when the value changed", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn();
        useUpdateMock.mockReturnValue(mutationResult({ mutate }));
        setPrefs({ chat_render_mode: "typewriter", typewriter_cps: 80 });
        renderWithClient(<AppearanceSection />);

        const slider = screen.getByRole("slider");
        slider.focus();
        await user.keyboard("{ArrowRight}");

        expect(screen.getByText("90 characters per second.")).toBeInTheDocument();
        expect(mutate).toHaveBeenCalledWith({ typewriter_cps: 90 }, expect.anything());
    });

    it("skips the commit for the keystroke that returns to the saved value", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn();
        useUpdateMock.mockReturnValue(mutationResult({ mutate }));
        setPrefs({ chat_render_mode: "typewriter", typewriter_cps: 80 });
        renderWithClient(<AppearanceSection />);

        const slider = screen.getByRole("slider");
        slider.focus();
        // Each Radix key press commits independently: ArrowRight commits 90
        // (differs from the saved 80 → patch fires), ArrowLeft returns to 80
        // (matches the saved value → the `v !== prefs.typewriter_cps` guard
        // skips a redundant patch call).
        await user.keyboard("{ArrowRight}");
        expect(mutate).toHaveBeenCalledTimes(1);
        await user.keyboard("{ArrowLeft}");
        expect(mutate).toHaveBeenCalledTimes(1);
        expect(mutate).not.toHaveBeenCalledWith({ typewriter_cps: 80 }, expect.anything());
    });

    it("switches message layout via the segmented control", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn();
        useUpdateMock.mockReturnValue(mutationResult({ mutate }));
        renderWithClient(<AppearanceSection />);

        await user.click(screen.getByRole("button", { name: "Bubble" }));
        expect(mutate).toHaveBeenCalledWith({ chat_bubble_style: "bubble" }, expect.anything());
    });

    it("shows an error toast when a patch fails", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn((_vars, opts?: { onError?: (e: Error) => void }) => opts?.onError?.(new Error("save failed")));
        useUpdateMock.mockReturnValue(mutationResult({ mutate }));
        renderWithClient(<AppearanceSection />);

        await user.click(screen.getByRole("button", { name: "Minimal" }));
        expect(toastError).toHaveBeenCalledWith("save failed");
    });

    it("falls back to a generic message when the patch error has no message", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn((_vars, opts?: { onError?: (e: Error) => void }) => opts?.onError?.(new Error("")));
        useUpdateMock.mockReturnValue(mutationResult({ mutate }));
        renderWithClient(<AppearanceSection />);

        await user.click(screen.getByRole("button", { name: "Minimal" }));
        expect(toastError).toHaveBeenCalledWith("Failed to save");
    });

    it("falls back to the default preferences shape when the server hasn't returned data yet", () => {
        useGetMock.mockReturnValue(queryResult<UserPreferencesDTO>({ data: undefined }));
        renderWithClient(<AppearanceSection />);
        expect(screen.getByText("Light, dark, or follow the OS preference.")).toBeInTheDocument();
    });
});
