// Tiny @clack/prompts ergonomics: wrap each prompt so cancellation
// (Ctrl+C / Escape) short-circuits the whole flow with a clean
// "Cancelled." message instead of leaving the user in a partial state.

import { cancel, isCancel } from "@clack/prompts";

export function bail(reason: string): never {
    cancel(reason);
    process.exit(1);
}

export async function ask<T>(promise: Promise<T | symbol>): Promise<T> {
    const value = await promise;
    if (isCancel(value)) bail("Cancelled.");
    return value as T;
}

/** @clack passes `string | undefined` to validators on cancel. Wrap
 *  a plain string-validator so call sites stay readable. */
export function defined(fn: (v: string) => string | undefined): (v: string | undefined) => string | undefined {
    return (v) => (v === undefined ? undefined : fn(v));
}
