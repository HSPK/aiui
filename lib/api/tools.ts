import { defineResource } from "./resource";
import type { ToolCreateInput, ToolDTO, ToolUpdateInput } from "@/lib/schemas/tool";

export const tools = defineResource<
    ToolDTO,
    ToolCreateInput,
    ToolUpdateInput,
    Record<string, unknown>,
    ToolDTO[]
>({
    path: "/tools",
    key: "tools",
    listShape: "array",
    staleTime: 60_000,
});
