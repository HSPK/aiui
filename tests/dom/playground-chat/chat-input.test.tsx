// Coverage for components/playground/chat-input.tsx — text submission,
// Enter-key semantics (sendOnEnter device setting, Shift/Ctrl/Cmd
// modifiers, IME composition guard), disabled/busy states, the
// imperative focus()/clear() ref, and attachment ingestion (file
// picker, paste, drag & drop — accept/reject by mime & size, the
// FileReader failure path, and the resulting submit content shape).
//
// ConnectedModelSelector / ModelChipsWithConfig / McpToolToggle are
// each independently owned/tested elsewhere (model-selector.tsx,
// model-chips-with-config.tsx) — stubbed here to isolate ChatInput's
// own state machine.
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { resetDeviceSettingsStore } from "./_render";
import { ChatInput, type ChatInputRef } from "@/components/playground/chat-input";
import { useDeviceSettingsStore } from "@/lib/stores/device-settings-store";
import type { MessageContent } from "@/lib/schemas/content";

const toastErrorMock = vi.fn();
vi.mock("sonner", () => ({
    toast: { error: (...args: unknown[]) => toastErrorMock(...args) },
}));

vi.mock("@/components/playground/model-selector", () => ({
    ConnectedModelSelector: (props: { conversationId: string }) => (
        <div data-testid="model-selector-stub" data-cid={props.conversationId} />
    ),
}));
vi.mock("@/components/playground/model-chips-with-config", () => ({
    ModelChipsWithConfig: (props: { conversationId: string }) => (
        <div data-testid="model-chips-stub" data-cid={props.conversationId} />
    ),
}));
vi.mock("@/components/playground/mcp-tool-toggle", () => ({
    McpToolToggle: (props: { conversationId: string }) => (
        <div data-testid="mcp-toggle-stub" data-cid={props.conversationId} />
    ),
}));

// Mirrors the private constant in chat-input.tsx (not exported).
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

function makeFile(name: string, content: string, type: string): File {
    return new File([content], name, { type });
}

/** Fakes a large `.size` without allocating a real multi-MB buffer. */
function oversizedFile(name: string, type: string): File {
    const f = new File(["x"], name, { type });
    Object.defineProperty(f, "size", { value: MAX_ATTACHMENT_BYTES + 1024 });
    return f;
}

interface HarnessProps {
    onSubmit?: (content: MessageContent) => void;
    isLoading?: boolean;
    onStop?: () => void;
    blockedByFailedTail?: boolean;
}

/** Wraps ChatInput with a ref + trigger buttons so focus()/clear() can
 *  be exercised via plain clicks. */
function Harness({ onSubmit = vi.fn(), isLoading = false, onStop = vi.fn(), blockedByFailedTail }: HarnessProps) {
    const ref = React.useRef<ChatInputRef>(null);
    return (
        <>
            <ChatInput
                ref={ref}
                conversationId="conv-1"
                onSubmit={onSubmit}
                isLoading={isLoading}
                onStop={onStop}
                blockedByFailedTail={blockedByFailedTail}
            />
            <button type="button" onClick={() => ref.current?.focus()}>trigger-focus</button>
            <button type="button" onClick={() => ref.current?.clear()}>trigger-clear</button>
        </>
    );
}

function fileInput(container: HTMLElement): HTMLInputElement {
    return container.querySelector('input[type="file"]') as HTMLInputElement;
}
// The Send button is the only `type="submit"` button in the form.
function sendButton(container: HTMLElement): HTMLButtonElement | null {
    return container.querySelector('form button[type="submit"]');
}
// The Stop button is icon-only with no accessible name/title, unlike
// the Attach button (`title="Attach files…"`) and chip Remove buttons
// (`title="Remove"`) — structural selector is the only reliable way in.
function stopButton(container: HTMLElement): HTMLButtonElement | null {
    return container.querySelector('form button[type="button"]:not([title])');
}

afterEach(() => {
    resetDeviceSettingsStore();
});

