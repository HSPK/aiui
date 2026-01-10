import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { format } from "date-fns"

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

export function formatToLocal(dateStr: string, pattern: string = "MMM d, HH:mm:ss") {
    if (!dateStr) return "-"
    const date = new Date(dateStr.endsWith("Z") ? dateStr : `${dateStr}Z`)
    return format(date, pattern)
}
