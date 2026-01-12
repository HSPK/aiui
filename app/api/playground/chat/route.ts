import { NextRequest } from "next/server"

export const runtime = "edge"

// 获取后端 API 基础地址
// 使用服务端环境变量 API_URL 或回退到 NEXT_PUBLIC_API_URL
function getBackendBaseUrl(): string {
    // 优先使用服务端环境变量
    const apiUrl = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || "/api"

    // 如果是相对路径 /api 或 /api/xxx，需要转换为实际后端地址
    if (apiUrl.startsWith("/api")) {
        // /api -> http://localhost:8000
        // /api/v2 -> http://localhost:8000/v2
        const suffix = apiUrl.replace(/^\/api/, "")
        return `http://localhost:8000${suffix}`
    }

    // 如果只是路径前缀如 /v2，添加默认 host
    if (apiUrl.startsWith("/")) {
        return `http://localhost:8000${apiUrl}`
    }

    // 如果是完整 URL，直接使用（移除末尾斜杠）
    return apiUrl.replace(/\/$/, "")
}

export async function POST(req: NextRequest) {
    const body = await req.json()
    const authHeader = req.headers.get("Authorization") || ""

    const backendUrl = getBackendBaseUrl()
    const targetUrl = `${backendUrl}/playground/chat`

    const response = await fetch(targetUrl, {
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
