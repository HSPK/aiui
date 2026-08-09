"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"

import { ChatFlow } from "@/components/playground/chat-flow"
import { ConversationSidebar } from "@/components/playground/conversation-sidebar"
import { conversations } from "@/lib/api/conversations"
import type { Message } from "@/components/playground/chat/types"

const INITIAL_PAGE_SIZE = 20
const MemoizedChatFlow = React.memo(ChatFlow)

/**
 * Chat playground page.
 *
 * URL contract:
 *   - `?c=<id>`   real (server-side) conversation OR previously-minted
 *                  client draft id that's now in the user's history
 *   - no `?c=`    draft mode: page mounts a client-only UUID via
 *                  useState; ChatFlow operates against it. URL stays
 *                  `/playground/chat` until the user sends the first
 *                  message — at which point ChatFlow itself promotes
 *                  the URL via router.replace (see chat-flow.tsx).
 *
 * Why no auto-mint effect with router.replace on mount:
 *   v1.4.4 had a useEffect that mint+replace'd as soon as the page
 *   mounted with no ?c=. On some user deployments (Next 16 + React 19
 *   + Caddy + Tailscale combinations) that router.replace got stuck
 *   in a perpetually-pending transition, which then blocked every
 *   subsequent router.push() the user triggered — surfacing as
 *   "clicking sidebar does nothing". Deferring the URL update until
 *   first-message-send sidesteps this entirely: by then the user has
 *   already had ample time to navigate elsewhere if they wanted to.
 */
export default function ChatPlaygroundPage() {
    const searchParams = useSearchParams()
    const queryClient = useQueryClient()
    const urlConvId = searchParams?.get("c") ?? null

    // Client-only draft id. Used when URL has no `?c=`. Re-mints on
    // each transition from "real conv" → "no ?c=" so consecutive
    // "New chat" clicks produce distinct fresh drafts. useState lazy
    // init runs exactly once per page mount; the effect below covers
    // subsequent re-mints.
    const [draftId, setDraftId] = React.useState<string>(() => crypto.randomUUID())
    const prevUrlConvIdRef = React.useRef<string | null>(urlConvId)
    React.useEffect(() => {
        const prev = prevUrlConvIdRef.current
        prevUrlConvIdRef.current = urlConvId
        // Only re-mint on actual transitions FROM a real id TO null —
        // not on initial mount (lazy init already minted) and not on
        // null → null (would loop forever).
        if (prev !== null && urlConvId === null) {
            setDraftId(crypto.randomUUID())
        }
    }, [urlConvId])

    const conversationId = urlConvId ?? draftId

    // Pre-seed the messages cache so usePaginatedMessages skips the
    // page-1 fetch — without this a brand-new draft id would 404 on
    // the freshly-spawned XHR.
    //
    // This MUST run during render, not in an effect: effects fire after
    // children mount, and `usePaginatedMessages` snapshots the cache during
    // its own first render. Seeding afterwards was too late, so every chat
    // page load still fired a doomed `/messages?page=1` request and logged a
    // 404 to the console. `useMemo` gives us a render-phase hook; the write
    // is idempotent and never clobbers real data.
    React.useMemo(() => {
        if (urlConvId) return
        const key = conversations.messagesCacheKey(conversationId, INITIAL_PAGE_SIZE)
        if (queryClient.getQueryData<Message[]>(key) === undefined) {
            queryClient.setQueryData<Message[]>(key, [])
        }
    }, [urlConvId, conversationId, queryClient])

    return (
        <div className="h-full flex overflow-hidden bg-background">
            <ConversationSidebar />
            <div className="flex-1 flex flex-col overflow-hidden">
                <MemoizedChatFlow key={conversationId} conversationId={conversationId} />
            </div>
        </div>
    )
}

