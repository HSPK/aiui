import { NextRequest } from "next/server"

// 使用 nodejs runtime 以支持运行时环境变量
export const runtime = "nodejs"
// 禁用响应缓存
export const dynamic = "force-dynamic"

// 获取后端 API 基础地址
// 优先使用 BACKEND_URL（服务端），回退到 NEXT_PUBLIC_API_URL
function getBackendBaseUrl(): string {
    // BACKEND_URL: 直接的后端地址，如 http://backend:8000 或 http://backend:8000/v2
    // NEXT_PUBLIC_API_URL: 前端 API 前缀，如 /api 或 /api/v2
    const backendUrl = process.env.BACKEND_URL
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "/api"

    // 如果配置了 BACKEND_URL，直接使用
    if (backendUrl) {
        return backendUrl.replace(/\/$/, "")
    }

    // 否则从 NEXT_PUBLIC_API_URL 推断后端地址
    // /api -> http://localhost:8000
    // /api/v2 -> http://localhost:8000/v2
    if (apiUrl.startsWith("/api")) {
        const suffix = apiUrl.replace(/^\/api/, "")
        return `http://localhost:8000${suffix}`
    }

    // 如果只是路径前缀如 /v2，添加默认 host
    if (apiUrl.startsWith("/")) {
        return `http://localhost:8000${apiUrl}`
    }

    // 如果是完整 URL，直接使用
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
