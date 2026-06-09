import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { format, isToday, isYesterday } from "date-fns"

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

export function formatToLocal(dateStr: string, pattern: string = "MMM d, HH:mm:ss") {
    if (!dateStr) return "-"
    const date = new Date(dateStr.endsWith("Z") ? dateStr : `${dateStr}Z`)
    return format(date, pattern)
}

// Detect timezone marker at the end of an ISO-ish string: trailing Z
// OR a ±HHMM / ±HH:MM offset. Hoisted to avoid per-call recompile —
// formatMessageTime / formatRelativeDate / normalizeDate are called
// many times per render in message-heavy views.
const TZ_SUFFIX_RE = /Z$|([+-]\d{2}(:?\d{2})?)$/

export function normalizeDate(dateStr?: string | Date) {
    if (!dateStr) return new Date()
    if (dateStr instanceof Date) return dateStr
    return new Date(TZ_SUFFIX_RE.test(dateStr) ? dateStr : `${dateStr}Z`)
}

export function formatMessageTime(dateStr?: string | Date) {
    const date = normalizeDate(dateStr)
    return format(date, "HH:mm")
}

export function formatRelativeDate(dateStr?: string | Date) {
    const date = normalizeDate(dateStr)
    const now = new Date()

    if (isToday(date)) return "Today"
    if (isYesterday(date)) return "Yesterday"

    // Check if same year
    if (date.getFullYear() === now.getFullYear()) {
        return format(date, "MMMM d")
    }
    return format(date, "MMMM d, yyyy")
}
