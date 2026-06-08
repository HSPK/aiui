import { defineResource } from "./resource";
import type {
    McpServerCreateInput,
    McpServerDTO,
    McpServerUpdateInput,
} from "@/lib/schemas/mcp";

export const mcpServers = defineResource<
    McpServerDTO,
    McpServerCreateInput,
    McpServerUpdateInput,
    Record<string, unknown>,
    McpServerDTO[]
>({
    path: "/mcp/servers",
    key: "mcp-servers",
    listShape: "array",
    staleTime: 60_000,
});
