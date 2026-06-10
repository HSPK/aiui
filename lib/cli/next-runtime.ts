// Runtime helpers for spawning the embedded Next.js server.
//
// Three install scenarios must work — source checkout, `npm install
// -g @hspk/loom`, `npx @hspk/loom` (temp cache). `createRequire` lets Node's
// module resolver do the climb for us instead of hardcoding relative
// paths, so all three Just Work.

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { preflightFromConfig } from "../preflight";
import { ensureExternalAliases } from "./external-aliases";
import { PACKAGE_ROOT, USER_CWD } from "./paths";

export function resolveNextBin(): string {
    const requireFromPkg = createRequire(resolve(PACKAGE_ROOT, "package.json"));
    try {
        // `next/dist/bin/next` is the CJS entry shipped inside the npm package.
        return requireFromPkg.resolve("next/dist/bin/next");
    } catch (err) {
        console.error("Couldn't locate the `next` binary.");
        console.error("If you installed via npm/bunx, this usually means the install was incomplete.");
        console.error("Run `npm install -g @hspk/loom` (or your package manager's equivalent) and try again.");
        console.error("Details:", err);
        process.exit(1);
    }
}

export interface RunNextOptions {
    port?: string;
    hostname?: string;
}

/**
 * Spawn `next <mode>` against the embedded Next.js server. Runs the
 * config preflight first so values in `loom.config.yaml` (database
 * path, admin password, port, …) are hoisted into env vars before
 * Next loads any module.
 */
export function runNext(mode: "start" | "dev", opts: RunNextOptions): void {
    const nextBin = resolveNextBin();

    process.env.LOOM_USER_CWD = USER_CWD;
    process.env.LOOM_PACKAGE_ROOT = PACKAGE_ROOT;
    if (mode === "start") ensureExternalAliases();
    const { path: cfgPath, applied } = preflightFromConfig();
    if (cfgPath) {
        const note = applied.length > 0 ? ` (env: ${applied.join(", ")})` : "";
        console.log(`[loom] loaded config from ${cfgPath}${note}`);
    }

    const args: string[] = [mode];
    const port = opts.port || process.env.LOOM_SERVER_PORT || process.env.PORT;
    const host = opts.hostname || process.env.LOOM_SERVER_HOSTNAME;
    if (port) args.push("-p", String(port));
    if (host) args.push("-H", String(host));

    // `node <next>` (not the .bin symlink) — some package managers
    // don't materialise the symlink, but the JS entry is always there.
    const child = spawn(process.execPath, [nextBin, ...args], {
        cwd: PACKAGE_ROOT,
        env: process.env,
        stdio: "inherit",
    });
    child.on("exit", (code) => process.exit(code ?? 0));
}
