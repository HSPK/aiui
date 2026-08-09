import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithQuery } from "./_render";
import { modelOverride, modelDiscovered, providerWithHealth, capabilities, variants } from "./_fixtures";
import { makeQuery, makeMutation } from "./_mocks";

vi.mock("@/lib/api/providers", () => ({
    providers: {
        useList: vi.fn(),
        useCreate: vi.fn(),
        useUpdate: vi.fn(),
        useDelete: vi.fn(),
        useCheckMany: vi.fn(),
        probe: vi.fn(),
        list: vi.fn(),
        keys: { all: ["providers"], list: () => ["providers", "list"], one: (id: string) => ["providers", id] },
    },
}));

vi.mock("@/lib/api/models", () => ({
    models: {
        useList: vi.fn(),
        useCreate: vi.fn(),
        useUpdate: vi.fn(),
        useDelete: vi.fn(),
        list: vi.fn(),
        keys: { all: ["models"], list: () => ["models", "list"], one: (id: string) => ["models", id] },
    },
}));

vi.mock("@/lib/api/capabilities", () => ({
    capabilities: { useList: vi.fn() },
}));

vi.mock("@/lib/api/variants", () => ({
    variants: { useList: vi.fn() },
}));

vi.mock("sonner", () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { providers } from "@/lib/api/providers";
import { models } from "@/lib/api/models";
import { capabilities as capabilitiesApi } from "@/lib/api/capabilities";
import { variants as variantsApi } from "@/lib/api/variants";
import { ModelFormDialog } from "@/components/providers/model-form-dialog";

beforeEach(() => {
    vi.mocked(providers.useList).mockReturnValue(makeQuery({ data: [providerWithHealth] }));
    vi.mocked(capabilitiesApi.useList).mockReturnValue(makeQuery({ data: capabilities }));
    vi.mocked(variantsApi.useList).mockReturnValue(makeQuery({ data: variants }));
    vi.mocked(models.useCreate).mockReturnValue(makeMutation());
    vi.mocked(models.useUpdate).mockReturnValue(makeMutation());
});

describe("ModelFormDialog", () => {
    it("shows 'Add model' title for pure create (no model)", () => {
        renderWithQuery(
            <ModelFormDialog open onOpenChange={vi.fn()} mode="create" />,
        );
        expect(screen.getByText("Add model")).toBeInTheDocument();
    });

    it("shows 'Edit' title when model is provided in create mode (promoting discovered)", () => {
        renderWithQuery(
            <ModelFormDialog open onOpenChange={vi.fn()} mode="create" model={modelDiscovered} />,
        );
        expect(screen.getByText("Edit")).toBeInTheDocument();
    });

    it("shows 'Edit' title in edit mode", () => {
        renderWithQuery(
            <ModelFormDialog open onOpenChange={vi.fn()} mode="edit" model={modelOverride} />,
        );
        expect(screen.getByText("Edit")).toBeInTheDocument();
    });

    it("does not render form when open=false", () => {
        renderWithQuery(
            <ModelFormDialog open={false} onOpenChange={vi.fn()} mode="create" />,
        );
        expect(screen.queryByText("Add model")).toBeNull();
    });

    it("renders form when open=true", () => {
        renderWithQuery(
            <ModelFormDialog open onOpenChange={vi.fn()} mode="create" />,
        );
        expect(screen.getByText("Add model")).toBeInTheDocument();
    });

    it("onSaved chains to also call onOpenChange(false)", async () => {
        const onOpenChange = vi.fn();
        const onSaved = vi.fn();
        const mutate = vi.fn((payload, opts) => {
            opts?.onSuccess?.(modelOverride);
        });
        vi.mocked(models.useCreate).mockReturnValue(makeMutation({ mutate }));
        const { rerender } = renderWithQuery(
            <ModelFormDialog
                open
                onOpenChange={onOpenChange}
                mode="create"
                onSaved={onSaved}
            />,
        );
        // The form's create mutation calls onSuccess which calls onSaved and onOpenChange(false)
        // Trigger via mutation directly: call mutate's callback
        // Simulate by calling the onSuccess callback from the mock
        // Actually models.useCreate is called with {onSuccess}, let's capture it
        // Re-check the mock captures the onSuccess to call it
        // Actually makeMutation's mutate spy never calls onSuccess automatically
        // Let's use a custom mutate that calls opts.onSuccess
        await waitFor(() => {
            expect(vi.mocked(models.useCreate)).toHaveBeenCalled();
        });
        // call the mutation manually
        const call = vi.mocked(models.useCreate).mock.calls[0][0] as { onSuccess: (d: typeof modelOverride) => void };
        call.onSuccess(modelOverride);
        expect(onSaved).toHaveBeenCalledWith(modelOverride);
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it("Cancel button closes dialog via onOpenChange(false)", async () => {
        const user = userEvent.setup();
        const onOpenChange = vi.fn();
        renderWithQuery(
            <ModelFormDialog open onOpenChange={onOpenChange} mode="create" />,
        );
        await user.click(screen.getByRole("button", { name: "Cancel" }));
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it("form fields remount with fresh model data when reopened", () => {
        const { rerender } = renderWithQuery(
            <ModelFormDialog open onOpenChange={vi.fn()} mode="create" />,
        );
        // Initially pure create: name field is empty
        expect(screen.getByLabelText("Display name")).toHaveValue("");

        // Close
        rerender(
            <ModelFormDialog open={false} onOpenChange={vi.fn()} mode="edit" model={modelOverride} />,
        );
        expect(screen.queryByLabelText("Display name")).toBeNull(); // form unmounted

        // Reopen with model
        rerender(
            <ModelFormDialog open onOpenChange={vi.fn()} mode="edit" model={modelOverride} />,
        );
        expect(screen.getByDisplayValue("gpt-4o")).toBeInTheDocument();
    });
});
