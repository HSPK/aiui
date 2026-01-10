import { NextRequest } from "next/server"

export const runtime = "edge"

// 获取后端 API 基础地址，移除 /api 前缀（因为 rewrites 会添加）
function getBackendUrl(): string {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"
    // 如果配置的是 /api 前缀的代理地址，需要转换为实际后端地址
    if (apiUrl === "/api") {
        return "http://localhost:8000"
    }
    // 移除末尾的 /api（如果有）
    return apiUrl.replace(/\/api$/, "")
}

export async function POST(req: NextRequest) {
    const body = await req.json()
    const authHeader = req.headers.get("Authorization") || ""

    const backendUrl = getBackendUrl()
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

    // Forward the SSE stream directly
    return new Response(response.body, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    })
}
