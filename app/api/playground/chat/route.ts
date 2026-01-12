import { NextRequest } from "next/server"

export const runtime = "edge"

// 获取后端 API 基础地址
// NEXT_PUBLIC_API_URL 可能是:
// - "/api" (默认，通过 Next.js rewrites 代理到 localhost:8000)
// - "/api/v2" (代理路径，实际后端是 localhost:8000/v2)
// - "http://backend:8000" (完整 URL)
// - "http://backend:8000/v2" (带路径的完整 URL)
function getBackendBaseUrl(): string {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "/api"

    // 如果是相对路径 /api 或 /api/xxx，需要转换为实际后端地址
    if (apiUrl.startsWith("/api")) {
        // /api -> http://localhost:8000
        // /api/v2 -> http://localhost:8000/v2
        const suffix = apiUrl.replace(/^\/api/, "")
        return `http://localhost:8000${suffix}`
    }

    // 如果是完整 URL，直接使用
    return apiUrl
}

export async function POST(req: NextRequest) {
    const body = await req.json()
    const authHeader = req.headers.get("Authorization") || ""

    const backendUrl = getBackendBaseUrl()
    const response = await fetch(`${backendUrl}/playground/chat`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": authHeader,
        },
        body: JSON.stringify(body),
    })

    if (!response.ok) {
        return new Response(await response.text(), {
            status: response.status,
            statusText: response.statusText,
        })
    }

    // Forward the SSE stream directly, including message/generation IDs from backend
    const headers: Record<string, string> = {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
    }

    // Forward X-Message-ID and X-Generation-ID from backend response
    const messageId = response.headers.get("X-Message-ID")
    const generationId = response.headers.get("X-Generation-ID")
    if (messageId) headers["X-Message-ID"] = messageId
    if (generationId) headers["X-Generation-ID"] = generationId

    return new Response(response.body, { headers })
}
