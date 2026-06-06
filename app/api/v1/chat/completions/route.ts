import "server-only";
import { NextRequest } from "next/server";
import { ensureInit } from "@/lib/server/init";
import { authenticateGateway, forwardChatCompletions } from "@/lib/server/gateway";
import { handle } from "@/lib/server/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
    try {
        await ensureInit();
        const user = await authenticateGateway(req);
        const body = (await req.json()) as Record<string, unknown>;
        const { response } = await forwardChatCompletions(user, body);
        return response;
    } catch (err) {
        return handle(err);
    }
}
