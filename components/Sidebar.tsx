"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import {
    LayoutDashboard,
    MessageSquare,
    PanelLeftClose,
    PanelLeft,
    ScrollText,
    Server,
    Settings,
    ChevronRight,
    Zap,
    Plus,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip"
import { SidebarHistory } from "@/components/playground/sidebar-history"
import { usePlaygroundStore } from "@/lib/stores/playground-store"

// Navigation structure
const mainNavItems = [
    {
        title: "Dashboard",
        href: "/",
        icon: LayoutDashboard,
    },
    {
        title: "Playground",
        href: "/chat",
        icon: MessageSquare,
        expandable: true,
    },
]

const toolNavItems = [
    {
        title: "Logs & Tracing",
        href: "/logs",
        icon: ScrollText,
    },
    {
        title: "Providers",
        href: "/providers",
        icon: Server,
    },
]

const bottomNavItems = [
    {
        title: "Settings",
        href: "/settings",
        icon: Settings,
    },
]

// Reusable NavItem component
function NavItem({
    item,
    isActive,
    collapsed,
    expandable,
    isExpanded,
    onToggleExpand,
    showNewButton,
    onNewClick,
}: {
    item: { title: string; href: string; icon: React.ElementType }
    isActive: boolean
    collapsed: boolean
    expandable?: boolean
    isExpanded?: boolean
    onToggleExpand?: () => void
    showNewButton?: boolean
    onNewClick?: () => void
}) {
    return (
        <TooltipProvider disableHoverableContent>
            <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                    <Link href={item.href}>
                        <Button
                            variant={isActive ? "secondary" : "ghost"}
                            className={cn(
                                "w-full justify-start h-9 overflow-hidden transition-all duration-200 relative group/item",
                                collapsed ? "px-2.5" : "px-3",
                                isActive && "bg-secondary font-medium"
                            )}
                        >
                            <item.icon className={cn(
                                "h-4 w-4 shrink-0 transition-all duration-200",
                                collapsed ? "mr-0" : "mr-2.5",
                                isActive ? "text-foreground" : "text-muted-foreground"
                            )} />
                            <span className={cn(
                                "truncate transition-all duration-200 flex-1 text-left",
                                collapsed ? "w-0 opacity-0" : "opacity-100"
                            )}>
                                {item.title}
                            </span>
                            {!collapsed && expandable && (
                                <div
                                    role="button"
                                    className="p-1 hover:bg-black/10 dark:hover:bg-white/10 rounded-sm transition-colors opacity-0 group-hover/item:opacity-100"
                                    onClick={(e) => {
                                        e.preventDefault()
                                        e.stopPropagation()
                                        onToggleExpand?.()
                                    }}
                                >
                                    <ChevronRight className={cn(
                                        "h-3 w-3 transition-transform duration-200",
                                        isExpanded && "rotate-90"
                                    )} />
                                </div>
                            )}
                            {!collapsed && showNewButton && (
                                <div
                                    role="button"
                                    className="p-1 hover:bg-primary/10 rounded-sm transition-colors opacity-0 group-hover/item:opacity-100"
                                    onClick={(e) => {
                                        e.preventDefault()
                                        e.stopPropagation()
                                        onNewClick?.()
                                    }}
                                    title="New Chat"
                                >
                                    <Plus className="h-3 w-3 text-primary" />
                                </div>
                            )}
                        </Button>
                    </Link>
                </TooltipTrigger>
                {collapsed && (
                    <TooltipContent side="right" className="flex items-center gap-2">
                        {item.title}
                    </TooltipContent>
                )}
            </Tooltip>
        </TooltipProvider>
    )
}

