"use client"

import * as React from "react"
import { usePlaygroundStore, PlaygroundTab } from "@/lib/stores/playground-store"
import { ChatFlow } from "@/components/playground/chat-flow"
import { PlaygroundHome } from "@/components/playground/playground-home"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Plus, X, MessageSquare, ChevronLeft, ChevronRight, MoreHorizontal, XCircle, Layers, Trash2, GripVertical } from "lucide-react"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useShallow } from "zustand/react/shallow"

// Memoize TabHeader to prevent re-renders
const TabHeader = React.memo(function TabHeader({
    tab,
    isActive,
    onClick,
    onClose,
    onCloseOthers,
    onCloseAll,
    onDragStart,
    onDragOver,
    onDragEnd,
    onDrop,
    isDragging,
    isDragOver
}: {
    tab: PlaygroundTab
    isActive: boolean
    onClick: () => void
    onClose: (e: React.MouseEvent) => void
    onCloseOthers: () => void
    onCloseAll: () => void
    onDragStart: (e: React.DragEvent) => void
    onDragOver: (e: React.DragEvent) => void
    onDragEnd: (e: React.DragEvent) => void
    onDrop: (e: React.DragEvent) => void
    isDragging: boolean
    isDragOver: boolean
}) {
    const [dropdownOpen, setDropdownOpen] = React.useState(false)

    return (
        <div
            draggable
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDragEnd={onDragEnd}
            onDrop={onDrop}
            onClick={onClick}
            onContextMenu={(e) => {
                e.preventDefault()
                setDropdownOpen(true)
            }}
            className={cn(
                "group flex items-center gap-1.5 px-2 py-1.5 text-sm cursor-pointer select-none transition-all rounded-t-lg mx-0.5 h-[36px] shrink-0",
                isActive
                    ? "bg-background text-foreground shadow-sm border border-b-0 border-border/50"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                isDragging && "opacity-50",
                isDragOver && "border-l-2 border-l-primary"
            )}
        >
            <GripVertical className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-50 cursor-grab active:cursor-grabbing" />
            <MessageSquare className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate max-w-[100px] text-xs font-medium">{tab.title}</span>

            {/* Dropdown Menu */}
            <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
                <DropdownMenuTrigger asChild>
                    <div
                        role="button"
                        onClick={(e) => e.stopPropagation()}
                        className={cn(
                            "p-0.5 rounded-sm hover:bg-black/10 dark:hover:bg-white/10 transition-all shrink-0",
                            dropdownOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                            isActive && !dropdownOpen && "opacity-60"
                        )}
                    >
                        <MoreHorizontal className="h-3 w-3" />
                    </div>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-44">
                    <DropdownMenuItem
                        onClick={(e) => {
                            e.stopPropagation()
                            onClose(e as unknown as React.MouseEvent)
                        }}
                        className="text-xs"
                    >
                        <X className="h-3.5 w-3.5 mr-2" />
                        Close Tab
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        onClick={(e) => {
                            e.stopPropagation()
                            onCloseOthers()
                        }}
                        className="text-xs"
                    >
                        <Layers className="h-3.5 w-3.5 mr-2" />
                        Close Other Tabs
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                        onClick={(e) => {
                            e.stopPropagation()
                            onCloseAll()
                        }}
                        className="text-xs text-destructive focus:text-destructive"
                    >
                        <Trash2 className="h-3.5 w-3.5 mr-2" />
                        Close All Tabs
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>

            {/* Close button */}
            <div
                role="button"
                onClick={onClose}
                className={cn(
                    "opacity-0 group-hover:opacity-100 p-0.5 rounded-sm hover:bg-destructive/10 hover:text-destructive transition-all shrink-0",
                    isActive && "opacity-60 hover:opacity-100"
                )}
            >
                <X className="h-3 w-3" />
            </div>
        </div>
    )
})

// Memoize ChatFlow wrapper to prevent unnecessary re-mounts
const MemoizedChatFlow = React.memo(ChatFlow)
const MemoizedPlaygroundHome = React.memo(PlaygroundHome)

