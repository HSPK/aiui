"use client"

import * as React from "react"
import { usePlaygroundStore, PlaygroundTab } from "@/lib/stores/playground-store"
import { ChatFlow } from "@/components/playground/chat-flow"
import { PlaygroundHome } from "@/components/playground/playground-home"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Plus, X, MessageSquare, Settings2 } from "lucide-react"

function TabHeader({ tab, isActive, onClick, onClose }: { tab: PlaygroundTab, isActive: boolean, onClick: () => void, onClose: (e: React.MouseEvent) => void }) {
    return (
        <div
            onClick={onClick}
            className={cn(
                "group flex items-center gap-2 px-4 py-2 text-sm border-r cursor-pointer select-none hover:bg-muted/50 transition-colors min-w-[120px] max-w-[200px] h-[40px]",
                isActive ? "bg-background border-b-0 border-t-2 border-t-primary" : "bg-muted/20 border-b"
            )}
        >
            <MessageSquare className="h-3 w-3 text-muted-foreground" />
            <span className="truncate flex-1 font-medium">{tab.title}</span>
            <div
                role="button"
                onClick={onClose}
                className={cn(
                    "opacity-0 group-hover:opacity-100 p-0.5 rounded-sm hover:bg-destructive/10 hover:text-destructive transition-all",
                    isActive && "opacity-100"
                )}
            >
                <X className="h-3 w-3" />
            </div>
        </div>
    )
}

export default function PlaygroundPage() {
    const {
        tabs,
        activeTabId,
        setActiveTab,
        removeTab,
        addTab
    } = usePlaygroundStore()

    const activeTab = tabs.find(t => t.id === activeTabId)

    return (
        <div className="h-full flex overflow-hidden bg-background">
            <div className="flex-1 flex flex-col h-full overflow-hidden">
                {/* Tabs Bar */}
                <div className="flex items-end bg-muted/10 border-b flex-none">
                    <div className="flex-1 flex overflow-x-auto no-scrollbar items-end h-[41px]">
                        {tabs.map(tab => (
                            <TabHeader
                                key={tab.id}
                                tab={tab}
                                isActive={tab.id === activeTabId}
                                onClick={() => setActiveTab(tab.id)}
                                onClose={(e) => {
                                    e.stopPropagation()
                                    removeTab(tab.id)
                                }}
                            />
                        ))}
                    </div>
                    <div className="px-2 py-1.5 border-l bg-background/50 flex-none h-[40px] flex items-center">
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => addTab()}>
                            <Plus className="h-4 w-4" />
                        </Button>
                    </div>
                </div>

                {/* Main Content Area */}
                <div className="flex-1 flex overflow-hidden">
                    {tabs.length === 0 ? (
                        <PlaygroundHome />
                    ) : activeTab ? (
                        <>
                            <div className="flex-1 flex flex-col min-w-0 bg-background h-full">
                                {/* Tab Content */}
                                <div className="flex-1 overflow-hidden relative h-full">
                                    {activeTab.type === 'chat' && (
                                        <ChatFlow key={activeTab.id} tabId={activeTab.id} />
                                    )}
                                    {activeTab.type === 'new' && (
                                        <PlaygroundHome tabId={activeTab.id} />
                                    )}
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="flex-1 flex items-center justify-center">
                            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
