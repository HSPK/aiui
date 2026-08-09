import * as React from "react"

interface UseChatScrollOptions {
    messages: any[]
    onLoadMore?: () => void
    hasMore?: boolean
    isLoadingMore?: boolean
}

/**
 * Opening a conversation always lands on the newest message, the way
 * every chat client behaves.
 *
 * There used to be a per-conversation saved scroll offset restored here.
 * It could not work: the restore ran in a layout effect on mount, before
 * the messages query resolved, so the viewport was still one screen tall
 * and `scrollTop = saved` clamped straight to 0. Nothing ran afterwards
 * to correct it, because every scroll-to-bottom path was gated on there
 * being no saved offset. Measured with saved offsets of 300, 1500 and
 * 9000: all three opened the conversation at the very top.
 */
export function useChatScroll({
    messages,
    onLoadMore,
    hasMore = false,
    isLoadingMore = false,
}: UseChatScrollOptions) {
    const viewportRef = React.useRef<HTMLDivElement>(null)
    const currentScrollRef = React.useRef(0)
    const lastMessageIdRef = React.useRef<string | null>(null)
    const shouldAutoScrollRef = React.useRef(true)

    const [showScrollBottom, setShowScrollBottom] = React.useState(false)

    // Land on the newest message as soon as there is anything to land on.
    // Keyed on `messages.length` rather than a one-shot ref: the first
    // page arrives in more than one commit (cache hydration, then the
    // query), and markdown/code blocks keep growing the content after
    // that, so a single early snap would leave the viewport stranded
    // part-way up.
    React.useLayoutEffect(() => {
        const viewport = viewportRef.current
        if (!viewport || messages.length === 0) return
        if (!shouldAutoScrollRef.current) return
        viewport.scrollTop = viewport.scrollHeight
    }, [messages.length])

    // Initialize lastMessageIdRef
    React.useEffect(() => {
        if (messages.length > 0 && !lastMessageIdRef.current) {
            lastMessageIdRef.current = messages[messages.length - 1].id
        }
    }, [messages])

    // Smart auto-scroll for new messages
    React.useEffect(() => {
        const viewport = viewportRef.current
        if (!viewport || messages.length === 0) return

        const lastMsg = messages[messages.length - 1]
        const isNewMessage = lastMsg.id !== lastMessageIdRef.current

        if (isNewMessage) {
            lastMessageIdRef.current = lastMsg.id
            viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' })
            shouldAutoScrollRef.current = true
        } else if (shouldAutoScrollRef.current) {
            viewport.scrollTop = viewport.scrollHeight
        }
    }, [messages])

    const handleScroll = React.useCallback((e: React.UIEvent<HTMLDivElement>) => {
        const target = e.currentTarget
        currentScrollRef.current = target.scrollTop

        // Load more when near top
        if (target.scrollTop < 50 && hasMore && !isLoadingMore && messages.length > 0) {
            onLoadMore?.()
        }

        // Show/hide scroll to bottom button
        const isAtBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 100
        setShowScrollBottom(!isAtBottom)
        shouldAutoScrollRef.current = isAtBottom
    }, [hasMore, isLoadingMore, messages.length, onLoadMore])

    const scrollToBottom = React.useCallback(() => {
        if (viewportRef.current) {
            viewportRef.current.scrollTo({ top: viewportRef.current.scrollHeight, behavior: 'smooth' })
        }
    }, [])

    // Preserve scroll position after loading more messages
    const preserveScrollPosition = React.useCallback((callback: () => void) => {
        const scrollContainer = viewportRef.current
        const oldHeight = scrollContainer?.scrollHeight ?? 0
        const oldTop = scrollContainer?.scrollTop ?? 0

        callback()

        requestAnimationFrame(() => {
            if (scrollContainer) {
                const newHeight = scrollContainer.scrollHeight
                const heightDiff = newHeight - oldHeight
                scrollContainer.scrollTop = heightDiff + oldTop
            }
        })
    }, [])

    return {
        viewportRef,
        showScrollBottom,
        handleScroll,
        scrollToBottom,
        preserveScrollPosition,
    }
}
