import * as React from "react"
import { Topbar } from "@/components/Topbar"
import { AutoHealthChecks } from "@/components/AutoHealthChecks"

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <div className="flex h-screen flex-col overflow-hidden bg-background">
            <Topbar />
            <main className="flex-1 overflow-hidden bg-muted/10">
                {children}
            </main>
            <AutoHealthChecks />
        </div>
    )
}
