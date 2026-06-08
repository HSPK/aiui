"use client"

import { FileText } from "lucide-react"
import type { ContentPart } from "@/lib/schemas/content"

/**
 * Render the image / file content parts of an assistant or user
 * message above the text body. Lives separately from chat-message
 * because the chat surface, message-list previews, and future
 * inline-attachment thumbnails all share the same visual contract.
 */

export function AttachmentsView({ parts }: { parts: ContentPart[] }) {
    if (parts.length === 0) return null
    return (
        <div className="not-prose mb-2 flex flex-wrap gap-2">
            {parts.map((p, i) => {
                if (p.type === "image_url") {
                    return <ImageAttachment key={i} url={p.image_url.url} />
                }
                if (p.type === "file") {
                    return (
                        <FileAttachment
                            key={i}
                            filename={p.file.filename}
                            dataUrl={p.file.file_data}
                            mime={p.file.mime_type}
                        />
                    )
                }
                return null
            })}
        </div>
    )
}

function ImageAttachment({ url }: { url: string }) {
    return (
        <a href={url} target="_blank" rel="noreferrer" className="inline-block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
                src={url}
                alt="attachment"
                className="max-h-64 max-w-xs rounded-md border bg-muted/30 object-contain"
            />
        </a>
    )
}

function FileAttachment({ filename, dataUrl, mime }: { filename: string; dataUrl: string; mime?: string }) {
    return (
        <a
            href={dataUrl}
            download={filename}
            className="inline-flex items-center gap-2 rounded-md border bg-muted/30 px-2 py-1.5 text-xs hover:bg-muted/50 transition-colors max-w-[260px]"
            title={mime ? `${filename} (${mime})` : filename}
        >
            <span className="flex h-7 w-7 items-center justify-center rounded bg-muted shrink-0">
                <FileText className="h-3.5 w-3.5 text-muted-foreground" />
            </span>
            <span className="truncate">{filename}</span>
        </a>
    )
}
