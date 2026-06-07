"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { ChevronLeft } from "lucide-react"
import * as React from "react"

import { useAuth } from "@/context/auth-context"
import { Card, CardContent } from "@/components/ui/card"
import { ModelForm } from "@/components/providers/model-form"

export default function NewModelPage() {
    const router = useRouter()
    const { user } = useAuth()
    const searchParams = useSearchParams()
    const providerId = searchParams.get("provider_id") ?? undefined
    const backHref = searchParams.get("from") ?? "/providers"

    React.useEffect(() => {
        if (user && user.role !== "admin") router.replace("/providers")
    }, [user, router])

    if (!user || user.role !== "admin") return null

    return (
        <div className="h-full overflow-y-auto">
            <div className="mx-auto w-full max-w-3xl space-y-4 p-4 md:p-6">
                <button
                    type="button"
                    onClick={() => router.push(backHref)}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                    <ChevronLeft className="h-3 w-3" />
                    Back
                </button>
                <Card>
                    <CardContent className="p-4 md:p-6">
                        <ModelForm
                            mode="create"
                            defaultProviderId={providerId}
                            cancelHref={backHref}
                        />
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
