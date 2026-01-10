import * as React from "react"

interface UseChatScrollOptions {
    messages: any[]
    onLoadMore?: () => void
    hasMore?: boolean
    isLoadingMore?: boolean
    savedScrollPosition?: number
    onSaveScrollPosition?: (position: number) => void
}

export function useChatScroll({
    messages,
    onLoadMore,
    hasMore = false,
    isLoadingMore = false,
    savedScrollPosition,
    onSaveScrollPosition,
}: UseChatScrollOptions) {
    const viewportRef = React.useRef<HTMLDivElement>(null)
    const currentScrollRef = React.useRef(0)
    const lastMessageIdRef = React.useRef<string | null>(null)
    const hasScrolledToBottomRef = React.useRef(false)
    const shouldAutoScrollRef = React.useRef(true)

    const [showScrollBottom, setShowScrollBottom] = React.useState(false)

    // Save scroll position on unmount
    const saveScrollRef = React.useRef<() => void>(() => { })

    React.useLayoutEffect(() => {
        saveScrollRef.current = () => {
            if (currentScrollRef.current > 0 && onSaveScrollPosition) {
                onSaveScrollPosition(currentScrollRef.current)
            }
        }
    })

    React.useEffect(() => {
        return () => {
            saveScrollRef.current()
        }
    }, [])

    // Restore scroll position or scroll to bottom on mount
    React.useLayoutEffect(() => {
        const viewport = viewportRef.current
        if (!viewport) return

        if (typeof savedScrollPosition === 'number') {
            viewport.scrollTop = savedScrollPosition
        } else if (messages.length > 0) {
            viewport.scrollTop = viewport.scrollHeight
        }
    }, [savedScrollPosition])

    // Initial scroll to bottom when messages first appear
    React.useEffect(() => {
        if (typeof savedScrollPosition !== 'number' && !hasScrolledToBottomRef.current && messages.length > 0) {
            if (viewportRef.current) {
                viewportRef.current.scrollTop = viewportRef.current.scrollHeight
                hasScrolledToBottomRef.current = true
            }
        }
    }, [messages.length, savedScrollPosition])

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
