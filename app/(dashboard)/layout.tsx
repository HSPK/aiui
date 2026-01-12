"use client"

import * as React from "react"
import { Sidebar } from "@/components/Sidebar"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Menu, PanelLeft } from "lucide-react"

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const [isCollapsed, setIsCollapsed] = React.useState(false)

    return (
        <div className="flex h-screen overflow-hidden bg-background">
            <div className={`hidden md:flex h-full flex-col border-r bg-background shrink-0 transition-all duration-300 ease-in-out ${isCollapsed ? 'w-16' : 'w-64'}`}>
                <Sidebar
                    collapsed={isCollapsed}
                    onToggle={() => setIsCollapsed(!isCollapsed)}
                />
            </div>

            <div className="flex flex-1 flex-col overflow-hidden transition-all duration-300 ease-in-out">
                {/* Compact mobile header with dynamic title, search, and user settings */}
                <header className="flex h-11 items-center gap-2 border-b bg-muted/40 px-3 justify-between md:hidden">
                    <div className="flex items-center gap-1">
                        <Sheet>
                            <SheetTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                    <Menu className="h-4 w-4" />
                                    <span className="sr-only">Toggle navigation menu</span>
                                </Button>
                            </SheetTrigger>
                            <SheetContent side="left" className="p-0 w-64">
                                <Sidebar />
                            </SheetContent>
                        </Sheet>
                        {/* App Logo and Name */}
                        <div className="flex items-center gap-1.5">
                            <div className="flex items-center justify-center w-6 h-6 rounded-md bg-gradient-to-br from-primary/20 to-primary/5">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                            </div>
                            <span className="font-semibold text-sm">Gateway</span>
                        </div>
                    </div>
                    <div className="flex items-center gap-1">
                        {/* Search icon (UI only) */}
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                            <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4 text-muted-foreground"><circle cx="9" cy="9" r="7" stroke="currentColor" strokeWidth="2" /><path d="M15 15L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                            <span className="sr-only">Search</span>
                        </Button>
                        {/* User settings icon (UI only) */}
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                            <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4 text-muted-foreground"><circle cx="10" cy="7" r="3" stroke="currentColor" strokeWidth="2" /><path d="M3 17c0-2.21 3.134-4 7-4s7 1.79 7 4" stroke="currentColor" strokeWidth="2" /></svg>
                            <span className="sr-only">User settings</span>
                        </Button>
                    </div>
                </header>
                <main className="flex-1 overflow-hidden bg-muted/10">
                    {children}
                </main>
            </div>
        </div>
    )
}
