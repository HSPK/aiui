"use client"

import * as React from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { formatToLocal, cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
    Search,
    MessageSquare,
    Trash2,
    MoreHorizontal,
    Edit2,
    Plus,
    Loader2,
    PanelLeftClose
} from "lucide-react"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { usePlaygroundStore } from "@/lib/stores/playground-store"
import { Conversation } from "@/lib/types/playground"
import { toast } from "sonner"

export function HistorySidebar() {
    const [search, setSearch] = React.useState("")
    const queryClient = useQueryClient()
    const { addTab, toggleSidebar } = usePlaygroundStore()

    // Query for conversations
    // Simple pagination for now: load first page
    const { data, isLoading, refetch } = useQuery({
        queryKey: ["conversations", search],
        queryFn: () => api.getConversations(1, 50, search), // Load 50 items for sidebar
    })

    const deleteMutation = useMutation({
        mutationFn: api.deleteConversation,
        onSuccess: () => {
            toast.success("Conversation deleted")
            queryClient.invalidateQueries({ queryKey: ["conversations"] })
        },
        onError: () => {
            toast.error("Failed to delete conversation")
        }
    })

    const handleOpenConversation = (conv: Conversation) => {
        addTab({
            type: "chat",
            title: conv.title,
            conversationId: conv.id,
        })
    }

    const handleDelete = (e: React.MouseEvent, id: string) => {
        e.stopPropagation()
        if (confirm("Are you sure you want to delete this conversation?")) {
            deleteMutation.mutate(id)
        }
    }

    return (
        <div className="w-full flex flex-col border-r bg-muted/10 h-full">
            <div className="p-4 border-b space-y-4">
                <div className="flex items-center justify-between">
                    <h2 className="font-semibold text-sm">History</h2>
                    <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => addTab({ type: "chat", title: "New Chat" })}>
                            <Plus className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleSidebar}>
                            <PanelLeftClose className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
                <div className="relative">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Search..."
                        className="pl-8 bg-background h-9"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
            </div>

            <ScrollArea className="flex-1">
                <div className="p-2 space-y-1">
                    {isLoading ? (
                        <div className="flex items-center justify-center py-10">
                            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        </div>
                    ) : data?.items.length === 0 ? (
                        <div className="text-center py-10 text-sm text-muted-foreground">
                            No conversations found
                        </div>
                    ) : (
                        data?.items.map((conv) => (
                            <div
                                key={conv.id}
                                className="group flex items-center justify-between p-2 rounded-md hover:bg-muted/50 cursor-pointer text-sm"
                                onClick={() => handleOpenConversation(conv)}
                            >
                                <div className="flex flex-col gap-0.5 overflow-hidden">
                                    <span className="font-medium truncate">{conv.title}</span>
                                    <span className="text-xs text-muted-foreground truncate">
                                        {formatToLocal(conv.created_at)}
                                    </span>
                                </div>
                                <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6 text-muted-foreground hover:text-destructive"
                                        onClick={(e) => handleDelete(e, conv.id)}
                                    >
                                        <Trash2 className="h-3 w-3" />
                                    </Button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </ScrollArea>
        </div>
    )
}

