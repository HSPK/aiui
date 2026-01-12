"use client"

import * as React from "react"
import type { Message } from "@/components/playground/chat/types"

export interface UseContextAssistantReturn {
    contextAssistantId: string | undefined
    contextAssistantIdRef: React.MutableRefObject<string | undefined>
}

/**
 * Hook to determine which assistant message should be used as context
 * for the next user message (for sibling/branching conversations)
 * 
 * Priority:
 * 1. User selection (from selectedSiblings Map)
 * 2. Sibling that is used as parent by subsequent messages (active in flow)
 * 3. Default to last sibling
 */
export function useContextAssistant(
    messages: Message[],
    selectedSiblings: Map<string, number>
): UseContextAssistantReturn {
    const contextAssistantId = React.useMemo(() => {
        // Find the last user message
        let lastUser: Message | null = null
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === 'user') {
                lastUser = messages[i]
                break
            }
        }

        if (!lastUser) {
            // Fallback: last assistant in the list
            const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant')
            return lastAssistant?.id
        }

        // Get siblings of the last user message (assistant responses to that user message)
        const siblings = messages.filter(m => m.role === 'assistant' && m.parent_id === lastUser!.id)
        if (siblings.length === 0) {
            const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant')
            return lastAssistant?.id
        }

        // Sort siblings by created_at
        siblings.sort((a, b) => {
            const dateA = new Date(a.created_at || a.createdAt || 0).getTime()
            const dateB = new Date(b.created_at || b.createdAt || 0).getTime()
            return dateA - dateB
        })

        // Priority 1: User selection (from selectedSiblings Map)
        if (selectedSiblings.has(lastUser.id)) {
            const selectedIdx = selectedSiblings.get(lastUser.id)!
            const safeIdx = Math.min(selectedIdx, siblings.length - 1)
            return siblings[safeIdx]?.id
        }

        // Priority 2: Find which sibling is used as parent by subsequent messages
        const usedAsParent = new Set<string>()
        messages.forEach((m) => {
            if (m.parent_id) usedAsParent.add(m.parent_id)
        })

        for (let i = 0; i < siblings.length; i++) {
            if (usedAsParent.has(siblings[i].id)) {
                return siblings[i].id
            }
        }

        // Priority 3: Default to last sibling
        return siblings[siblings.length - 1]?.id
    }, [messages, selectedSiblings])

    // Ref for stable callback access
    const contextAssistantIdRef = React.useRef(contextAssistantId)
    contextAssistantIdRef.current = contextAssistantId

    return {
        contextAssistantId,
        contextAssistantIdRef
    }
}
