import "server-only";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { conversations, messages } from "../db/schema";
import { forbidden, notFound } from "../response";
import type { MessageRatingInput } from "@/lib/schemas/conversation";

export function rateMessage(userId: string, messageId: string, input: MessageRatingInput): void {
    const message = db.select().from(messages).where(eq(messages.id, messageId)).get();
    if (!message) throw notFound("Message not found");

    const conv = db.select().from(conversations).where(eq(conversations.id, message.conversationId)).get();
    if (!conv || conv.userId !== userId) throw forbidden();

    db.update(messages)
        .set({
            rating: input.rating === "none" ? null : input.rating,
            feedback: input.feedback ?? null,
        })
        .where(eq(messages.id, messageId))
        .run();
}
