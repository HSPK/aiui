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

export function normalizeDate(dateStr?: string | Date) {
    if (!dateStr) return new Date()
    if (dateStr instanceof Date) return dateStr
    
    // Check if string contains timezone info (Z, +HH:mm, -HH:mm)
    // Simple check: Z at the end, or + / - followed by a digit near the end
    const hasTimezone = /Z$|([+-]\d{2}(:?\d{2})?)$/.test(dateStr)
    
    return new Date(hasTimezone ? dateStr : `${dateStr}Z`)
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
