"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Settings2 } from "lucide-react"
import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
} from "@/components/ui/dropdown-menu"
import type { ChatInputConfig, ChatInputCallbacks } from "./chat-input"

interface ChatConfigDropdownProps {
    configRef: React.RefObject<ChatInputConfig>
    callbacksRef: React.RefObject<ChatInputCallbacks>
}

export const ChatConfigDropdown = React.memo(function ChatConfigDropdown({
    configRef,
    callbacksRef,
}: ChatConfigDropdownProps) {
    // Local state for controlled inputs - synced from refs when dropdown opens
    const [localTemp, setLocalTemp] = React.useState<number | undefined>(undefined)
    const [localHistory, setLocalHistory] = React.useState(20)
    const [localReasoning, setLocalReasoning] = React.useState<string | null>(null)

    // Sync local state when dropdown opens
    const handleOpenChange = React.useCallback((open: boolean) => {
        if (open && configRef.current) {
            setLocalTemp(configRef.current.temperature)
            setLocalHistory(configRef.current.historyLimit)
            setLocalReasoning(configRef.current.reasoningEffort)
        }
    }, [configRef])

    return (
        <DropdownMenu onOpenChange={handleOpenChange}>
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                >
                    <Settings2 className="h-5 w-5" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-80 p-4" align="end">
                <div className="space-y-4">
                    <h4 className="font-medium leading-none">Configuration</h4>

                    <div className="grid gap-2">
                        <Label htmlFor="temperature">
                            Temperature: {localTemp ?? 'Default'}
                        </Label>
                        <Input
                            id="temperature"
                            type="number"
                            min={0}
                            max={2}
                            step={0.1}
                            value={localTemp ?? ''}
                            onChange={(e) => {
                                const val = e.target.value ? parseFloat(e.target.value) : undefined
                                setLocalTemp(val)
                                callbacksRef.current?.onTemperatureChange(val)
                            }}
                            className="h-8"
                            placeholder="Default (Empty)"
                        />
                    </div>

                    <div className="grid gap-2">
                        <Label htmlFor="reasoning-effort">Reasoning Effort</Label>
                        <select
                            id="reasoning-effort"
                            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                            value={localReasoning || ""}
                            onChange={(e) => {
                                const val = e.target.value || null
                                setLocalReasoning(val)
                                callbacksRef.current?.onReasoningEffortChange(val)
                            }}
                        >
                            <option value="">Default (Empty)</option>
                            <option value="low">Low</option>
                            <option value="medium">Medium</option>
                            <option value="high">High</option>
                        </select>
                    </div>

                    <div className="grid gap-2">
                        <Label htmlFor="history">History Limit</Label>
                        <Input
                            id="history"
                            type="number"
                            min={0}
                            value={localHistory}
                            onChange={(e) => {
                                const val = parseInt(e.target.value)
                                setLocalHistory(val)
                                callbacksRef.current?.onHistoryLimitChange(val)
                            }}
                        />
                    </div>
                </div>
            </DropdownMenuContent>
        </DropdownMenu>
    )
})
