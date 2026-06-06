import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/**
 * Device-local UI preferences. These intentionally do NOT sync across
 * devices — different screens / keyboards may want different defaults.
 * Cross-device user preferences live server-side; see lib/api/preferences.ts.
 */

export interface DeviceSettings {
    sendOnEnter: boolean;
    showTimestamps: boolean;
    compactMode: boolean;
}

interface DeviceSettingsState extends DeviceSettings {
    updateDeviceSettings: (updates: Partial<DeviceSettings>) => void;
    resetDeviceSettings: () => void;
}

const defaults: DeviceSettings = {
    sendOnEnter: true,
    showTimestamps: true,
    compactMode: false,
};

export const useDeviceSettingsStore = create<DeviceSettingsState>()(
    persist(
        (set) => ({
            ...defaults,
            updateDeviceSettings: (updates) => set((state) => ({ ...state, ...updates })),
            resetDeviceSettings: () => set(defaults),
        }),
        {
            name: "aiui-device-settings",
            storage: createJSONStorage(() => localStorage),
        },
    ),
);
