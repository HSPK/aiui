"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"

import { ChatFlow } from "@/components/playground/chat-flow"
import { ConversationSidebar } from "@/components/playground/conversation-sidebar"
import { conversations } from "@/lib/api/conversations"
import type { Message } from "@/components/playground/chat/types"

const INITIAL_PAGE_SIZE = 20
const MemoizedChatFlow = React.memo(ChatFlow)

export default function ChatPlaygroundPage() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const queryClient = useQueryClient()
    const urlConvId = searchParams?.get("c") ?? null
    // "New chat" pushes /playground/chat?n=<ts> to force a fresh mint
    // when the user is already on a draft (bare /playground/chat would
    // be a no-op since Next.js dedupes identical navigations). The
    // newSessionToken is a one-shot signal the auto-mint reacts to.
    const newSessionToken = searchParams?.get("n") ?? null

    // Route-driven id: when the user lands here with no ?c= (fresh
    // visit OR sidebar "New chat" click), mint a fresh id and
    // router.replace to put it in the URL.
    //
    // Pre-seed the messages cache for the new id so usePaginatedMessages
    // sees `data = []` immediately on first render. Without this, the
    // query fires a /messages?page=1 round-trip that 404s (the server
    // creates the row on first send), and the chat surface shows a
    // "Loading conversation…" spinner for the 100-500ms RTT.
    //
    // Guard against re-running on stale urlConvId snapshots: only mint
    // when both (a) URL has no ?c=, AND (b) we haven't already minted
    // for the current newSessionToken. Without (b), useSearchParams's
    // transient null state during a sidebar-initiated navigation could
    // cause this effect to fire a SECOND mint that overwrites the
    // user's destination URL — surfacing as "clicking sidebar does
    // nothing" because the URL gets immediately replaced back.
    const lastMintedTokenRef = React.useRef<string | null>(null)
    React.useEffect(() => {
        if (urlConvId) {
            // URL has a real id — record the session so we don't mint
            // again until the user explicitly clears via New chat.
            lastMintedTokenRef.current = newSessionToken ?? "__initial__"
            return
        }
        // Only mint when we see a NEW session token (or first ever).
        const currentToken = newSessionToken ?? "__initial__"
        if (lastMintedTokenRef.current === currentToken) return
        lastMintedTokenRef.current = currentToken

        const fresh = crypto.randomUUID()
        queryClient.setQueryData<Message[]>(
            conversations.messagesCacheKey(fresh, INITIAL_PAGE_SIZE),
            [],
        )
        router.replace(`/playground/chat?c=${fresh}`)
    }, [urlConvId, newSessionToken, router, queryClient])

    return (
        <div className="h-full flex overflow-hidden bg-background">
            <ConversationSidebar />
            <div className="flex-1 flex flex-col overflow-hidden">
                {urlConvId && (
                    <MemoizedChatFlow key={urlConvId} conversationId={urlConvId} />
                )}
            </div>
        </div>
    )
}