export default function PlaygroundPage() {
    // Use selectors for better performance - only re-render when specific values change
    const tabs = usePlaygroundStore(useShallow((state) => state.tabs))
    const activeTabId = usePlaygroundStore((state) => state.activeTabId)
    const setActiveTab = usePlaygroundStore((state) => state.setActiveTab)
    const removeTab = usePlaygroundStore((state) => state.removeTab)
    const addTab = usePlaygroundStore((state) => state.addTab)
    const closeOtherTabs = usePlaygroundStore((state) => state.closeOtherTabs)
    const closeAllTabs = usePlaygroundStore((state) => state.closeAllTabs)
    const reorderTabs = usePlaygroundStore((state) => state.reorderTabs)

    const tabsContainerRef = React.useRef<HTMLDivElement>(null)
    const [showLeftArrow, setShowLeftArrow] = React.useState(false)
    const [showRightArrow, setShowRightArrow] = React.useState(false)
    const [draggedIndex, setDraggedIndex] = React.useState<number | null>(null)
    const [dragOverIndex, setDragOverIndex] = React.useState<number | null>(null)

    const checkScrollArrows = React.useCallback(() => {
        const container = tabsContainerRef.current
        if (!container) return

        setShowLeftArrow(container.scrollLeft > 0)
        setShowRightArrow(
            container.scrollLeft < container.scrollWidth - container.clientWidth - 1
        )
    }, [])

    React.useEffect(() => {
        checkScrollArrows()
        window.addEventListener('resize', checkScrollArrows)
        return () => window.removeEventListener('resize', checkScrollArrows)
    }, [checkScrollArrows, tabs.length])

    const scrollTabs = (direction: 'left' | 'right') => {
        const container = tabsContainerRef.current
        if (!container) return

        const scrollAmount = 200
        container.scrollBy({
            left: direction === 'left' ? -scrollAmount : scrollAmount,
            behavior: 'smooth'
        })
    }

    const handleDragStart = React.useCallback((index: number) => (e: React.DragEvent) => {
        setDraggedIndex(index)
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', String(index))
    }, [])

    const handleDragOver = React.useCallback((index: number) => (e: React.DragEvent) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        if (draggedIndex !== null && draggedIndex !== index) {
            setDragOverIndex(index)
        }
    }, [draggedIndex])

    const handleDragEnd = React.useCallback(() => {
        setDraggedIndex(null)
        setDragOverIndex(null)
    }, [])

    const handleDrop = React.useCallback((toIndex: number) => (e: React.DragEvent) => {
        e.preventDefault()
        if (draggedIndex !== null && draggedIndex !== toIndex) {
            reorderTabs(draggedIndex, toIndex)
        }
        setDraggedIndex(null)
        setDragOverIndex(null)
    }, [draggedIndex, reorderTabs])

    return (
        <div className="h-full flex overflow-hidden bg-background">
            <div className="flex-1 flex flex-col h-full overflow-hidden">
                {/* Tabs Bar */}
                <div className="flex items-end bg-muted/30 border-b flex-none relative">
                    {/* Left scroll arrow */}
                    {showLeftArrow && (
                        <button
                            onClick={() => scrollTabs('left')}
                            className="absolute left-0 top-0 bottom-0 z-10 px-1 bg-gradient-to-r from-muted/80 to-transparent hover:from-muted flex items-center"
                        >
                            <ChevronLeft className="h-4 w-4 text-muted-foreground" />
                        </button>
                    )}

                    {/* Tabs container */}
                    <div
                        ref={tabsContainerRef}
                        onScroll={checkScrollArrows}
                        className="flex-1 flex overflow-x-auto scrollbar-none items-end pt-1.5 px-1"
                        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                    >
                        {tabs.map((tab, index) => (
                            <TabHeader
                                key={tab.id}
                                tab={tab}
                                isActive={tab.id === activeTabId}
                                onClick={() => setActiveTab(tab.id)}
                                onClose={(e) => {
                                    e.stopPropagation()
                                    removeTab(tab.id)
                                }}
                                onCloseOthers={() => closeOtherTabs(tab.id)}
                                onCloseAll={closeAllTabs}
                                onDragStart={handleDragStart(index)}
                                onDragOver={handleDragOver(index)}
                                onDragEnd={handleDragEnd}
                                onDrop={handleDrop(index)}
                                isDragging={draggedIndex === index}
                                isDragOver={dragOverIndex === index}
                            />
                        ))}
                    </div>

                    {/* Right scroll arrow */}
                    {showRightArrow && (
                        <button
                            onClick={() => scrollTabs('right')}
                            className="absolute right-10 top-0 bottom-0 z-10 px-1 bg-gradient-to-l from-muted/80 to-transparent hover:from-muted flex items-center"
                        >
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </button>
                    )}

                    {/* Add tab button */}
                    <div className="px-2 py-1 flex-none flex items-center">
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                            onClick={() => addTab()}
                        >
                            <Plus className="h-4 w-4" />
                        </Button>
                    </div>
                </div>

                {/* Main Content Area - Keep all tabs mounted but hidden */}
                <div className="flex-1 flex overflow-hidden relative">
                    {tabs.length === 0 ? (
                        <MemoizedPlaygroundHome />
                    ) : (
                        tabs.map(tab => (
                            <div
                                key={tab.id}
                                className={cn(
                                    "absolute inset-0 flex flex-col bg-background",
                                    tab.id === activeTabId
                                        ? "opacity-100 z-10 pointer-events-auto"
                                        : "opacity-0 z-0 pointer-events-none"
                                )}
                            >
                                {tab.type === 'chat' && (
                                    <MemoizedChatFlow tabId={tab.id} />
                                )}
                                {tab.type === 'new' && (
                                    <MemoizedPlaygroundHome tabId={tab.id} />
                                )}
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    )
}
