import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import SettingsPage from "@/app/(dashboard)/settings/page";
import { mutationResult, renderWithClient } from "./_helpers";

const useUpdateMock = vi.fn();
vi.mock("@/lib/api/preferences", () => ({ preferences: { useUpdate: (...a: unknown[]) => useUpdateMock(...a) } }));

const resetDeviceSettingsMock = vi.fn();
vi.mock("@/lib/stores/device-settings-store", () => ({
    useDeviceSettingsStore: (selector: (s: { resetDeviceSettings: () => void }) => unknown) =>
        selector({ resetDeviceSettings: resetDeviceSettingsMock }),
}));

vi.mock("@/app/(dashboard)/settings/_sections/profile", () => ({
    ProfileSection: () => <div data-testid="section-profile">Profile section</div>,
}));
vi.mock("@/app/(dashboard)/settings/_sections/security", () => ({
    SecuritySection: () => <div data-testid="section-security">Security section</div>,
}));
vi.mock("@/app/(dashboard)/settings/_sections/appearance", () => ({
    AppearanceSection: () => <div data-testid="section-appearance">Appearance section</div>,
}));
vi.mock("@/app/(dashboard)/settings/_sections/models", () => ({
    ModelsSection: () => <div data-testid="section-models">Models section</div>,
}));
vi.mock("@/app/(dashboard)/settings/_sections/chat", () => ({
    ChatSection: () => <div data-testid="section-chat">Chat section</div>,
}));
vi.mock("@/app/(dashboard)/settings/_sections/timeouts", () => ({
    TimeoutsSection: () => <div data-testid="section-timeouts">Timeouts section</div>,
}));
vi.mock("@/app/(dashboard)/settings/_sections/behavior", () => ({
    BehaviorSection: () => <div data-testid="section-behavior">Behavior section</div>,
}));
vi.mock("@/app/(dashboard)/settings/_sections/tools", () => ({
    ToolsSection: () => <div data-testid="section-tools">Tools section</div>,
}));

describe("SettingsPage", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        window.location.hash = "";
        useUpdateMock.mockReturnValue(mutationResult({}));
    });

    it("defaults to the Appearance section", () => {
        renderWithClient(<SettingsPage />);
        expect(screen.getByTestId("section-appearance")).toBeInTheDocument();
        expect(screen.getByText("Appearance", { selector: "p" })).toBeInTheDocument();
    });

    it("falls back to Appearance for an unknown hash", () => {
        window.location.hash = "#not-a-real-section";
        renderWithClient(<SettingsPage />);
        expect(screen.getByTestId("section-appearance")).toBeInTheDocument();
    });

    it("switches sections when a nav item is clicked, for every section", async () => {
        const user = userEvent.setup();
        renderWithClient(<SettingsPage />);

        const nav = screen.getByRole("navigation", { name: "Settings sections" });
        for (const [label, testid] of [
            ["Profile", "section-profile"],
            ["Security", "section-security"],
            ["Models", "section-models"],
            ["Chat", "section-chat"],
            ["Timeouts", "section-timeouts"],
            ["Behavior", "section-behavior"],
            ["Tools", "section-tools"],
            ["Appearance", "section-appearance"],
        ] as const) {
            await user.click(screen.getByRole("button", { name: label }));
            expect(screen.getByTestId(testid)).toBeInTheDocument();
            expect(nav).toBeInTheDocument();
        }
    });

    it("resets preferences and device settings, and shows a success toast", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn((_vars, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.());
        useUpdateMock.mockReturnValue(mutationResult({ mutate }));
        renderWithClient(<SettingsPage />);

        await user.click(screen.getByRole("button", { name: /Reset/ }));
        expect(mutate).toHaveBeenCalled();
        expect(resetDeviceSettingsMock).toHaveBeenCalled();
    });

    it("shows an error toast when the reset mutation fails", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn((_vars, opts?: { onError?: (e: Error) => void }) =>
            opts?.onError?.(new Error("reset failed"))
        );
        useUpdateMock.mockReturnValue(mutationResult({ mutate }));
        renderWithClient(<SettingsPage />);

        await user.click(screen.getByRole("button", { name: /Reset/ }));
        expect(mutate).toHaveBeenCalled();
        expect(resetDeviceSettingsMock).not.toHaveBeenCalled();
    });

    it("disables the Reset button while the mutation is pending", () => {
        useUpdateMock.mockReturnValue(mutationResult({ isPending: true }));
        renderWithClient(<SettingsPage />);
        expect(screen.getByRole("button", { name: /Reset/ })).toBeDisabled();
    });

    it("falls back to a generic message when the reset error has no message", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn((_vars, opts?: { onError?: (e: Error) => void }) => opts?.onError?.(new Error("")));
        useUpdateMock.mockReturnValue(mutationResult({ mutate }));
        renderWithClient(<SettingsPage />);

        await user.click(screen.getByRole("button", { name: /Reset/ }));
        expect(mutate).toHaveBeenCalled();
        expect(resetDeviceSettingsMock).not.toHaveBeenCalled();
    });
});