describe("ChatInput — rendering & sub-component wiring", () => {
    it("wires conversationId through to the model selector, mcp toggle, and model chips stubs", () => {
        render(<Harness />);
        expect(screen.getByTestId("model-selector-stub")).toHaveAttribute("data-cid", "conv-1");
        expect(screen.getByTestId("mcp-toggle-stub")).toHaveAttribute("data-cid", "conv-1");
        expect(screen.getByTestId("model-chips-stub")).toHaveAttribute("data-cid", "conv-1");
    });

    it("shows the default placeholder and neither a Send nor Stop button while idle and empty", () => {
        const { container } = render(<Harness />);
        expect(screen.getByRole("textbox")).toHaveAttribute("placeholder", "Message AI…");
        expect(sendButton(container)).not.toBeInTheDocument();
        expect(stopButton(container)).not.toBeInTheDocument();
    });

    it("disables the textarea and swaps in the retry hint placeholder when blockedByFailedTail", () => {
        render(<Harness blockedByFailedTail />);
        const textarea = screen.getByRole("textbox");
        expect(textarea).toBeDisabled();
        expect(textarea).toHaveAttribute("placeholder", "Retry the failed message first");
    });
});

describe("ChatInput — text submission", () => {
    it("reveals the Send button once there is text, submits the trimmed value, and clears the input", async () => {
        const onSubmit = vi.fn();
        const user = userEvent.setup();
        const { container } = render(<Harness onSubmit={onSubmit} />);
        const textarea = screen.getByRole("textbox");

        await user.type(textarea, "  hello there  ");
        expect(sendButton(container)).toBeInTheDocument();

        await user.click(sendButton(container)!);
        expect(onSubmit).toHaveBeenCalledExactlyOnceWith("hello there");
        expect(textarea).toHaveValue("");
        expect(sendButton(container)).not.toBeInTheDocument();
    });

    it("never reveals the Send button for whitespace-only input", async () => {
        const user = userEvent.setup();
        const { container } = render(<Harness />);
        await user.type(screen.getByRole("textbox"), "   ");
        expect(sendButton(container)).not.toBeInTheDocument();
    });

    it("shows the Stop button (not Send) while isLoading, and clicking it invokes onStop", async () => {
        const onStop = vi.fn();
        const user = userEvent.setup();
        const { container } = render(<Harness isLoading onStop={onStop} />);
        expect(sendButton(container)).not.toBeInTheDocument();
        const stop = stopButton(container);
        expect(stop).toBeInTheDocument();
        await user.click(stop!);
        expect(onStop).toHaveBeenCalledOnce();
    });
});

