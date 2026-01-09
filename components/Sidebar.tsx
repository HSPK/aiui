"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import {
    LayoutDashboard,
    MessageSquare,
    ScrollText,
    Server,
    Settings,
} from "lucide-react"
import { Button } from "@/components/ui/button"

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

export function Sidebar() {
    const pathname = usePathname()

    return (
        <div className="flex h-full w-64 flex-col border-r bg-background">
            <div className="flex h-14 items-center border-b px-6">
                <span className="text-lg font-bold">AIUI Gateway</span>
            </div>
            <div className="flex-1 overflow-auto py-4">
                <nav className="grid gap-1 px-2">
                    {sidebarItems.map((item, index) => (
                        <Link
                            key={index}
                            href={item.href}
                        >
                            <Button
                                variant={pathname === item.href ? "secondary" : "ghost"}
                                className={cn(
                                    "w-full justify-start gap-4",
                                    pathname === item.href && "bg-secondary"
                                )}
                            >
                                <item.icon className="h-4 w-4" />
                                {item.title}
                            </Button>
                        </Link>
                    ))}
                </nav>
            </div>
        </div>
    )
}
