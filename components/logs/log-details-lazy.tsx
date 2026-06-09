"use client"

import dynamic from "next/dynamic"

/**
 * Lazy import wrapper for `<LogDetails>`. The sheet body pulls in
 * react-json-view, ReactMarkdown, KaTeX and the image-gallery — none
 * of which are needed until the user actually clicks a log row. Both
 * call sites (chat-flow + /logs page) go through this file so the
 * dynamic chunk is shared.
 */
export const LogDetails = dynamic(
    () => import("./log-details").then((m) => m.LogDetails),
    { ssr: false },
)
