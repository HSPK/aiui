import "server-only";
import { unauthorized } from "../response";
import { authenticateBearer } from "./bearer";
import { getCurrentUser } from "./session";
import type { SessionUser } from "./types";

/**
 * Gateway authentication: Bearer api-key (for external apps) OR session cookie
 * (for same-origin browser calls). Used by /api/v1/* endpoints and the
 * playground/chat route.
 */
export async function authenticateGateway(req: Request): Promise<SessionUser> {
    const header = req.headers.get("Authorization");
    if (header && /^Bearer\s+/i.test(header)) {
        return authenticateBearer(req);
    }
    const cookieUser = await getCurrentUser();
    if (cookieUser) return cookieUser;
    throw unauthorized("Missing or invalid credentials");
}
