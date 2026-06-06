import "server-only";
import { defineRoute } from "@/lib/server/route";
import { providerProbeSchema } from "@/lib/schemas/provider";
import { probeHealthCheckUrl } from "@/lib/server/providers";

/** Ad-hoc health-URL probe. Lets the provider form's Test button
 *  validate the URL the user is currently editing without saving it
 *  first. No DB writes — `last_health_*` is reserved for the canonical
 *  saved URL probed via `POST /providers/:id/check`. */
export const POST = defineRoute({
    auth: "admin",
    body: providerProbeSchema,
    handler: ({ body }) => probeHealthCheckUrl(body.health_check_url),
});
