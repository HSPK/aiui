"use client"

import * as React from "react"

// Inline SVG icons for instant rendering - no network requests
export const PROVIDER_ICONS: Record<string, React.ReactNode> = {
    openai: (
        <svg viewBox="0 0 256 260" className="h-4 w-4">
            <path fill="currentColor" d="M239.184 106.203a64.716 64.716 0 0 0-5.576-53.103C219.452 28.459 191 15.784 163.213 21.74A65.586 65.586 0 0 0 52.096 45.22a64.716 64.716 0 0 0-43.23 31.36c-14.31 24.602-11.061 55.634 8.033 76.74a64.665 64.665 0 0 0 5.525 53.102c14.174 24.65 42.644 37.324 70.446 31.36a64.72 64.72 0 0 0 48.754 21.744c28.481.025 53.714-18.361 62.414-45.481a64.767 64.767 0 0 0 43.229-31.36c14.137-24.558 10.875-55.423-8.083-76.483Zm-97.56 136.338a48.397 48.397 0 0 1-31.105-11.255l1.535-.87 51.67-29.825a8.595 8.595 0 0 0 4.247-7.367v-72.85l21.845 12.636c.218.111.37.32.409.563v60.367c-.056 26.818-21.783 48.545-48.601 48.601Zm-104.466-44.61a48.345 48.345 0 0 1-5.781-32.589l1.534.921 51.722 29.826a8.339 8.339 0 0 0 8.441 0l63.181-36.425v25.221a.87.87 0 0 1-.358.665l-52.335 30.184c-23.257 13.398-52.97 5.431-66.404-17.803ZM23.549 85.38a48.499 48.499 0 0 1 25.58-21.333v61.39a8.288 8.288 0 0 0 4.195 7.316l62.874 36.272-21.845 12.636a.819.819 0 0 1-.767 0L41.353 151.53c-23.211-13.454-31.171-43.144-17.804-66.405v.256Zm179.466 41.695-63.08-36.63L161.73 77.86a.819.819 0 0 1 .768 0l52.233 30.184a48.6 48.6 0 0 1-7.316 87.635v-61.391a8.544 8.544 0 0 0-4.4-7.213Zm21.742-32.69-1.535-.922-51.619-30.081a8.39 8.39 0 0 0-8.492 0L99.98 99.808V74.587a.716.716 0 0 1 .307-.665l52.233-30.133a48.652 48.652 0 0 1 72.236 50.391v.205ZM88.061 139.097l-21.845-12.585a.87.87 0 0 1-.41-.614V65.685a48.652 48.652 0 0 1 79.757-37.346l-1.535.87-51.67 29.825a8.595 8.595 0 0 0-4.246 7.367l-.051 72.697Zm11.868-25.58 28.138-16.217 28.188 16.218v32.434l-28.086 16.218-28.188-16.218-.052-32.434Z"/>
        </svg>
    ),
    anthropic: (
        <svg viewBox="0 0 512 512" className="h-4 w-4">
            <rect fill="#CC9B7A" width="512" height="512" rx="104"/>
            <path fill="#1F1F1E" d="M318.663 149.787h-43.368l78.952 212.423 43.368.004-78.952-212.427zm-125.326 0l-78.952 212.427h44.255l15.932-44.608 82.846-.004 16.107 44.612h44.255l-79.126-212.427h-45.317zm-4.251 128.341l26.91-74.701 27.083 74.701h-53.993z"/>
        </svg>
    ),
    google: (
        <svg viewBox="0 0 256 258" className="h-4 w-4">
            <defs>
                <radialGradient id="gemini-grad" cx="78%" cy="56%" r="78%"><stop offset="0%" stopColor="#1BA1E3"/><stop offset="30%" stopColor="#5489D6"/><stop offset="55%" stopColor="#9B72CB"/><stop offset="83%" stopColor="#D96570"/><stop offset="100%" stopColor="#F49C46"/></radialGradient>
            </defs>
            <path fill="url(#gemini-grad)" d="m122.062 172.77-10.27 23.52c-3.947 9.042-16.459 9.042-20.406 0l-10.27-23.52c-9.14-20.933-25.59-37.595-46.108-46.703L6.74 113.52c-8.987-3.99-8.987-17.064 0-21.053l27.385-12.156C55.172 70.97 71.917 53.69 80.9 32.043L91.303 6.977c3.86-9.303 16.712-9.303 20.573 0l10.403 25.066c8.983 21.646 25.728 38.926 46.775 48.268l27.384 12.156c8.987 3.99 8.987 17.063 0 21.053l-28.267 12.547c-20.52 9.108-36.97 25.77-46.109 46.703Z"/>
        </svg>
    ),
    deepseek: (
        <svg viewBox="0 0 24 24" className="h-4 w-4">
            <circle cx="12" cy="12" r="11" fill="#4D6BFE"/>
            <path fill="white" d="M7 8h10v2H7zm0 3h10v2H7zm0 3h7v2H7z"/>
        </svg>
    ),
    mistral: (
        <svg viewBox="0 0 24 24" className="h-4 w-4">
            <rect fill="#F7931E" width="24" height="24" rx="4"/>
            <path fill="white" d="M4 6h4v4H4zm6 0h4v4h-4zm6 0h4v4h-4zM4 14h4v4H4zm6 0h4v4h-4zm6 0h4v4h-4z"/>
        </svg>
    ),
    meta: (
        <svg viewBox="0 0 24 24" className="h-4 w-4">
            <circle cx="12" cy="12" r="11" fill="#0668E1"/>
            <path fill="white" d="M7 7l5 10 5-10h-2l-3 6-3-6z"/>
        </svg>
    ),
    cohere: (
        <svg viewBox="0 0 24 24" className="h-4 w-4">
            <circle cx="12" cy="12" r="11" fill="#39594D"/>
            <circle cx="12" cy="12" r="5" fill="#D18EE2"/>
        </svg>
    ),
}

// Get icon for provider - instant, no loading
export function getProviderIcon(provider: string): React.ReactNode {
    const p = provider.toLowerCase()
    // Check exact match first
    if (PROVIDER_ICONS[p]) return PROVIDER_ICONS[p]
    // Check partial matches
    if (p.includes('openai') || p.includes('gpt')) return PROVIDER_ICONS.openai
    if (p.includes('anthropic') || p.includes('claude')) return PROVIDER_ICONS.anthropic
    if (p.includes('google') || p.includes('gemini') || p.includes('vertex')) return PROVIDER_ICONS.google
    if (p.includes('deepseek')) return PROVIDER_ICONS.deepseek
    if (p.includes('mistral')) return PROVIDER_ICONS.mistral
    if (p.includes('meta') || p.includes('llama')) return PROVIDER_ICONS.meta
    if (p.includes('cohere')) return PROVIDER_ICONS.cohere
    // Fallback to text
    return null
}

// Provider icon component with inline SVG or text fallback
export const ProviderIcon = React.memo(({ provider, className }: { provider: string; className?: string }) => {
    const icon = getProviderIcon(provider)
    if (icon) return <span className={className || "flex-shrink-0"}>{icon}</span>
    // Text fallback
    return (
        <span className={`h-4 w-4 rounded bg-muted/50 flex items-center justify-center text-[8px] font-bold text-muted-foreground ${className || "flex-shrink-0"}`}>
            {provider.substring(0, 2).toUpperCase()}
        </span>
    )
})
ProviderIcon.displayName = "ProviderIcon"
