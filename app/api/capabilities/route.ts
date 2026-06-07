import "server-only";
import { defineRoute } from "@/lib/server/route";
import { listCapabilities } from "@/lib/server/capabilities";
import "@/lib/server/capabilities/register";

export const GET = defineRoute({
    handler: () =>
        listCapabilities().map((c) => ({
            id: c.id,
            label: c.label,
            description: c.description ?? null,
            default_variant: c.defaultVariantId,
        })),
});
