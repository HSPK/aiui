"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { Check, Copy } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useTheme } from "next-themes"

interface CodeBlockProps {
    language?: string
    value: string
    className?: string
}

/**
 * react-syntax-highlighter + the Prism theme bundles add ~120 KB
 * gzipped — pulling that into every chat render is wasteful when many
 * messages have no code blocks at all. Dynamic-loading the heavy
 * highlighter keeps the chat bundle lean; until the chunk arrives we
 * show a plain monospace fallback so the message is readable
 * immediately, then upgrade in-place.
 */
const SyntaxHighlighter = dynamic(
    () => import("react-syntax-highlighter").then((m) => m.Prism),
    { ssr: false, loading: () => null },
)

// Theme tokens loaded the same way so the initial paint doesn't pay
// for them either.
function useHighlighterTheme(isDark: boolean): Record<string, React.CSSProperties> | null {
    const [theme, setTheme] = React.useState<Record<string, React.CSSProperties> | null>(null)
    React.useEffect(() => {
        let cancelled = false
        import("react-syntax-highlighter/dist/esm/styles/prism").then((m) => {
            if (cancelled) return
            const base = isDark ? m.oneDark : m.oneLight
            setTheme(createCustomTheme(base))
        })
        return () => { cancelled = true }
    }, [isDark])
    return theme
}

const createCustomTheme = (baseTheme: Record<string, React.CSSProperties>): Record<string, React.CSSProperties> => ({
    ...baseTheme,
    'pre[class*="language-"]': {
        ...baseTheme['pre[class*="language-"]'],
        background: 'transparent',
        margin: 0,
        padding: 0,
        fontSize: '12px',
        lineHeight: '1.5',
    },
    'code[class*="language-"]': {
        ...baseTheme['code[class*="language-"]'],
        background: 'transparent',
        fontSize: '12px',
        lineHeight: '1.5',
    },
})

export const CodeBlock = React.memo(({ language, value, className }: CodeBlockProps) => {
    const [copied, setCopied] = React.useState(false)
    const { resolvedTheme } = useTheme()
    const isDark = resolvedTheme === "dark"
    const customTheme = useHighlighterTheme(isDark)

    const copyTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
    React.useEffect(() => () => {
        if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    }, [])

    const onCopy = React.useCallback(() => {
        navigator.clipboard.writeText(value)
        if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
        setCopied(true)
        copyTimerRef.current = setTimeout(() => setCopied(false), 2000)
    }, [value])

    // Normalize language name
    const normalizedLanguage = React.useMemo(() => {
        if (!language) return "text"
        const lang = language.toLowerCase()
        // Map common aliases
        const aliases: Record<string, string> = {
            'js': 'javascript',
            'ts': 'typescript',
            'py': 'python',
            'rb': 'ruby',
            'yml': 'yaml',
            'sh': 'bash',
            'shell': 'bash',
            'zsh': 'bash',
            'json5': 'json',
            'jsonc': 'json',
            'md': 'markdown',
            'dockerfile': 'docker',
        }
        return aliases[lang] || lang
    }, [language])

    return (
        <div className={cn(
            "relative group/code my-3 rounded-lg border",
            "w-full max-w-full min-w-0 overflow-hidden",
            isDark ? "bg-zinc-900 border-zinc-800" : "bg-zinc-50 border-zinc-200",
            className
        )}>
            {/* Header with language and copy button */}
            <div className={cn(
                "flex items-center justify-between px-3 py-1.5 border-b",
                isDark ? "border-zinc-800 bg-zinc-900/50" : "border-zinc-200 bg-zinc-100/50"
            )}>
                <span className={cn(
                    "text-[10px] font-medium uppercase tracking-wide",
                    isDark ? "text-zinc-400" : "text-zinc-500"
                )}>
                    {normalizedLanguage}
                </span>
                <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                        "h-6 px-2",
                        isDark
                            ? "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
                            : "text-zinc-500 hover:text-zinc-700 hover:bg-zinc-200"
                    )}
                    onClick={onCopy}
                >
                    {copied ? (
                        <>
                            <Check className="h-3 w-3 mr-1" />
                            <span className="text-[10px]">Copied</span>
                        </>
                    ) : (
                        <>
                            <Copy className="h-3 w-3 mr-1" />
                            <span className="text-[10px]">Copy</span>
                        </>
                    )}
                </Button>
            </div>
            {/* Code content — show plain monospace until the highlighter
                chunk lands, then swap in the colourised render. */}
            <div className="overflow-x-auto scrollbar-thin p-3 w-full min-w-0">
                {customTheme ? (
                    <SyntaxHighlighter
                        language={normalizedLanguage}
                        style={customTheme}
                        customStyle={{
                            margin: 0,
                            padding: 0,
                            background: 'transparent',
                            fontSize: '12px',
                        }}
                        codeTagProps={{
                            style: {
                                fontSize: '12px',
                                fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                            }
                        }}
                        wrapLines={false}
                        wrapLongLines={false}
                    >
                        {value}
                    </SyntaxHighlighter>
                ) : (
                    <pre className="m-0 p-0 text-[12px] leading-[1.5] font-mono text-foreground/85">
                        <code>{value}</code>
                    </pre>
                )}
            </div>
        </div>
    )
})
CodeBlock.displayName = "CodeBlock"

// Inline code component
export const InlineCode = React.memo(({ children, className }: { children: React.ReactNode, className?: string }) => {
    return (
        <code className={cn(
            "px-1.5 py-0.5 rounded bg-muted text-[11px] font-mono text-foreground/90",
            className
        )}>
            {children}
        </code>
    )
})
InlineCode.displayName = "InlineCode"
