import { z } from "zod";

export const messageRatingSchema = z.object({
    rating: z.enum(["up", "down", "none"]),
    feedback: z.string().nullable().optional(),
});

export type MessageRatingInput = z.infer<typeof messageRatingSchema>;
