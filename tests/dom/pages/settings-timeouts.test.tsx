import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TimeoutsSection } from "@/app/(dashboard)/settings/_sections/timeouts";
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

describe("TimeoutsSection", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useGetMock.mockReturnValue(
            queryResult<UserPreferencesDTO>({
                data: {
                    ...defaultUserPreferences,
                    gateway_timeout_seconds: 3600,
                    mcp_connect_timeout_seconds: 3600,
                    mcp_auto_check_interval_minutes: 5,
                    provider_auto_check_interval_minutes: 10,
                },
            })
        );
        useUpdateMock.mockReturnValue(mutationResult({}));
    });

    it("renders the current values for all four fields", () => {
        renderWithClient(<TimeoutsSection />);
        expect(screen.getAllByDisplayValue("3600")).toHaveLength(2);
        expect(screen.getByDisplayValue("5")).toBeInTheDocument();
        expect(screen.getByDisplayValue("10")).toBeInTheDocument();
    });

    it("commits a valid gateway timeout change on blur", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn();
        useUpdateMock.mockReturnValue(mutationResult({ mutate }));
        renderWithClient(<TimeoutsSection />);

        const [gateway] = screen.getAllByDisplayValue("3600");
        await user.clear(gateway);
        await user.type(gateway, "120");
        await user.tab();
        expect(mutate).toHaveBeenCalledWith({ gateway_timeout_seconds: 120 }, expect.anything());
    });

    it("commits the mcp connect timeout via Enter", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn();
        useUpdateMock.mockReturnValue(mutationResult({ mutate }));
        renderWithClient(<TimeoutsSection />);

        const [, mcpConnect] = screen.getAllByDisplayValue("3600");
        await user.clear(mcpConnect);
        await user.type(mcpConnect, "60{Enter}");
        expect(mutate).toHaveBeenCalledWith({ mcp_connect_timeout_seconds: 60 }, expect.anything());
    });

    it("commits the mcp auto-check interval (minutes, 0 allowed)", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn();
        useUpdateMock.mockReturnValue(mutationResult({ mutate }));
        renderWithClient(<TimeoutsSection />);

        const input = screen.getByDisplayValue("5");
        await user.clear(input);
        await user.type(input, "0");
        await user.tab();
        expect(mutate).toHaveBeenCalledWith({ mcp_auto_check_interval_minutes: 0 }, expect.anything());
    });

    it("commits the provider auto-check interval", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn();
        useUpdateMock.mockReturnValue(mutationResult({ mutate }));
        renderWithClient(<TimeoutsSection />);

        const input = screen.getByDisplayValue("10");
        await user.clear(input);
        await user.type(input, "30");
        await user.tab();
        expect(mutate).toHaveBeenCalledWith({ provider_auto_check_interval_minutes: 30 }, expect.anything());
    });

    it("reverts and skips the commit when the field is left blank", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn();
        useUpdateMock.mockReturnValue(mutationResult({ mutate }));
        renderWithClient(<TimeoutsSection />);

        const [gateway] = screen.getAllByDisplayValue("3600");
        await user.clear(gateway);
        await user.tab();
        expect(mutate).not.toHaveBeenCalled();
        expect(gateway).toHaveValue(3600);
    });

    it("rejects a value above the max (86400s) and reverts with a toast", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn();
        useUpdateMock.mockReturnValue(mutationResult({ mutate }));
        renderWithClient(<TimeoutsSection />);

        const [gateway] = screen.getAllByDisplayValue("3600");
        await user.clear(gateway);
        await user.type(gateway, "99999999");
        await user.tab();
        expect(toastError).toHaveBeenCalledWith("Value must be between 1 and 86400");
        expect(mutate).not.toHaveBeenCalled();
        expect(gateway).toHaveValue(3600);
    });

    it("rejects a negative auto-check interval and reverts with a toast", async () => {
        const user = userEvent.setup();
        renderWithClient(<TimeoutsSection />);
        const input = screen.getByDisplayValue("5");
        await user.clear(input);
        await user.type(input, "-1");
        await user.tab();
        expect(toastError).toHaveBeenCalledWith("Value must be between 0 and 1440");
        expect(input).toHaveValue(5);
    });

    it("skips the commit when the value is unchanged", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn();
        useUpdateMock.mockReturnValue(mutationResult({ mutate }));
        renderWithClient(<TimeoutsSection />);
        const input = screen.getByDisplayValue("10");
        await user.click(input);
        await user.tab();
        expect(mutate).not.toHaveBeenCalled();
    });

    it("reverts and toasts when the server rejects the update", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn((_vars, opts?: { onError?: (e: Error) => void }) => opts?.onError?.(new Error("rejected")));
        useUpdateMock.mockReturnValue(mutationResult({ mutate }));
        renderWithClient(<TimeoutsSection />);

        const [gateway] = screen.getAllByDisplayValue("3600");
        await user.clear(gateway);
        await user.type(gateway, "120");
        await user.tab();
        expect(toastError).toHaveBeenCalledWith("rejected");
        expect(gateway).toHaveValue(3600);
    });

    it("falls back to a generic message when the server error has no message", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn((_vars, opts?: { onError?: (e: Error) => void }) => opts?.onError?.(new Error("")));
        useUpdateMock.mockReturnValue(mutationResult({ mutate }));
        renderWithClient(<TimeoutsSection />);

        const [gateway] = screen.getAllByDisplayValue("3600");
        await user.clear(gateway);
        await user.type(gateway, "120");
        await user.tab();
        expect(toastError).toHaveBeenCalledWith("Failed to save");
        expect(gateway).toHaveValue(3600);
    });

    it("falls back to the default preferences shape when the server hasn't returned data yet", () => {
        useGetMock.mockReturnValue(queryResult<UserPreferencesDTO>({ data: undefined }));
        renderWithClient(<TimeoutsSection />);
        expect(screen.getAllByDisplayValue(String(defaultUserPreferences.gateway_timeout_seconds))).toHaveLength(2);
        expect(screen.getAllByDisplayValue(String(defaultUserPreferences.mcp_auto_check_interval_minutes))).toHaveLength(2);
    });

    it("commits the gateway timeout via Enter", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn();
        useUpdateMock.mockReturnValue(mutationResult({ mutate }));
        renderWithClient(<TimeoutsSection />);

        const [gateway] = screen.getAllByDisplayValue("3600");
        await user.clear(gateway);
        await user.type(gateway, "120{Enter}");
        expect(mutate).toHaveBeenCalledWith({ gateway_timeout_seconds: 120 }, expect.anything());
    });

    it("commits the mcp auto-check interval via Enter", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn();
        useUpdateMock.mockReturnValue(mutationResult({ mutate }));
        renderWithClient(<TimeoutsSection />);

        const input = screen.getByDisplayValue("5");
        await user.clear(input);
        await user.type(input, "15{Enter}");
        expect(mutate).toHaveBeenCalledWith({ mcp_auto_check_interval_minutes: 15 }, expect.anything());
    });

    it("commits the provider auto-check interval via Enter", async () => {
        const user = userEvent.setup();
        const mutate = vi.fn();
        useUpdateMock.mockReturnValue(mutationResult({ mutate }));
        renderWithClient(<TimeoutsSection />);

        const input = screen.getByDisplayValue("10");
        await user.clear(input);
        await user.type(input, "25{Enter}");
        expect(mutate).toHaveBeenCalledWith({ provider_auto_check_interval_minutes: 25 }, expect.anything());
    });
});
