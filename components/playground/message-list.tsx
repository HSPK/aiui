"use client"

import * as React from "react"
import { Bot } from "lucide-react"
import { formatRelativeDate, normalizeDate } from "@/lib/utils"
import { api } from "@/lib/api"
import { useQuery } from "@tanstack/react-query"
import { ChatMessage } from "./chat-message"

const DateSeparator = React.memo(({ date }: { date: string | Date }) => (
    <div className="relative flex items-center justify-center my-6">
        <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
        </div>
        <div className="relative bg-background px-3 text-xs text-muted-foreground font-medium rounded-full border">
            {formatRelativeDate(date)}
        </div>
    </div>
))
DateSeparator.displayName = "DateSeparator"

export const MessageList = React.memo(({ messages, isLoading }: { messages: any[], isLoading: boolean }) => {
    const { data: modelsData } = useQuery({
        queryKey: ["models"],
        queryFn: () => api.getModels(),
        staleTime: 1000 * 60 * 5, // Cache for 5 mins
    })

    const modelProviderMap = React.useMemo(() => {
        const map = new Map<string, string>()
        if (Array.isArray(modelsData)) {
            modelsData.forEach((m: any) => {
                if (m.name) map.set(m.name, m.provider)
            })
        }
        return map
    }, [modelsData])

    // Process messages to inject date separators
    const renderItems = React.useMemo(() => {
        const items: React.ReactNode[] = []
        let lastDate: string | null = null

        messages.forEach((m: any, index: number) => {
            const mDate = m.created_at || m.createdAt
            const dateObj = normalizeDate(mDate)
            const currentDate = dateObj.toDateString() // "Mon Jan 01 2024" (Local)

            if (currentDate !== lastDate) {
                items.push(<DateSeparator key={`date-${currentDate}-${index}`} date={mDate} />)
                // UPDATE lastDate!
                lastDate = currentDate
            }

            items.push(
                <ChatMessage
                    key={m.id}
                    message={m}
                    provider={m.model ? modelProviderMap.get(m.model) : undefined}
                    isTyping={isLoading && index === messages.length - 1 && m.role === 'assistant'}
                />
            )
        })
        return items
    }, [messages, isLoading, modelProviderMap])

    return (
        <div className="pb-36 pt-4">
            {messages.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center p-8 text-muted-foreground opacity-50 space-y-4 pt-20">
                    <Bot className="h-12 w-12" />
                    <p>Start a conversation...</p>
                </div>
            )}

            {renderItems}
        </div>
    )
})
MessageList.displayName = "MessageList"
