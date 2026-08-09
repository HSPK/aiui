// Shared, non-test helpers for the lib/cli/** suites.
//
// NOT picked up by vitest (the `node` project only includes
// `tests/node/**/*.test.ts`) — safe to import from any spec file here.

import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A fake ChildProcess: real EventEmitter so `.on("exit", cb)` / `.emit("exit", code)` work as-is. */
export function makeFakeChild(): EventEmitter {
    return new EventEmitter();
}

/** Fresh mkdtemp'd directory. Caller is responsible for cleanup via `cleanupTempDir`. */
export function makeTempDir(prefix = "loom-cli-test-"): string {
    return mkdtempSync(join(tmpdir(), prefix));
}

export function cleanupTempDir(dir: string): void {
    rmSync(dir, { recursive: true, force: true });
}
