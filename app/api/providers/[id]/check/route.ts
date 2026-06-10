import "server-only";
import { z } from "zod";
import { defineRoute } from "@/lib/server/route";
import { checkProvider } from "@/lib/server/providers";

export const POST = defineRoute({
    auth: "admin",
    params: z.object({ id: z.string().min(1) }),
    handler: ({ params }) => checkProvider(decodeURIComponent(params.id)),
});
