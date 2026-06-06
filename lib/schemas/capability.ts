import { z } from "zod";

export const capabilityDTOSchema = z.object({
    id: z.string(),
    label: z.string(),
    description: z.string().nullable(),
    endpoint: z.string(),
    supports_streaming: z.boolean(),
});

export type CapabilityDTO = z.infer<typeof capabilityDTOSchema>;
