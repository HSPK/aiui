"use client"

import { cn } from "@/lib/utils"

/**
 * Markdown component overrides used by every renderer in the
 * log-details sheet (ContentViewer + MessageRow). Kept in its own
 * file because the same style vocabulary applies wherever we render
 * stored upstream/downstream text in a log row.
 *
 * Future styling tweaks (new code-block treatment, callout boxes,
 * etc.) land here and apply consistently to every consumer.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const logMarkdownComponents = {
    // Code blocks — `pre` is transparent so our custom `code` can
    // emit its own wrapper without nesting block elements inside <p>.
    pre: ({ children }: any) => <>{children}</>,
    code: ({ node: _node, inline, className, children, ...props }: any) => {
        const codeString = String(children).replace(/\n$/, "")
        if (!inline) {
            return (
                <pre className="my-2 p-3 bg-muted/50 rounded-md overflow-x-auto border">
                    <code className="text-xs font-mono">{codeString}</code>
                </pre>
            )
        }
        return (
            <code className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono" {...props}>
                {children}
            </code>
        )
    },
    table: ({ children }: any) => (
        <div className="my-4 overflow-x-auto rounded-lg border border-border">
            <table className="w-full border-collapse text-sm">{children}</table>
        </div>
    ),
    thead: ({ children }: any) => <thead className="bg-muted/50">{children}</thead>,
    tbody: ({ children }: any) => <tbody className="divide-y divide-border">{children}</tbody>,
    tr: ({ children }: any) => <tr className="border-b border-border last:border-0">{children}</tr>,
    th: ({ children }: any) => (
        <th className="px-4 py-2 text-left font-semibold text-foreground border-r border-border last:border-r-0">{children}</th>
    ),
    td: ({ children }: any) => (
        <td className="px-4 py-2 text-muted-foreground border-r border-border last:border-r-0">{children}</td>
    ),
    ul: ({ children, className }: any) => {
        const isTaskList = className?.includes("contains-task-list")
        return (
            <ul className={cn("my-2 ml-4", isTaskList ? "list-none space-y-1" : "list-disc space-y-1")}>
                {children}
            </ul>
        )
    },
    ol: ({ children }: any) => <ol className="my-2 ml-4 list-decimal space-y-1">{children}</ol>,
    li: ({ children, className }: any) => {
        const isTaskItem = className?.includes("task-list-item")
        return (
            <li className={cn("leading-relaxed", isTaskItem && "flex items-start gap-2 list-none")}>
                {children}
            </li>
        )
    },
    input: ({ type, checked, ...props }: any) => {
        if (type === "checkbox") {
            return (
                <input
                    type="checkbox"
                    checked={checked}
                    readOnly
                    className="mt-1 h-4 w-4 rounded border-border text-primary"
                    {...props}
                />
            )
        }
        return <input type={type} {...props} />
    },
    blockquote: ({ children }: any) => (
        <blockquote className="my-3 border-l-4 border-primary/30 pl-4 italic text-muted-foreground">
            {children}
        </blockquote>
    ),
    hr: () => <hr className="my-4 border-border" />,
    a: ({ href, children }: any) => (
        <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2 hover:text-primary/80">
            {children}
        </a>
    ),
    del: ({ children }: any) => (
        <del className="text-muted-foreground line-through">{children}</del>
    ),
    strong: ({ children }: any) => (
        <strong className="font-semibold text-foreground">{children}</strong>
    ),
    h1: ({ children }: any) => <h1 className="mt-4 mb-2 text-xl font-bold">{children}</h1>,
    h2: ({ children }: any) => <h2 className="mt-3 mb-2 text-lg font-bold">{children}</h2>,
    h3: ({ children }: any) => <h3 className="mt-3 mb-1 text-base font-semibold">{children}</h3>,
    h4: ({ children }: any) => <h4 className="mt-2 mb-1 text-sm font-semibold">{children}</h4>,
    // <p> rendered as <div> — react-markdown wraps mixed inline + block
    // content in <p>, and our code renderer produces <pre>/<div>;
    // block-in-<p> is invalid HTML → hydration error.
    p: ({ children }: any) => <div className="mb-2 last:mb-0 leading-relaxed">{children}</div>,
}
