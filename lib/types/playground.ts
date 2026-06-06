export type {
    MessageRole,
    ConversationDTO as Conversation,
    MessageDTO as Message,
} from "@/lib/schemas/conversation";
import type { ConversationDTO, MessageDTO } from "@/lib/schemas/conversation";
import type { Paginated } from "@/lib/schemas/common";

export type ConversationListResponse = Paginated<ConversationDTO>;
export type MessageListResponse = Paginated<MessageDTO>;
