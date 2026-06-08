"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
    LayoutDashboard,
    MessageSquare,
    ScrollText,
    Server,
    Settings,
    KeyRound,
    Users,
    LogOut,
    Menu,
    Wrench,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import { useAuth } from "@/context/auth-context"
import { preferences } from "@/lib/api"
import { defaultUserPreferences } from "@/lib/schemas/preferences"

interface NavItem {
    title: string
    href: string
    icon: React.ElementType
}

const primaryNav: NavItem[] = [
    { title: "Dashboard", href: "/", icon: LayoutDashboard },
    { title: "Playground", href: "/playground", icon: MessageSquare },
    { title: "Logs", href: "/logs", icon: ScrollText },
    { title: "Providers", href: "/providers", icon: Server },
    { title: "Tools", href: "/tools", icon: Wrench },
]

interface UserMenuItem extends NavItem {
    adminOnly?: boolean
}

const userMenu: UserMenuItem[] = [
    { title: "Settings", href: "/settings", icon: Settings },
    { title: "API Keys", href: "/settings/api-keys", icon: KeyRound },
    { title: "Users", href: "/settings/users", icon: Users, adminOnly: true },
]

function isActiveHref(pathname: string, href: string): boolean {
    if (href === "/") return pathname === "/"
    return pathname === href || pathname.startsWith(href + "/")
}

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
    const active = isActiveHref(pathname, item.href)
    return (
        <Link
            href={item.href}
            className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors",
                active
                    ? "bg-muted text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            )}
        >
            <item.icon className={cn("h-4 w-4", active ? "text-primary" : "")} />
            <span>{item.title}</span>
        </Link>
    )
}

function MobileNav({ pathname }: { pathname: string }) {
    const [open, setOpen] = React.useState(false)
    React.useEffect(() => {
        setOpen(false)
    }, [pathname])

    return (
        <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="md:hidden h-8 w-8">
                    <Menu className="h-4 w-4" />
                    <span className="sr-only">Open menu</span>
                </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-0">
                <div className="flex flex-col gap-1 p-3">
                    {primaryNav.map((item) => (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={cn(
                                "flex items-center gap-2 rounded-md px-3 py-2 text-sm",
                                isActiveHref(pathname, item.href)
                                    ? "bg-secondary text-secondary-foreground font-medium"
                                    : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                            )}
                        >
                            <item.icon className="h-4 w-4" />
                            {item.title}
                        </Link>
                    ))}
                </div>
            </SheetContent>
        </Sheet>
    )
}

function UserMenu() {
    const router = useRouter()
    const { user, logout } = useAuth()
    const { data: prefsServer } = preferences.useGet()
    const prefs = prefsServer ?? defaultUserPreferences

    const displayName = prefs.user_name?.trim() || "User"
    const avatar = prefs.user_avatar || "👤"

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    className="h-8 gap-2 px-2 text-sm"
                    title={displayName}
                >
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-base">
                        {avatar}
                    </span>
                    <span className="hidden lg:inline max-w-[140px] truncate">
                        {displayName}
                    </span>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{displayName}</span>
                    {user?.role === "admin" && (
                        <span className="shrink-0 rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                            Admin
                        </span>
                    )}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {userMenu
                    .filter((item) => !item.adminOnly || user?.role === "admin")
                    .map((item) => (
                        <DropdownMenuItem
                            key={item.href}
                            onClick={() => router.push(item.href)}
                            className="cursor-pointer"
                        >
                            <item.icon className="h-4 w-4 mr-2" />
                            {item.title}
                        </DropdownMenuItem>
                    ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                    onClick={() => logout()}
                    className="cursor-pointer text-destructive focus:text-destructive"
                >
                    <LogOut className="h-4 w-4 mr-2" />
                    Logout
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}

export function Topbar() {
    const pathname = usePathname()

    return (
        <header className="flex h-12 items-center gap-2 border-b bg-background px-3 md:px-4 shrink-0">
            <MobileNav pathname={pathname} />
            <nav className="hidden md:flex items-center gap-1">
                {primaryNav.map((item) => (
                    <NavLink key={item.href} item={item} pathname={pathname} />
                ))}
            </nav>
            <div className="ml-auto flex items-center gap-2">
                <UserMenu />
            </div>
        </header>
    )
}
