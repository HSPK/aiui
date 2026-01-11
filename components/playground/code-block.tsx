"use client"

import * as React from "react"
import { Check, Copy } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"
import { oneDark, oneLight } from "react-syntax-highlighter/dist/esm/styles/prism"
import { useTheme } from "next-themes"

interface CodeBlockProps {
    language?: string
    value: string
    className?: string
}

// Create theme variants
const createCustomTheme = (baseTheme: any, isDark: boolean) => ({
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

    const customTheme = React.useMemo(() => 
        createCustomTheme(isDark ? oneDark : oneLight, isDark),
        [isDark]
    )

    const onCopy = React.useCallback(() => {
        navigator.clipboard.writeText(value)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
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
            "relative group/code my-3 rounded-lg border overflow-hidden",
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
            {/* Code content */}
            <div className="overflow-x-auto p-3">
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
                >
                    {value}
                </SyntaxHighlighter>
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