export function Sidebar({
    className,
    collapsed = false,
    onToggle
}: {
    className?: string
    collapsed?: boolean
    onToggle?: () => void
}) {
    const pathname = usePathname()
    const router = useRouter()
    const [isPlaygroundExpanded, setIsPlaygroundExpanded] = useState(true)
    const { addTab } = usePlaygroundStore()

    // Auto-expand playground section when on /chat
    useEffect(() => {
        if (pathname === "/chat" || pathname.startsWith("/chat/")) {
            setIsPlaygroundExpanded(true)
        }
    }, [pathname])

    const handleNewChat = () => {
        addTab({ type: "chat", title: "New Chat" })
        router.push("/chat")
    }

    return (
        <div className={cn("flex h-full flex-col bg-background", className)}>
            {/* Header with Logo */}
            <div className={cn(
                "flex h-14 items-center border-b shrink-0",
                collapsed ? "justify-center px-2" : "justify-between px-4"
            )}>
                {collapsed ? (
                    <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-primary/20 to-primary/5">
                        <Zap className="h-4 w-4 text-primary" />
                    </div>
                ) : (
                    <div className="flex items-center gap-2.5">
                        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-primary/20 to-primary/5">
                            <Zap className="h-4 w-4 text-primary" />
                        </div>
                        <span className="text-lg font-semibold tracking-tight">Gateway</span>
                    </div>
                )}
                {onToggle && !collapsed && (
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={onToggle}
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        title="Collapse Sidebar"
                    >
                        <PanelLeftClose className="h-4 w-4" />
                    </Button>
                )}
            </div>

            {/* Main Navigation */}
            <div className="flex-1 overflow-y-auto py-3">
                <nav className="space-y-1 px-2">
                    {/* Main section */}
                    {mainNavItems.map((item) => {
                        const isActive = pathname === item.href ||
                            (item.href !== "/" && pathname.startsWith(item.href))

                        return (
                            <div key={item.href}>
                                <NavItem
                                    item={item}
                                    isActive={isActive}
                                    collapsed={collapsed}
                                    expandable={item.expandable}
                                    isExpanded={isPlaygroundExpanded}
                                    onToggleExpand={() => setIsPlaygroundExpanded(!isPlaygroundExpanded)}
                                    showNewButton={item.expandable}
                                    onNewClick={handleNewChat}
                                />

                                {/* Expandable history section */}
                                {item.expandable && !collapsed && (
                                    <div className={cn(
                                        "grid transition-all duration-200 ease-in-out",
                                        isPlaygroundExpanded
                                            ? "grid-rows-[1fr] opacity-100"
                                            : "grid-rows-[0fr] opacity-0"
                                    )}>
                                        <div className="overflow-hidden">
                                            <SidebarHistory />
                                        </div>
                                    </div>
                                )}
                            </div>
                        )
                    })}

                    {/* Divider */}
                    {!collapsed && (
                        <div className="my-3 mx-3 border-t" />
                    )}

                    {/* Tools section header */}
                    {!collapsed && (
                        <div className="px-3 mb-1">
                            <span className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider">
                                Tools
                            </span>
                        </div>
                    )}

                    {/* Tool items */}
                    {toolNavItems.map((item) => {
                        const isActive = pathname === item.href ||
                            (item.href !== "/" && pathname.startsWith(item.href))
                        return (
                            <NavItem
                                key={item.href}
                                item={item}
                                isActive={isActive}
                                collapsed={collapsed}
                            />
                        )
                    })}
                </nav>
            </div>

            {/* Bottom section */}
            <div className="border-t p-2 shrink-0">
                {bottomNavItems.map((item) => {
                    const isActive = pathname === item.href
                    return (
                        <NavItem
                            key={item.href}
                            item={item}
                            isActive={isActive}
                            collapsed={collapsed}
                        />
                    )
                })}

                {/* Expand button when collapsed */}
                {onToggle && collapsed && (
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={onToggle}
                        className="w-full h-9 mt-1 text-muted-foreground hover:text-foreground"
                        title="Expand Sidebar"
                    >
                        <PanelLeft className="h-4 w-4" />
                    </Button>
                )}
            </div>
        </div>
    )
}
