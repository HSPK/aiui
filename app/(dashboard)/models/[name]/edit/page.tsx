"use client"

import { useParams, useRouter, useSearchParams } from "next/navigation"
import { ChevronLeft } from "lucide-react"
import * as React from "react"

import { models } from "@/lib/api"
import { useAuth } from "@/context/auth-context"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { ModelForm } from "@/components/providers/model-form"

export default function EditModelPage() {
    const router = useRouter()
    const params = useParams()
    const searchParams = useSearchParams()
    const { user } = useAuth()
    const modelName = decodeURIComponent(String(params.name ?? ""))
    const backHref = searchParams.get("from") ?? `/models/${encodeURIComponent(modelName)}`

    const { data: model, isLoading } = models.useGet(modelName)

    React.useEffect(() => {
        if (user && user.role !== "admin") router.replace(`/models/${encodeURIComponent(modelName)}`)
    }, [user, router, modelName])

    if (!user || user.role !== "admin") return null

    // Discovered rows have no DB id → editing means creating an override
    // pre-filled with the discovered defaults.
    const mode = model?.is_discovered ? "create" : "edit"

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
                        {isLoading || !model ? (
                            <div className="space-y-3">
                                <Skeleton className="h-4 w-40" />
                                <Skeleton className="h-9 w-full" />
                                <Skeleton className="h-9 w-full" />
                                <Skeleton className="h-24 w-full" />
                            </div>
                        ) : (
                            <ModelForm
                                mode={mode}
                                model={model}
                                cancelHref={backHref}
                            />
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
