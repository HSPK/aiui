import "server-only";
import { ok } from "@/lib/server/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
    return ok("pong");
}
