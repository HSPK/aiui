import "server-only";
import { defineRoute } from "@/lib/server/route";
import { clearDiscoveryCache } from "@/lib/server/discovery";

export const POST = defineRoute({
    auth: "admin",
    handler: () => {
        clearDiscoveryCache();
        return null;
    },
});
