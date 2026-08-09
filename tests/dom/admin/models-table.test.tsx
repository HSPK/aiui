import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithQuery } from "./_render";
import { modelOverride, modelDiscovered, modelDisabled } from "./_fixtures";
import { ModelsTable } from "@/components/providers/models-table";

const mockPush = vi.fn();

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: mockPush, replace: vi.fn(), refresh: vi.fn() }),
    useSearchParams: () => new URLSearchParams(),
    usePathname: () => "/",
}));

vi.mock("@/lib/clipboard", () => ({
    copyToClipboard: vi.fn().mockResolvedValue(true),
}));

vi.mock("sonner", () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { copyToClipboard } from "@/lib/clipboard";
import { toast } from "sonner";

beforeEach(() => {
    mockPush.mockClear();
});

describe("ModelsTable", () => {
    it("renders empty state (shows inbox icon)", () => {
        renderWithQuery(<ModelsTable models={[]} />);
        // DataTableEmpty renders an Inbox icon with aria-label="empty"; children are ignored by the component
        expect(screen.getByLabelText("empty")).toBeInTheDocument();
    });

    it("renders model name", () => {
        renderWithQuery(<ModelsTable models={[modelOverride]} />);
        expect(screen.getByText("gpt-4o")).toBeInTheDocument();
    });

    it("renders provider badge", () => {
        renderWithQuery(<ModelsTable models={[modelOverride]} />);
        expect(screen.getByText("OpenAI")).toBeInTheDocument();
    });

    it("renders capability badge (Chat for chat type)", () => {
        renderWithQuery(<ModelsTable models={[modelOverride]} />);
        expect(screen.getByText("Chat")).toBeInTheDocument();
    });

    it("renders context window formatted as Xk for >=1000", () => {
        renderWithQuery(<ModelsTable models={[modelOverride]} />);
        expect(screen.getByText("128k")).toBeInTheDocument();
    });

    it("renders context window as — for null", () => {
        const m = { ...modelOverride, context_window: null };
        renderWithQuery(<ModelsTable models={[m]} />);
        expect(screen.getByText("—")).toBeInTheDocument();
    });

    it("renders small context_window with toLocaleString", () => {
        const m = { ...modelOverride, context_window: 512 };
        renderWithQuery(<ModelsTable models={[m]} />);
        expect(screen.getByText("512")).toBeInTheDocument();
    });

    it("renders 'override' badge for non-discovered model", () => {
        renderWithQuery(<ModelsTable models={[modelOverride]} />);
        expect(screen.getByText("override")).toBeInTheDocument();
    });

    it("renders 'discovered' badge for discovered model", () => {
        renderWithQuery(<ModelsTable models={[modelDiscovered]} />);
        expect(screen.getByText("discovered")).toBeInTheDocument();
    });

    it("renders strikethrough + Disabled badge for disabled model", () => {
        renderWithQuery(<ModelsTable models={[modelDisabled]} />);
        expect(screen.getByText("Disabled")).toBeInTheDocument();
        const nameEl = screen.getByText("legacy-model");
        expect(nameEl.className).toContain("line-through");
    });

    it("navigates to model detail page on row click", async () => {
        const user = userEvent.setup();
        renderWithQuery(<ModelsTable models={[modelOverride]} />);
        await user.click(screen.getByText("gpt-4o"));
        expect(mockPush).toHaveBeenCalledWith("/models/gpt-4o");
    });

    it("copy button copies model name and toasts success", async () => {
        const user = userEvent.setup();
        vi.mocked(copyToClipboard).mockResolvedValue(true);
        renderWithQuery(<ModelsTable models={[modelOverride]} />);
        const copyBtn = screen.getByRole("button", { name: "" }); // icon-only button
        await user.click(copyBtn);
        await waitFor(() =>
            expect(vi.mocked(toast.success)).toHaveBeenCalledWith("Model name copied to clipboard"),
        );
    });

    it("copy button toasts error on failure", async () => {
        const user = userEvent.setup();
        vi.mocked(copyToClipboard).mockResolvedValue(false);
        renderWithQuery(<ModelsTable models={[modelOverride]} />);
        const copyBtn = screen.getByRole("button", { name: "" });
        await user.click(copyBtn);
        await waitFor(() =>
            expect(vi.mocked(toast.error)).toHaveBeenCalledWith("Copy failed"),
        );
    });

    it("Edit button renders with 'Edit' title for override model", () => {
        const onEdit = vi.fn();
        renderWithQuery(<ModelsTable models={[modelOverride]} onEdit={onEdit} />);
        expect(screen.getByTitle("Edit")).toBeInTheDocument();
    });

    it("Edit button renders with 'Promote to override' title for discovered model", () => {
        const onEdit = vi.fn();
        renderWithQuery(<ModelsTable models={[modelDiscovered]} onEdit={onEdit} />);
        expect(screen.getByTitle("Promote to override")).toBeInTheDocument();
    });

    it("calls onEdit with model when Edit button clicked", async () => {
        const user = userEvent.setup();
        const onEdit = vi.fn();
        renderWithQuery(<ModelsTable models={[modelOverride]} onEdit={onEdit} />);
        await user.click(screen.getByTitle("Edit"));
        expect(onEdit).toHaveBeenCalledWith(modelOverride);
    });

    it("Delete button is NOT rendered for discovered model", () => {
        const onDelete = vi.fn();
        renderWithQuery(<ModelsTable models={[modelDiscovered]} onEdit={vi.fn()} onDelete={onDelete} />);
        expect(screen.queryByTitle("Delete")).toBeNull();
    });

    it("Delete button IS rendered for override model", () => {
        const onDelete = vi.fn();
        renderWithQuery(<ModelsTable models={[modelOverride]} onEdit={vi.fn()} onDelete={onDelete} />);
        expect(screen.getByTitle("Delete")).toBeInTheDocument();
    });

    it("calls onDelete with model when Delete button clicked", async () => {
        const user = userEvent.setup();
        const onDelete = vi.fn();
        renderWithQuery(<ModelsTable models={[modelOverride]} onEdit={vi.fn()} onDelete={onDelete} />);
        await user.click(screen.getByTitle("Delete"));
        expect(onDelete).toHaveBeenCalledWith(modelOverride);
    });

    it("Edit button click does NOT navigate (stopPropagation)", async () => {
        const user = userEvent.setup();
        const onEdit = vi.fn();
        renderWithQuery(<ModelsTable models={[modelOverride]} onEdit={onEdit} />);
        await user.click(screen.getByTitle("Edit"));
        expect(mockPush).not.toHaveBeenCalled();
    });

    it("renders Actions column when onEdit is provided", () => {
        renderWithQuery(<ModelsTable models={[modelOverride]} onEdit={vi.fn()} />);
        expect(screen.getByText("Actions")).toBeInTheDocument();
    });

    it("does not render Actions column when no handlers", () => {
        renderWithQuery(<ModelsTable models={[modelOverride]} />);
        expect(screen.queryByText("Actions")).toBeNull();
    });

    it("clicking actions cell area stops propagation (doesn't navigate)", async () => {
        const onEdit = vi.fn();
        const { container } = renderWithQuery(<ModelsTable models={[modelOverride]} onEdit={onEdit} />);
        // Find the actions cell (last <td> in the row) and click it directly
        const cells = container.querySelectorAll("td");
        const lastCell = cells[cells.length - 1];
        lastCell?.click();
        expect(mockPush).not.toHaveBeenCalled();
    });
});
