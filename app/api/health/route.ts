import "server-only";
import { defineRoute } from "@/lib/server/route";

export const GET = defineRoute({
    auth: "public",
    handler: () => ({ status: "ok" }),
});
