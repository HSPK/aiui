// Boots the fake upstream + a production Loom server for the browser suite.
//
// Deliberately uses `next start` against the real build (not `next dev`) —
// dev-mode bundles are unminified and lazily compiled, so any performance
// number taken against them would be fiction.

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = process.env.LOOM_E2E_PORT || "3311";
const UPSTREAM_PORT = process.env.FAKE_UPSTREAM_PORT || "4599";
const dataDir = mkdtempSync(join(tmpdir(), "loom-e2e-"));

const env = {
    ...process.env,
    NODE_ENV: "production",
    LOOM_DB_PATH: join(dataDir, "loom.db"),
    LOOM_PACKAGE_ROOT: ROOT,
    LOOM_USER_CWD: dataDir,
    LOOM_MASTER_KEY: "e2e-master-key",
    LOOM_ADMIN_USERNAME: "admin",
    LOOM_ADMIN_PASSWORD: "e2e-password",
    LOOM_SERVER_PORT: PORT,
    LOOM_SERVER_HOSTNAME: "127.0.0.1",
    FAKE_UPSTREAM_PORT: UPSTREAM_PORT,
    NEXT_TELEMETRY_DISABLED: "1",
};

const children = [];
function cleanup() {
    for (const c of children) { try { c.kill("SIGTERM"); } catch { /* ignore */ } }
    rmSync(dataDir, { recursive: true, force: true });
}
process.on("SIGTERM", () => { cleanup(); process.exit(0); });
process.on("SIGINT", () => { cleanup(); process.exit(0); });
process.on("exit", cleanup);

children.push(spawn(process.execPath, [join(ROOT, "e2e/support/fake-upstream.mjs")], { env, stdio: "inherit" }));

const nextBin = resolve(ROOT, "node_modules/next/dist/bin/next");
children.push(spawn(process.execPath, [nextBin, "start", "-p", PORT, "-H", "127.0.0.1"], {
    cwd: ROOT,
    env,
    stdio: "inherit",
}));
