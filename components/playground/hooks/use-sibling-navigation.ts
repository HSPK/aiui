"use client"

import * as React from "react"

export interface UseSiblingNavigationReturn {
    selectedSiblings: Map<string, number>
    onSelectSibling: (parentId: string, index: number) => void
    getSelectedIndex: (parentId: string, defaultIndex: number) => number
}

/**
 * Hook to manage sibling message navigation state
 * Tracks which sibling index is selected for each parent message
 */
export function useSiblingNavigation(): UseSiblingNavigationReturn {
    const [selectedSiblings, setSelectedSiblings] = React.useState<Map<string, number>>(new Map())

    const onSelectSibling = React.useCallback((parentId: string, index: number) => {
        setSelectedSiblings(prev => {
            const next = new Map(prev)
            next.set(parentId, index)
            return next
        })
    }, [])

    const getSelectedIndex = React.useCallback((parentId: string, defaultIndex: number) => {
        return selectedSiblings.get(parentId) ?? defaultIndex
    }, [selectedSiblings])

    return {
        selectedSiblings,
        onSelectSibling,
        getSelectedIndex
    }
}
