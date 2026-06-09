"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
    LayoutDashboard,
    MessageSquare,
    PanelLeft,
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
import { preferences } from "@/lib/api/preferences"
import { defaultUserPreferences } from "@/lib/schemas/preferences"
import { MODALITIES, modalityFromPath } from "@/components/playground/modalities"
import { TopbarModalityStrip } from "@/components/playground/topbar-modality-strip"
import { entryPath, useModalityStore } from "@/lib/stores/modality-store"

interface NavItem {
    title: string
    href: string
    icon: React.ElementType
}

const dashboardItem: NavItem = { title: "Dashboard", href: "/", icon: LayoutDashboard }

/** Trailing primary nav after the Playground slot. Kept compact so
 *  the topbar fits a 1280-wide desktop even with the inline modality
 *  strip expanded. */
const trailingNav: NavItem[] = [
    { title: "Logs", href: "/logs", icon: ScrollText },
    { title: "Providers", href: "/providers", icon: Server },
    { title: "MCP", href: "/mcp", icon: Wrench },
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

/** Single-row nav button: icon + label on lg, icon-only on md to keep
 *  the bar lean on smaller desktops. */
function NavLink({ item, pathname, iconOnly }: { item: NavItem; pathname: string; iconOnly?: boolean }) {
    const active = isActiveHref(pathname, item.href)
    return (
        <Link
            href={item.href}
            className={cn(
                "inline-flex items-center gap-1.5 rounded-md h-7 px-2 text-xs transition-colors",
                active
                    ? "bg-muted text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
            )}
            title={iconOnly ? item.title : undefined}
            aria-label={iconOnly ? item.title : undefined}
        >
            <item.icon className={cn("h-3.5 w-3.5", active ? "text-primary" : "")} />
            {!iconOnly && <span>{item.title}</span>}
        </Link>
    )
}

/** Playground slot: inside `/playground/*` it's the inline modality
 *  strip (1-click switching, no second row). Elsewhere it's a plain
 *  link that resumes the last-visited modality URL. */
function PlaygroundSlot({ pathname, iconOnly }: { pathname: string; iconOnly: boolean }) {
    const lastPath = useModalityStore((s) => s.lastPath)
    const insidePlayground = isActiveHref(pathname, "/playground")

    if (insidePlayground && pathname !== "/playground") {
        return <TopbarModalityStrip />
    }

    const item: NavItem = { title: "Playground", href: entryPath(lastPath), icon: MessageSquare }
    const active = insidePlayground
    return (
        <Link
            href={item.href}
            title={lastPath ? `Resume ${lastPath}` : item.title}
            aria-label={iconOnly ? item.title : undefined}
            className={cn(
                "inline-flex items-center gap-1.5 rounded-md h-7 px-2 text-xs transition-colors",
                active
                    ? "bg-muted text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
            )}
        >
            <item.icon className={cn("h-3.5 w-3.5", active ? "text-primary" : "")} />
            {!iconOnly && <span>{item.title}</span>}
        </Link>
    )
}

function MobileNav({ pathname }: { pathname: string }) {
    const [open, setOpen] = React.useState(false)
    const lastPath = useModalityStore((s) => s.lastPath)
    React.useEffect(() => {
        setOpen(false)
    }, [pathname])

    return (
        <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="md:hidden h-10 w-10 -ml-1">
                    <Menu className="size-5" />
                    <span className="sr-only">Open menu</span>
                </Button>
            </SheetTrigger>
            <SheetContent side="left" hideClose className="w-72 max-w-[85vw] p-0">
                <div className="flex flex-col gap-0.5 p-3">
                    <Link
                        href="/"
                        className={cn(
                            "flex items-center gap-3 rounded-md px-3 h-11 text-base",
                            pathname === "/"
                                ? "bg-secondary text-secondary-foreground font-medium"
                                : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
                        )}
                    >
                        <LayoutDashboard className="size-5" /> Dashboard
                    </Link>
                    <Link
                        href={entryPath(lastPath)}
                        className={cn(
                            "flex items-center gap-3 rounded-md px-3 h-11 text-base",
                            isActiveHref(pathname, "/playground")
                                ? "bg-secondary text-secondary-foreground font-medium"
                                : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
                        )}
                    >
                        <MessageSquare className="size-5" /> Playground
                    </Link>
                    <div className="pl-8 flex flex-col gap-0.5">
                        {MODALITIES.filter((m) => !m.disabled).map((m) => {
                            const Icon = m.icon
                            const active = isActiveHref(pathname, m.href)
                            return (
                                <Link
                                    key={m.id}
                                    href={m.href}
                                    className={cn(
                                        "flex items-center gap-2.5 rounded-md px-3 h-10 text-sm",
                                        active
                                            ? "text-foreground font-medium bg-muted/60"
                                            : "text-muted-foreground hover:text-foreground hover:bg-muted/40",
                                    )}
                                >
                                    <Icon className="size-4" /> {m.title}
                                </Link>
                            )
                        })}
                    </div>
                    {trailingNav.map((item) => (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={cn(
                                "flex items-center gap-3 rounded-md px-3 h-11 text-base",
                                isActiveHref(pathname, item.href)
                                    ? "bg-secondary text-secondary-foreground font-medium"
                                    : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                            )}
                        >
                            <item.icon className="size-5" />
                            {item.title}
                        </Link>
                    ))}
                </div>
            </SheetContent>
        </Sheet>
    )
}

/** Mobile-only title chip — shows the current section so the slim
 *  topbar still has wayfinding info when the nav is collapsed into
 *  a hamburger. */
function MobileTitle({ pathname }: { pathname: string }) {
    let title = "Dashboard"
    if (pathname === "/") title = "Dashboard"
    else if (pathname.startsWith("/playground")) {
        const m = modalityFromPath(pathname)
        title = m ? m.title : "Playground"
    } else if (pathname.startsWith("/logs")) title = "Logs"
    else if (pathname.startsWith("/providers")) title = "Providers"
    else if (pathname.startsWith("/mcp")) title = "MCP"
    else if (pathname.startsWith("/settings")) title = "Settings"
    else if (pathname.startsWith("/models")) title = "Models"

    return (
        <span className="md:hidden text-base font-medium text-foreground truncate min-w-0">
            {title}
        </span>
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
                    className="h-10 md:h-7 gap-1.5 px-1.5 text-xs"
                    title={displayName}
                >
                    <span className="flex h-8 w-8 md:h-6 md:w-6 items-center justify-center rounded-full bg-muted text-base md:text-sm">
                        {avatar}
                    </span>
                    <span className="hidden xl:inline max-w-[140px] truncate">
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
                            className="cursor-pointer h-10 md:h-9"
                        >
                            <item.icon className="h-4 w-4 mr-2" />
                            {item.title}
                        </DropdownMenuItem>
                    ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                    onClick={() => logout()}
                    className="cursor-pointer h-10 md:h-9 text-destructive focus:text-destructive"
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
    const iconOnly = false

    return (
        <header className="flex h-12 md:h-10 items-center gap-1.5 border-b bg-background px-3 md:px-3 shrink-0">
            <MobileNav pathname={pathname} />
            <MobileChatHistoryTrigger pathname={pathname} />
            <MobileTitle pathname={pathname} />
            <nav className="hidden md:flex items-center gap-0.5 min-w-0 flex-1">
                <NavLink item={dashboardItem} pathname={pathname} iconOnly={iconOnly} />
                <PlaygroundSlot pathname={pathname} iconOnly={iconOnly} />
                {trailingNav.map((item) => (
                    <NavLink key={item.href} item={item} pathname={pathname} iconOnly={iconOnly} />
                ))}
            </nav>
            <div className="ml-auto md:ml-0 flex items-center gap-2 shrink-0">
                <UserMenu />
            </div>
        </header>
    )
}

/** Mobile-only contextual button. On the chat page, shows a "history"
 *  icon grouped with the hamburger that opens the conversation Sheet.
 *  Uses the same ghost styling + size as the hamburger so the pair
 *  reads as one icon row, not a stray contextual control. */
function MobileChatHistoryTrigger({ pathname }: { pathname: string }) {
    const setOpen = useModalityStore((s) => s.setChatHistoryOpen)
    if (!pathname.startsWith("/playground/chat")) return null
    return (
        <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setOpen(true)}
            aria-label="Open conversations"
            className="md:hidden h-10 w-10"
        >
            <PanelLeft className="size-5" />
        </Button>
    )
}
