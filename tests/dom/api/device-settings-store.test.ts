import { beforeEach, describe, expect, it, vi } from "vitest";

import { useDeviceSettingsStore, type DeviceSettings } from "@/lib/stores/device-settings-store";

// Snapshot the pristine store shape (defaults + stable action references)
// once, at import time, so every test can be reset back to a known state
// without needing to guess the defaults by hand.
const pristine = useDeviceSettingsStore.getState();

function resetStore() {
    useDeviceSettingsStore.setState(pristine, true);
    localStorage.clear();
}

describe("lib/stores/device-settings-store", () => {
    beforeEach(() => {
        resetStore();
    });

    it("defaults to sendOnEnter/showTimestamps on and compactMode off", () => {
        const state = useDeviceSettingsStore.getState();
        expect(state.sendOnEnter).toBe(true);
        expect(state.showTimestamps).toBe(true);
        expect(state.compactMode).toBe(false);
    });

    it("updateDeviceSettings merges a partial patch over existing state", () => {
        useDeviceSettingsStore.getState().updateDeviceSettings({ compactMode: true });
        let state = useDeviceSettingsStore.getState();
        expect(state.compactMode).toBe(true);
        expect(state.sendOnEnter).toBe(true); // untouched fields survive
        expect(state.showTimestamps).toBe(true);

        useDeviceSettingsStore.getState().updateDeviceSettings({ sendOnEnter: false, showTimestamps: false });
        state = useDeviceSettingsStore.getState();
        expect(state.sendOnEnter).toBe(false);
        expect(state.showTimestamps).toBe(false);
        expect(state.compactMode).toBe(true); // still true from the previous update
    });

    it("resetDeviceSettings restores defaults but keeps the action functions callable", () => {
        const { updateDeviceSettings, resetDeviceSettings } = useDeviceSettingsStore.getState();
        updateDeviceSettings({ compactMode: true, sendOnEnter: false, showTimestamps: false });
        expect(useDeviceSettingsStore.getState().compactMode).toBe(true);

        resetDeviceSettings();
        const state = useDeviceSettingsStore.getState();
        expect(state.sendOnEnter).toBe(true);
        expect(state.showTimestamps).toBe(true);
        expect(state.compactMode).toBe(false);
        // Actions are not clobbered by `set(defaults)` (a merge, not a replace).
        expect(state.updateDeviceSettings).toBe(updateDeviceSettings);
        expect(state.resetDeviceSettings).toBe(resetDeviceSettings);
    });

    it("persists only the plain data fields to localStorage (functions are dropped by JSON)", () => {
        useDeviceSettingsStore.getState().updateDeviceSettings({ compactMode: true });

        const raw = localStorage.getItem("loom-device-settings");
        expect(raw).not.toBeNull();
        const parsed = JSON.parse(raw as string);
        expect(parsed.state).toEqual<DeviceSettings>({
            sendOnEnter: true,
            showTimestamps: true,
            compactMode: true,
        });
        expect(Object.keys(parsed.state).sort()).toEqual(["compactMode", "sendOnEnter", "showTimestamps"]);
    });

    it("a fresh module import rehydrates from a pre-existing localStorage value synchronously", async () => {
        localStorage.setItem(
            "loom-device-settings",
            JSON.stringify({
                state: { sendOnEnter: false, showTimestamps: false, compactMode: true },
                version: 0,
            }),
        );

        vi.resetModules();
        const { useDeviceSettingsStore: freshStore } = await import("@/lib/stores/device-settings-store");
        const state = freshStore.getState();
        expect(state.sendOnEnter).toBe(false);
        expect(state.showTimestamps).toBe(false);
        expect(state.compactMode).toBe(true);
        // Actions still work post-hydration.
        expect(typeof state.updateDeviceSettings).toBe("function");
        state.resetDeviceSettings();
        expect(freshStore.getState().compactMode).toBe(false);
    });
});
