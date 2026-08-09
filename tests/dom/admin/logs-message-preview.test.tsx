import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { RequestPreview } from "@/components/logs/_parts/message-preview"
import { chatInput, richMarkdown } from "./_fixtures"

vi.mock("@/lib/clipboard", () => ({ copyToClipboard: vi.fn().mockResolvedValue(true) }))
import { copyToClipboard } from "@/lib/clipboard"

describe("RequestPreview", () => {
    beforeEach(() => {
        vi.mocked(copyToClipboard).mockResolvedValue(true)
    })

    it("falls back to ContentViewer for plain string input", () => {
        render(
            <RequestPreview
                title="Prompt"
                input="plain string"
                fallback="plain string"
                colorClass="bg-blue-500"
            />
        )
        // ContentViewer renders (no role badges from chat)
        expect(screen.queryByRole("button", { name: /preview/i })).toBeTruthy()
    })

    it("falls back to ContentViewer for empty messages array", () => {
        render(
            <RequestPreview
                title="Prompt"
                input={{ messages: [] }}
                fallback={null}
                colorClass="bg-blue-500"
            />
        )
        // No messages → falls back to ContentViewer with null content
        expect(screen.getByText("No content recorded")).not.toBeNull()
    })

    it("renders role badges for all roles in chatInput", () => {
        render(
            <RequestPreview
                title="Prompt"
                input={chatInput}
                fallback={null}
                colorClass="bg-blue-500"
            />
        )
        expect(screen.getByText("system")).toBeInTheDocument()
        expect(screen.getByText("user")).toBeInTheDocument()
        const assistants = screen.getAllByText("assistant")
        expect(assistants.length).toBeGreaterThan(0)
        expect(screen.getByText("tool")).toBeInTheDocument()
    })

    it("renders '+2 attachments' for user message with image+file", () => {
        render(
            <RequestPreview
                title="Prompt"
                input={chatInput}
                fallback={null}
                colorClass="bg-blue-500"
            />
        )
        expect(screen.getByText("+2 attachments")).toBeInTheDocument()
    })

    it("renders image preview img element for image_url part", () => {
        render(
            <RequestPreview
                title="Prompt"
                input={chatInput}
                fallback={null}
                colorClass="bg-blue-500"
            />
        )
        const imgs = screen.getAllByRole("img")
        // image attachment from chatInput
        const imgAttachment = imgs.find((img) => (img as HTMLImageElement).src.includes("cat.png"))
        expect(imgAttachment).toBeTruthy()
    })

    it("renders file chip with filename for file part", () => {
        render(
            <RequestPreview
                title="Prompt"
                input={chatInput}
                fallback={null}
                colorClass="bg-blue-500"
            />
        )
        expect(screen.getByText("doc.pdf")).toBeInTheDocument()
    })

    it("renders '+1 tool call' badge on assistant with tool_calls", () => {
        render(
            <RequestPreview
                title="Prompt"
                input={chatInput}
                fallback={null}
                colorClass="bg-blue-500"
            />
        )
        expect(screen.getByText("+1 tool call")).toBeInTheDocument()
    })

    it("tool role message renders content in pre tag and shows tool_call_id", () => {
        render(
            <RequestPreview
                title="Prompt"
                input={chatInput}
                fallback={null}
                colorClass="bg-blue-500"
            />
        )
        // tool role content is shown in pre
        expect(screen.getByText('{"temp": 72}')).toBeInTheDocument()
        // Multiple elements may have "call_1" (tool message ref + tool card id)
        expect(screen.getAllByText(/call_1/).length).toBeGreaterThan(0)
    })

    it("empty assistant message shows (empty) placeholder", () => {
        render(
            <RequestPreview
                title="Prompt"
                input={chatInput}
                fallback={null}
                colorClass="bg-blue-500"
            />
        )
        expect(screen.getByText("(empty)")).toBeInTheDocument()
    })

    it("LogToolCallCard expands/collapses on click and shows pretty JSON", async () => {
        render(
            <RequestPreview
                title="Prompt"
                input={chatInput}
                fallback={null}
                colorClass="bg-blue-500"
            />
        )
        // Tool call card for get_weather
        const toolBtn = screen.getByText("get_weather").closest("button")!
        expect(toolBtn).toBeTruthy()
        // Initially collapsed
        expect(screen.queryByText(/"city": "NYC"/)).toBeNull()
        await userEvent.click(toolBtn)
        // After expand
        expect(screen.getByText(/"city": "NYC"/)).toBeInTheDocument()
        // Collapse
        await userEvent.click(toolBtn)
        expect(screen.queryByText(/"city": "NYC"/)).toBeNull()
    })

    it("LogToolCallCard shows raw string for invalid JSON arguments", async () => {
        const inputWithBadArgs = {
            messages: [
                {
                    role: "assistant",
                    content: "",
                    tool_calls: [
                        { id: "call_x", type: "function", function: { name: "bad_fn", arguments: "not json" } },
                    ],
                },
            ],
        }
        render(
            <RequestPreview
                title="Prompt"
                input={inputWithBadArgs}
                fallback={null}
                colorClass="bg-blue-500"
            />
        )
        const toolBtn = screen.getByText("bad_fn").closest("button")!
        await userEvent.click(toolBtn)
        expect(screen.getByText("not json")).toBeInTheDocument()
    })

    it("Raw mode toggle shows sanitized JSON of input", async () => {
        render(
            <RequestPreview
                title="Prompt"
                input={chatInput}
                fallback={null}
                colorClass="bg-blue-500"
            />
        )
        await userEvent.click(screen.getByText(/raw/i))
        // The pre element should contain JSON
        expect(document.querySelector("pre")).toBeTruthy()
        expect(screen.getByText(/messages/)).toBeInTheDocument()
    })

    it("Preview button onClick covered: toggle raw→preview restores chat view", async () => {
        render(
            <RequestPreview
                title="Prompt"
                input={chatInput}
                fallback={null}
                colorClass="bg-blue-500"
            />
        )
        // Go to raw mode first
        await userEvent.click(screen.getByRole("button", { name: /raw/i }))
        expect(document.querySelector("pre")).toBeTruthy()
        // Click Preview to go back — covers the Preview onClick arrow function (line 104)
        await userEvent.click(screen.getByRole("button", { name: /preview/i }))
        // Chat view visible (not raw JSON — messages rendered as chat rows)
        expect(screen.getByText("system")).toBeInTheDocument()
    })

    it("unknown part type returns null (covers return null branch in parts.map)", () => {
        // A message with a part type that is neither image_url nor file
        const inputWithUnknownPart = {
            messages: [
                {
                    role: "user",
                    content: [
                        { type: "text", text: "hello" },
                        { type: "audio", audio: { url: "/foo.mp3" } }, // unknown type → return null
                    ],
                },
            ],
        }
        render(
            <RequestPreview
                title="Prompt"
                input={inputWithUnknownPart}
                fallback={null}
                colorClass="bg-blue-500"
            />
        )
        // Still renders without crash; text part visible
        expect(screen.getByText("hello")).toBeInTheDocument()
        // No img from the unknown audio part
        expect(screen.queryAllByRole("img")).toHaveLength(0)
    })

    it("shows singular '1 attachment' when message has exactly 1 attachment", () => {
        const inputWith1Attachment = {
            messages: [
                {
                    role: "user",
                    content: [
                        { type: "text", text: "see this" },
                        { type: "file", file: { filename: "report.pdf", mime_type: "application/pdf" } },
                    ],
                },
            ],
        }
        render(
            <RequestPreview title="Prompt" input={inputWith1Attachment} fallback={null} colorClass="bg-blue-500" />
        )
        expect(screen.getByText("+1 attachment")).toBeInTheDocument()
    })

    it("shows plural 'tool calls' when message has 2 tool calls", () => {
        const inputWith2ToolCalls = {
            messages: [
                {
                    role: "assistant",
                    content: "",
                    tool_calls: [
                        { id: "tc1", type: "function", function: { name: "fn_a", arguments: '{"x":1}' } },
                        { id: "tc2", type: "function", function: { name: "fn_b", arguments: '{"y":2}' } },
                    ],
                },
            ],
        }
        render(
            <RequestPreview title="Prompt" input={inputWith2ToolCalls} fallback={null} colorClass="bg-blue-500" />
        )
        expect(screen.getByText("+2 tool calls")).toBeInTheDocument()
    })

    it("LogToolCallCard with no callId hides id span", async () => {
        const inputNoCallId = {
            messages: [
                {
                    role: "assistant",
                    content: "",
                    tool_calls: [
                        { type: "function", function: { name: "no_id_fn", arguments: '{"q":1}' } },
                    ],
                },
            ],
        }
        render(
            <RequestPreview title="Prompt" input={inputNoCallId} fallback={null} colorClass="bg-blue-500" />
        )
        const toolBtn = screen.getByText("no_id_fn").closest("button")!
        expect(toolBtn).toBeTruthy()
        expect(screen.queryByText(/^tc/)).toBeNull()
    })

    it("LogToolCallCard with empty args shows empty object '{}'", async () => {
        const inputEmptyArgs = {
            messages: [
                {
                    role: "assistant",
                    content: "",
                    tool_calls: [
                        { id: "tc_e", type: "function", function: { name: "empty_fn", arguments: "" } },
                    ],
                },
            ],
        }
        render(
            <RequestPreview title="Prompt" input={inputEmptyArgs} fallback={null} colorClass="bg-blue-500" />
        )
        const toolBtn = screen.getByText("empty_fn").closest("button")!
        await userEvent.click(toolBtn)
        expect(screen.getByText("{}")).toBeInTheDocument()
    })

    it("CopyButton passes copyText with 'user:' prefix", async () => {
        render(
            <RequestPreview
                title="Prompt"
                input={chatInput}
                fallback={null}
                colorClass="bg-blue-500"
            />
        )
        await userEvent.click(screen.getByTitle("Copy to clipboard"))
        const calls = vi.mocked(copyToClipboard).mock.calls
        expect(calls.length).toBeGreaterThan(0)
        const copiedText = calls[0][0]
        expect(copiedText).toContain("user:")
    })
})
