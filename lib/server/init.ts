import "server-only";
import { bootstrapAdmin } from "./bootstrap";

let initPromise: Promise<void> | null = null;

export function ensureInit(): Promise<void> {
    if (!initPromise) {
        initPromise = (async () => {
            await bootstrapAdmin();
        })();
    }
    return initPromise;
}
