import { z } from "zod";

/** UI-friendly descriptor of a registered UpstreamApiVariant — returned
 *  by GET /api/variants. Used by the admin model-edit form to populate
 *  the "Pinned API variant" dropdown. */
export const variantDescriptorSchema = z.object({
    id: z.string(),
    /** Capability id this variant serves (e.g. "chat"). */
    capability: z.string(),
    path: z.string(),
    supports_streaming: z.boolean(),
});

export type VariantDescriptor = z.infer<typeof variantDescriptorSchema>;
