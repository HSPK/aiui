#!/usr/bin/env node
// Bundles bin/aiui.ts (and its transitive lib/preflight.ts + lib/schemas/*)
// into a single ESM file at bin/aiui.mjs. The .mjs extension forces Node to
// load it as an ES module without polluting package.json with
// `"type": "module"` (which would change every other .js file in the repo).
// esbuild preserves the entry file's `#!/usr/bin/env node` shebang
// automatically — don't add a banner or you get a duplicate.

import * as esbuild from "esbuild";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const OUTFILE = resolve(ROOT, "bin/aiui.mjs");

mkdirSync(dirname(OUTFILE), { recursive: true });

await esbuild.build({
    entryPoints: [resolve(ROOT, "bin/aiui.ts")],
    outfile: OUTFILE,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    // npm deps are installed alongside; bundling only our own TS source.
    packages: "external",
    // Resolve TS path alias `@/...` → repo root, matching tsconfig.json.
    alias: { "@": ROOT },
    logLevel: "info",
});

chmodSync(OUTFILE, 0o755);
console.log(`built ${OUTFILE}`);
