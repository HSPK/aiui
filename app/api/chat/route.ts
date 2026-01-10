// app/api/chat/route.ts
import { ApiError, getAuthHeader } from "@/lib/api";
import { NextRequest } from "next/server";

// We need to proxy the request to the backend because the browser might not like the SSE response
// or we need to transform the request body.
// However, the cleanest way is often to let the browser connect directly if CORS allows.
// If your backend is on a different domain, you usually use a proxy.
// Assuming the backend is on localhost:8000 or similar (proxied via next.config.mjs rewrites or accessible directly).
//
// But `vercel/ai` useChat expects a specific POST endpoint.
//
// The goal is to maximize compatibility with the existing backend `POST /playground/chat`.
//
// The request body from `useChat` looks like:
// { messages: [...], model: '...', ... }
//
// The backend expects:
// { message: "last message content", conversation_id: "...", ... }
//
// So we must transform it.

export const runtime = "edge";

export async function POST(req: NextRequest) {
    const json = await req.json();
    const { messages, conversation_id, ...config } = json;

    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || lastMessage.role !== 'user') {
        // Technically useChat sends the user message last.
        // If it's a regenerate, it might be different, but let's assume standard flow.
    }

    const payload = {
        message: lastMessage.content,
        conversation_id: conversation_id,
        // Pass other config like temperature, model, etc.
        ...config
    };

    // The backend URL needs to be absolute if we are fetching from server side to another server
    // Or if we have a rewrite, we can use the local path.
    // For now, let's assume we use the env var or default
    const backendUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";

    // We need to pass the auth header from the client request
    const authHeader = req.headers.get("Authorization");

    try {
        const response = await fetch(`${backendUrl}/playground/chat`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(authHeader ? { "Authorization": authHeader } : {})
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const error = await response.text();
            return new Response(error, { status: response.status });
        }

        // Return the stream directly
        return new Response(response.body, {
            headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
            },
        });

    } catch (error) {
        console.error("Chat API Error:", error);
        return new Response("Internal Server Error", { status: 500 });
    }
}
