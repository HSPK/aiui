import { defineResource } from "./resource";
import type { ModelCreateInput, ModelDTO, ModelUpdateInput } from "@/lib/schemas/model";

export const models = defineResource<
    ModelDTO,
    ModelCreateInput,
    ModelUpdateInput,
    Record<string, unknown>,
    ModelDTO[]
>({
    path: "/models",
    key: "models",
    listShape: "array",
    invalidates: ["providers"],
});