describe("ChatInput — keyboard submit semantics", () => {
    it("submits trimmed text via plain Enter when sendOnEnter is true (the default)", async () => {
        const onSubmit = vi.fn();
        const user = userEvent.setup();
        render(<Harness onSubmit={onSubmit} />);
        const textarea = screen.getByRole("textbox");

        await user.type(textarea, "  hi  ");
        await user.keyboard("{Enter}");

        expect(onSubmit).toHaveBeenCalledExactlyOnceWith("hi");
        expect(textarea).toHaveValue("");
    });

    it("Shift+Enter inserts a newline and never submits, even when sendOnEnter is true", async () => {
        const onSubmit = vi.fn();
        const user = userEvent.setup();
        render(<Harness onSubmit={onSubmit} />);
        const textarea = screen.getByRole("textbox");

        await user.type(textarea, "line one");
        await user.keyboard("{Shift>}{Enter}{/Shift}");
        await user.type(textarea, "line two");

        expect(onSubmit).not.toHaveBeenCalled();
        expect(textarea).toHaveValue("line one\nline two");
    });

    it("with sendOnEnter=false, plain Enter inserts a newline instead of submitting", async () => {
        act(() => useDeviceSettingsStore.setState({ sendOnEnter: false }));
        const onSubmit = vi.fn();
        const user = userEvent.setup();
        render(<Harness onSubmit={onSubmit} />);
        const textarea = screen.getByRole("textbox");

        await user.type(textarea, "hello");
        await user.keyboard("{Enter}");

        expect(onSubmit).not.toHaveBeenCalled();
        await waitFor(() => expect(textarea).toHaveValue("hello\n"));
    });

    it("with sendOnEnter=false, Ctrl+Enter still submits (metaKey false, ctrlKey true)", async () => {
        act(() => useDeviceSettingsStore.setState({ sendOnEnter: false }));
        const onSubmit = vi.fn();
        const user = userEvent.setup();
        render(<Harness onSubmit={onSubmit} />);
        const textarea = screen.getByRole("textbox");

        await user.type(textarea, "hello");
        await user.keyboard("{Control>}{Enter}{/Control}");

        await waitFor(() => expect(onSubmit).toHaveBeenCalledExactlyOnceWith("hello"));
    });

    it("with sendOnEnter=false, Cmd(Meta)+Enter still submits (metaKey true)", async () => {
        act(() => useDeviceSettingsStore.setState({ sendOnEnter: false }));
        const onSubmit = vi.fn();
        const user = userEvent.setup();
        render(<Harness onSubmit={onSubmit} />);
        const textarea = screen.getByRole("textbox");

        await user.type(textarea, "hello");
        await user.keyboard("{Meta>}{Enter}{/Meta}");

        await waitFor(() => expect(onSubmit).toHaveBeenCalledExactlyOnceWith("hello"));
    });

    it("an IME composition Enter never submits; the following plain Enter (post-composition) does", async () => {
        const onSubmit = vi.fn();
        render(<Harness onSubmit={onSubmit} />);
        const textarea = screen.getByRole("textbox");

        fireEvent.change(textarea, { target: { value: "こんにちは" } });
        fireEvent.compositionStart(textarea);
        fireEvent.keyDown(textarea, { key: "Enter" });
        expect(onSubmit).not.toHaveBeenCalled();

        fireEvent.compositionEnd(textarea);
        fireEvent.keyDown(textarea, { key: "Enter" });
        expect(onSubmit).toHaveBeenCalledExactlyOnceWith("こんにちは");
    });

    it("pressing Enter on an empty textarea is a no-op (buildContent returns null)", async () => {
        const onSubmit = vi.fn();
        const user = userEvent.setup();
        render(<Harness onSubmit={onSubmit} />);
        await user.click(screen.getByRole("textbox"));
        await user.keyboard("{Enter}");
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it("ignores non-Enter keys entirely (no submit, no preventDefault side effects)", async () => {
        const onSubmit = vi.fn();
        const user = userEvent.setup();
        render(<Harness onSubmit={onSubmit} />);
        await user.type(screen.getByRole("textbox"), "abc");
        expect(onSubmit).not.toHaveBeenCalled();
        expect(screen.getByRole("textbox")).toHaveValue("abc");
    });

    it("does not submit via Enter while isLoading, even with text present and sendOnEnter true", async () => {
        const onSubmit = vi.fn();
        const user = userEvent.setup();
        render(<Harness onSubmit={onSubmit} isLoading />);
        await user.type(screen.getByRole("textbox"), "hello");
        await user.keyboard("{Enter}");
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it("does not submit via Enter while blockedByFailedTail", () => {
        const onSubmit = vi.fn();
        render(<Harness onSubmit={onSubmit} blockedByFailedTail />);
        const textarea = screen.getByRole("textbox");
        // The textarea is `disabled`, so a real user can't focus/type into
        // it; dispatch the keydown directly to exercise handleSubmit's own
        // `blockedByFailedTail` guard.
        fireEvent.keyDown(textarea, { key: "Enter" });
        expect(onSubmit).not.toHaveBeenCalled();
    });
});

describe("ChatInput — imperative ref", () => {
    it("focus() focuses the textarea", async () => {
        const user = userEvent.setup();
        render(<Harness />);
        const textarea = screen.getByRole("textbox");
        expect(textarea).not.toHaveFocus();
        await user.click(screen.getByText("trigger-focus"));
        expect(textarea).toHaveFocus();
    });

    it("clear() empties both the text and any staged attachments", async () => {
        const user = userEvent.setup({ applyAccept: false });
        const { container } = render(<Harness />);
        const textarea = screen.getByRole("textbox");
        await user.type(textarea, "draft text");
        await user.upload(fileInput(container), makeFile("note.txt", "hello", "text/plain"));
        expect(await screen.findByText("note.txt")).toBeInTheDocument();

        await user.click(screen.getByText("trigger-clear"));

        expect(textarea).toHaveValue("");
        expect(screen.queryByText("note.txt")).not.toBeInTheDocument();
    });
});

describe("ChatInput — attachment ingestion: file picker", () => {
    it("clicking the paperclip button opens the (hidden) file picker", async () => {
        const user = userEvent.setup();
        const { container } = render(<Harness />);
        const input = fileInput(container);
        const clickSpy = vi.fn();
        input.click = clickSpy;

        await user.click(screen.getByTitle("Attach files (images / PDFs / text)"));
        expect(clickSpy).toHaveBeenCalledOnce();
    });

    it("accepts an image file, rendering an <img> preview chip with filename and human-readable size", async () => {
        const user = userEvent.setup();
        const { container } = render(<Harness />);
        await user.upload(fileInput(container), makeFile("cat.png", "12345", "image/png"));

        expect(await screen.findByText("cat.png")).toBeInTheDocument();
        expect(screen.getByText("5 B")).toBeInTheDocument();
        const img = container.querySelector("img[alt='cat.png']");
        expect(img).toBeInTheDocument();
        expect(img).toHaveAttribute("src", expect.stringContaining("data:"));
    });

    it("accepts a non-image file (pdf), rendering a FileText icon chip instead of an <img>", async () => {
        const user = userEvent.setup();
        const { container } = render(<Harness />);
        await user.upload(fileInput(container), makeFile("doc.pdf", "pdf-bytes", "application/pdf"));

        expect(await screen.findByText("doc.pdf")).toBeInTheDocument();
        expect(container.querySelector("img")).not.toBeInTheDocument();
        expect(container.querySelector("svg.lucide-file-text")).toBeInTheDocument();
    });

    it("formats a mid-sized (KB-range) attachment's size with the KB formatter, not B or MB", async () => {
        const user = userEvent.setup();
        const { container } = render(<Harness />);
        await user.upload(fileInput(container), makeFile("mid.pdf", "x".repeat(2048), "application/pdf"));
        expect(await screen.findByText("2 KB")).toBeInTheDocument();
    });

    it("falls back to the literal filename 'attachment' when the picked file has an empty name", async () => {
        const user = userEvent.setup();
        const { container } = render(<Harness />);
        await user.upload(fileInput(container), makeFile("", "aaa", "image/png"));
        expect(await screen.findByText("attachment")).toBeInTheDocument();
    });

    it("rejects an oversized file with a toast, and does not render a chip for it", async () => {
        const user = userEvent.setup();
        const { container } = render(<Harness />);
        await user.upload(fileInput(container), oversizedFile("huge.png", "image/png"));

        await waitFor(() => expect(toastErrorMock).toHaveBeenCalledOnce());
        expect(toastErrorMock.mock.calls[0][0]).toContain("exceeds");
        expect(screen.queryByText("huge.png")).not.toBeInTheDocument();
    });

    it("rejects an unsupported mime type with a toast, and does not render a chip for it", async () => {
        // `accept` on <input type=file> only filters the OS picker dialog —
        // it does not stop a real user from dragging/pasting an arbitrary
        // file onto the input, so component-level mime validation still has
        // to run. `applyAccept: false` simulates that bypass.
        const user = userEvent.setup({ applyAccept: false });
        const { container } = render(<Harness />);
        await user.upload(fileInput(container), makeFile("archive.zip", "PK\u0003\u0004", "application/zip"));

        await waitFor(() => expect(toastErrorMock).toHaveBeenCalledOnce());
        expect(toastErrorMock.mock.calls[0][0]).toContain("unsupported type");
        expect(screen.queryByText("archive.zip")).not.toBeInTheDocument();
    });

    it("falls back to application/octet-stream (and rejects) a file with no browser-sniffed mime type", async () => {
        const user = userEvent.setup({ applyAccept: false });
        const { container } = render(<Harness />);
        await user.upload(fileInput(container), makeFile("mystery", "data", ""));

        await waitFor(() => expect(toastErrorMock).toHaveBeenCalledOnce());
        expect(toastErrorMock.mock.calls[0][0]).toContain("application/octet-stream");
    });

    it("processes a mixed batch in one pick — only the accepted files render chips, each rejection toasts once", async () => {
        const user = userEvent.setup({ applyAccept: false });
        const { container } = render(<Harness />);
        await user.upload(fileInput(container), [
            makeFile("ok1.png", "aaa", "image/png"),
            makeFile("bad.zip", "bbb", "application/zip"),
            makeFile("ok2.pdf", "ccc", "application/pdf"),
        ]);

        expect(await screen.findByText("ok1.png")).toBeInTheDocument();
        expect(screen.getByText("ok2.pdf")).toBeInTheDocument();
        expect(screen.queryByText("bad.zip")).not.toBeInTheDocument();
        expect(toastErrorMock).toHaveBeenCalledOnce();
    });

    it("toasts a read failure (FileReader error) and adds no chip, without touching other accepted files", async () => {
        const spy = vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(function (this: FileReader) {
            queueMicrotask(() => this.onerror?.(new ProgressEvent("error") as unknown as ProgressEvent<FileReader>));
        });
        const user = userEvent.setup();
        const { container } = render(<Harness />);
        await user.upload(fileInput(container), makeFile("corrupt.png", "data", "image/png"));

        await waitFor(() => expect(toastErrorMock).toHaveBeenCalledOnce());
        expect(toastErrorMock.mock.calls[0][0]).toContain("failed to read");
        expect(screen.queryByText("corrupt.png")).not.toBeInTheDocument();
        spy.mockRestore();
    });

    it("removes only the targeted attachment when its chip's Remove button is clicked", async () => {
        const user = userEvent.setup();
        const { container } = render(<Harness />);
        await user.upload(fileInput(container), [
            makeFile("a.png", "aaa", "image/png"),
            makeFile("b.png", "bbb", "image/png"),
        ]);
        expect(await screen.findByText("a.png")).toBeInTheDocument();
        expect(screen.getByText("b.png")).toBeInTheDocument();

        const chipA = screen.getByText("a.png").closest("div.group") as HTMLElement;
        await user.click(within(chipA).getByTitle("Remove"));

        expect(screen.queryByText("a.png")).not.toBeInTheDocument();
        expect(screen.getByText("b.png")).toBeInTheDocument();
    });

    it("resets the file input's value after a pick so choosing the same file again re-triggers ingestion", async () => {
        const user = userEvent.setup();
        const { container } = render(<Harness />);
        const input = fileInput(container);
        await user.upload(input, makeFile("same.png", "aaa", "image/png"));
        expect(await screen.findByText("same.png")).toBeInTheDocument();
        expect(input.value).toBe("");
    });

    it("adds no chip when every file in the batch is rejected", async () => {
        const user = userEvent.setup();
        const { container } = render(<Harness />);
        await user.upload(fileInput(container), oversizedFile("nope.png", "image/png"));
        await waitFor(() => expect(toastErrorMock).toHaveBeenCalledOnce());
        expect(container.querySelectorAll(".group.relative").length).toBe(0);
    });

    it("does nothing when the file dialog is cancelled (change event fires with an empty file list)", async () => {
        const { container } = render(<Harness />);
        await act(async () => {
            fireEvent.change(fileInput(container), { target: { files: [] } });
        });
        expect(toastErrorMock).not.toHaveBeenCalled();
        expect(container.querySelectorAll(".group.relative").length).toBe(0);
    });
});

describe("ChatInput — attachment ingestion: paste", () => {
    function pasteWithFiles(target: Element, files: File[]) {
        const items = files.map((f) => ({ kind: "file", getAsFile: () => f }));
        fireEvent.paste(target, { clipboardData: { items } });
    }

    it("ingests a pasted file as an attachment", async () => {
        render(<Harness />);
        const textarea = screen.getByRole("textbox");
        await act(async () => {
            pasteWithFiles(textarea, [makeFile("pasted.png", "aaa", "image/png")]);
        });
        expect(await screen.findByText("pasted.png")).toBeInTheDocument();
    });

    it("does nothing when the paste clipboard has no file items", async () => {
        render(<Harness />);
        const textarea = screen.getByRole("textbox");
        await act(async () => {
            fireEvent.paste(textarea, { clipboardData: { items: [{ kind: "string", getAsFile: () => null }] } });
        });
        expect(toastErrorMock).not.toHaveBeenCalled();
        expect(screen.queryByText(/\.png|\.pdf|\.txt/)).not.toBeInTheDocument();
    });

    it("does nothing when the paste clipboard's items list is empty", async () => {
        render(<Harness />);
        const textarea = screen.getByRole("textbox");
        await act(async () => {
            fireEvent.paste(textarea, { clipboardData: { items: [] } });
        });
        expect(toastErrorMock).not.toHaveBeenCalled();
    });

    it("skips a file-kind clipboard item whose getAsFile() resolves to null", async () => {
        render(<Harness />);
        const textarea = screen.getByRole("textbox");
        await act(async () => {
            fireEvent.paste(textarea, { clipboardData: { items: [{ kind: "file", getAsFile: () => null }] } });
        });
        expect(toastErrorMock).not.toHaveBeenCalled();
        expect(screen.queryByRole("img")).not.toBeInTheDocument();
    });
});

describe("ChatInput — attachment ingestion: drag & drop", () => {
    it("shows the drop placeholder while dragging a file over, and reverts once dropped", async () => {
        const { container } = render(<Harness />);
        const form = container.querySelector("form") as HTMLElement;
        const textarea = screen.getByRole("textbox");

        fireEvent.dragEnter(form, { dataTransfer: { types: ["Files"] } });
        expect(textarea).toHaveAttribute("placeholder", "Drop files to attach");

        fireEvent.dragOver(form, { dataTransfer: { types: ["Files"] } });
        expect(textarea).toHaveAttribute("placeholder", "Drop files to attach");

        const file = makeFile("dropped.png", "aaa", "image/png");
        await act(async () => {
            fireEvent.drop(form, { dataTransfer: { types: ["Files"], files: [file] } });
        });
        expect(await screen.findByText("dropped.png")).toBeInTheDocument();
        expect(textarea).toHaveAttribute("placeholder", "Message AI…");
    });

    it("ignores drag events that don't carry a Files payload (e.g. dragging plain text)", () => {
        const { container } = render(<Harness />);
        const form = container.querySelector("form") as HTMLElement;
        const textarea = screen.getByRole("textbox");

        fireEvent.dragEnter(form, { dataTransfer: { types: ["text/plain"] } });
        expect(textarea).toHaveAttribute("placeholder", "Message AI…");
    });

    it("ignores a dragOver that doesn't carry a Files payload (handleDragOver's own guard, independent of dragEnter's)", () => {
        const { container } = render(<Harness />);
        const form = container.querySelector("form") as HTMLElement;
        // No preceding dragEnter — exercises handleDragOver in isolation.
        expect(() => fireEvent.dragOver(form, { dataTransfer: { types: ["text/plain"] } })).not.toThrow();
        expect(screen.getByRole("textbox")).toHaveAttribute("placeholder", "Message AI…");
    });

    it("keeps the dragging state active across a nested dragEnter until every dragLeave is balanced", () => {
        const { container } = render(<Harness />);
        const form = container.querySelector("form") as HTMLElement;
        const textarea = screen.getByRole("textbox");

        fireEvent.dragEnter(form, { dataTransfer: { types: ["Files"] } });
        fireEvent.dragEnter(form, { dataTransfer: { types: ["Files"] } }); // nested child element entered
        fireEvent.dragLeave(form);
        expect(textarea).toHaveAttribute("placeholder", "Drop files to attach"); // still dragging (counter 1)

        fireEvent.dragLeave(form);
        expect(textarea).toHaveAttribute("placeholder", "Message AI…"); // counter reached 0
    });

    it("does nothing on a drop with zero files", async () => {
        const { container } = render(<Harness />);
        const form = container.querySelector("form") as HTMLElement;
        await act(async () => {
            fireEvent.drop(form, { dataTransfer: { types: [], files: [] } });
        });
        expect(toastErrorMock).not.toHaveBeenCalled();
        expect(container.querySelectorAll(".group.relative").length).toBe(0);
    });
});

describe("ChatInput — submit content shape", () => {
    it("submits text-only input as a plain string", async () => {
        const onSubmit = vi.fn();
        const user = userEvent.setup();
        const { container } = render(<Harness onSubmit={onSubmit} />);
        await user.type(screen.getByRole("textbox"), "just text");
        await user.click(sendButton(container)!);
        expect(onSubmit).toHaveBeenCalledExactlyOnceWith("just text");
    });

    it("submits an attachment-only turn as ContentPart[] with no text part", async () => {
        const onSubmit = vi.fn();
        const user = userEvent.setup();
        const { container } = render(<Harness onSubmit={onSubmit} />);
        await user.upload(fileInput(container), makeFile("img.png", "aaa", "image/png"));
        await screen.findByText("img.png");

        await user.click(sendButton(container)!);
        expect(onSubmit).toHaveBeenCalledOnce();
        const content = onSubmit.mock.calls[0][0] as Array<{ type: string }>;
        expect(Array.isArray(content)).toBe(true);
        expect(content).toHaveLength(1);
        expect(content[0].type).toBe("image_url");
    });

    it("submits text + a non-image attachment as [text, file] parts, in that order", async () => {
        const onSubmit = vi.fn();
        const user = userEvent.setup();
        const { container } = render(<Harness onSubmit={onSubmit} />);
        await user.type(screen.getByRole("textbox"), "see attached");
        await user.upload(fileInput(container), makeFile("report.pdf", "aaa", "application/pdf"));
        await screen.findByText("report.pdf");

        await user.click(sendButton(container)!);
        const content = onSubmit.mock.calls[0][0] as Array<Record<string, unknown>>;
        expect(content).toHaveLength(2);
        expect(content[0]).toEqual({ type: "text", text: "see attached" });
        expect(content[1].type).toBe("file");
        expect((content[1].file as { filename: string }).filename).toBe("report.pdf");
    });
});

describe("ChatInput — React.memo comparator (guards the historical R21 stale-closure regression)", () => {
    // ChatInput deliberately uses an explicit prop-by-prop shallow
    // comparator instead of memo's implicit default (see the
    // component-header comment) so a re-render is never skipped when any
    // prop — especially callbacks — changes. Exercise it directly via
    // `rerender`, one prop at a time, so each comparison in the chain is
    // evaluated both true (falls through) and false (short-circuits, and
    // React re-renders with the fresh props).
    it("re-renders and adopts the latest props whenever conversationId, isLoading, blockedByFailedTail, onSubmit, or onStop changes", async () => {
        const user = userEvent.setup();
        const onSubmitA = vi.fn();
        const onStopA = vi.fn();
        const onSubmitB = vi.fn();
        const onStopB = vi.fn();

        const { rerender, container } = render(
            <ChatInput conversationId="c1" onSubmit={onSubmitA} isLoading={false} onStop={onStopA} />
        );
        expect(screen.getByTestId("model-selector-stub")).toHaveAttribute("data-cid", "c1");

        rerender(<ChatInput conversationId="c2" onSubmit={onSubmitA} isLoading={false} onStop={onStopA} />);
        expect(screen.getByTestId("model-selector-stub")).toHaveAttribute("data-cid", "c2");

        rerender(<ChatInput conversationId="c2" onSubmit={onSubmitA} isLoading onStop={onStopA} />);
        expect(stopButton(container)).toBeInTheDocument();

        rerender(
            <ChatInput conversationId="c2" onSubmit={onSubmitA} isLoading={false} onStop={onStopA} blockedByFailedTail />
        );
        expect(screen.getByRole("textbox")).toBeDisabled();

        // onSubmit changes: the historical bug was memo skipping this,
        // leaving callers invoking a stale closure.
        rerender(<ChatInput conversationId="c2" onSubmit={onSubmitB} isLoading={false} onStop={onStopA} />);
        await user.type(screen.getByRole("textbox"), "hi");
        await user.keyboard("{Enter}");
        expect(onSubmitB).toHaveBeenCalledExactlyOnceWith("hi");
        expect(onSubmitA).not.toHaveBeenCalled();

        rerender(<ChatInput conversationId="c2" onSubmit={onSubmitB} isLoading onStop={onStopB} />);
        await user.click(stopButton(container)!);
        expect(onStopB).toHaveBeenCalledOnce();
        expect(onStopA).not.toHaveBeenCalled();
    });

    it("tolerates a rerender with entirely unchanged props (every comparator check evaluates true)", () => {
        const onSubmit = vi.fn();
        const onStop = vi.fn();
        const { rerender } = render(
            <ChatInput conversationId="c1" onSubmit={onSubmit} isLoading={false} onStop={onStop} />
        );
        rerender(<ChatInput conversationId="c1" onSubmit={onSubmit} isLoading={false} onStop={onStop} />);
        expect(screen.getByRole("textbox")).toBeInTheDocument();
    });
});
