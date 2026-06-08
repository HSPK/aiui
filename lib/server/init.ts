import "server-only";
import { bootstrapAdmin } from "./bootstrap";
import { loadConfigFile } from "./config";

let initPromise: Promise<void> | null = null;

export function ensureInit(): Promise<void> {
    if (!initPromise) {
        initPromise = (async () => {
            // Config file FIRST: hoists master_key / admin / session / cache env vars
            // so the rest of init (and the route handler) sees them.
            try {
                loadConfigFile();
            } catch (err) {
                console.error("[loom] config file load failed:", err);
            }
            // Then bootstrap admin from the resulting env vars.
            await bootstrapAdmin();
        })();
    }
    return initPromise;
}
