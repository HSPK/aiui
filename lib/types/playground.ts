export interface Conversation {
    id: string;
    user_id: string;
    title: string;
    config: Record<string, any>;
    group_id?: string;
    search_text?: string;
    created_at: string;
    updated_at: string;
    is_deleted: boolean;
}

export type MessageRole = "user" | "assistant" | "system" | "tool";

export interface Message {
    id: string;
    conversation_id: string;
    role: MessageRole;
    content: any[]; // The user provided TextContent | ImageContent etc, simplifying for now
    reasoning_content?: string;
    model_id?: string;
    generation_id?: string;
    parent_id?: string;
    meta?: Record<string, any>;
    is_active: boolean;
    rating?: "up" | "down";
    feedback?: string;
    created_at: string;
}

export interface ConversationListResponse {
    items: Conversation[];
    total: number;
    page: number;
    page_size: number;
}

export interface MessageListResponse {
    items: Message[];
    total: number;
    page: number;
    page_size: number;
}
