import "server-only";
import { defineRoute } from "@/lib/server/route";
import { listAdapters } from "@/lib/server/adapters";
import "@/lib/server/adapters/register";

export const GET = defineRoute({
    handler: () => listAdapters(),
});
