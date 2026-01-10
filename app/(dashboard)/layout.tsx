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
                <header className="flex h-14 items-center gap-4 border-b bg-muted/40 px-6 justify-between">
                    <div className="flex items-center gap-2">
                        <div className="md:hidden">
                            <Sheet>
                                <SheetTrigger asChild>
                                    <Button variant="ghost" size="icon">
                                        <Menu className="h-5 w-5" />
                                        <span className="sr-only">Toggle navigation menu</span>
                                    </Button>
                                </SheetTrigger>
                                <SheetContent side="left" className="p-0 w-64">
                                    <Sidebar />
                                </SheetContent>
                            </Sheet>
                        </div>

                        <div className="font-semibold">Console</div>
                    </div>
                    <div className="text-sm text-muted-foreground">user@example.com</div>
                </header>
                <main className="flex-1 overflow-y-auto bg-muted/10 p-4">
                    {children}
                </main>
            </div>
        </div>
    )
}
