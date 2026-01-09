"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import {
    LayoutDashboard,
    MessageSquare,
    PanelLeftClose,
    PanelLeft,
    ScrollText,
    Server,
    Settings,
} from "lucide-react"
import { Button } from "@/components/ui/button"

import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip"

const sidebarItems = [
    {
        title: "Dashboard",
        href: "/",
        icon: LayoutDashboard,
    },
    {
        title: "Playground",
        href: "/chat",
        icon: MessageSquare,
    },
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
    {
        title: "Settings",
        href: "/settings",
        icon: Settings,
    },
]

export function Sidebar({
    className,
    collapsed = false,
    onToggle
}: {
    className?: string,
    collapsed?: boolean,
    onToggle?: () => void
}) {
    const pathname = usePathname()

    return (
        <div className={cn("flex h-full flex-col bg-background", className)}>
            <div className={cn("flex h-14 items-center border-b", collapsed ? "justify-center px-2" : "justify-between px-4 lg:px-6")}>
                {!collapsed && <span className="text-lg font-bold truncate">AIUI Gateway</span>}
                {onToggle && (
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={onToggle}
                        className="h-8 w-8 text-muted-foreground hover:text-foreground hidden md:flex"
                        title={collapsed ? "Expand Sidebar" : "Collapse Sidebar"}
                    >
                        {collapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
                    </Button>
                )}
            </div>
            <div className="flex-1 overflow-auto py-4">
                <nav className="grid gap-1 px-2 group-[[data-collapsed=true]]:justify-center group-[[data-collapsed=true]]:px-2">
                    {sidebarItems.map((item, index) => {
                        const isActive = pathname === item.href

                        return (
                            <TooltipProvider key={index} disableHoverableContent>
                                <Tooltip delayDuration={0}>
                                    <TooltipTrigger asChild>
                                        <Link href={item.href}>
                                            <Button
                                                variant={isActive ? "secondary" : "ghost"}
                                                className={cn(
                                                    "w-full justify-start h-10 mb-1 overflow-hidden transition-all duration-300",
                                                    collapsed ? "px-2" : "px-4",
                                                    isActive && "bg-secondary"
                                                )}
                                            >
                                                <item.icon className={cn("h-4 w-4 shrink-0 transition-all duration-300", collapsed ? "mr-0" : "mr-2")} />
                                                <span
                                                    className={cn(
                                                        "truncate transition-all duration-300",
                                                        collapsed ? "max-w-0 opacity-0 -translate-x-4" : "max-w-[200px] opacity-100 translate-x-0"
                                                    )}
                                                >
                                                    {item.title}
                                                </span>
                                            </Button>
                                        </Link>
                                    </TooltipTrigger>
                                    {collapsed && <TooltipContent side="right" className="flex items-center gap-4">
                                        {item.title}
                                    </TooltipContent>}
                                </Tooltip>
                            </TooltipProvider>
                        )
                    })}
                </nav>
            </div>
        </div>
    )
}
