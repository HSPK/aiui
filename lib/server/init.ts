import "server-only";
import { bootstrapAdmin } from "./bootstrap";
import { loadConfigFile } from "./config";

let initPromise: Promise<void> | null = null;

export function ensureInit(): Promise<void> {
    if (!initPromise) {
        initPromise = (async () => {
            await bootstrapAdmin();
            // Config file is upserted after admin bootstrap so failures here don't
            // block first-login. Errors are logged inside loadConfigFile().
            try {
                loadConfigFile();
            } catch (err) {
                console.error("[aiui:init] config file load failed:", err);
            }
        })();
    }
    return initPromise;
}
