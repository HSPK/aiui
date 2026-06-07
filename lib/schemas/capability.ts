import { z } from "zod";

export const capabilityDTOSchema = z.object({
    id: z.string(),
    label: z.string(),
    description: z.string().nullable(),
    /** Default upstream API variant id (e.g. "chat.completions"). */
    default_variant: z.string(),
});

export type CapabilityDTO = z.infer<typeof capabilityDTOSchema>;
