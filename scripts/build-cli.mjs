#!/usr/bin/env node
// Bundles bin/loom.ts (and its transitive lib/preflight.ts + lib/schemas/*)
// into a single ESM file at bin/loom.mjs. The .mjs extension forces Node to
// load it as an ES module without polluting package.json with
// `"type": "module"` (which would change every other .js file in the repo).
// esbuild preserves the entry file's `#!/usr/bin/env node` shebang
// automatically — don't add a banner or you get a duplicate.

import * as esbuild from "esbuild";
import { chmodSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const OUTFILE = resolve(ROOT, "bin/loom.mjs");
// Second artifact, for the container image only. The image ships Next's
// standalone output, whose node_modules holds exactly what the *server*
// entrypoints import — the CLI's own deps (citty, yaml, @clack/prompts)
// are not among them, so the externals-based bundle above resolves to
// nothing there and every `docker run … <subcommand>` dies with
// ERR_MODULE_NOT_FOUND. Bundling them is cheaper and less brittle than
// hand-copying transitive dependency trees into the image.
const STANDALONE_OUTFILE = resolve(ROOT, "bin/loom.standalone.mjs");
const PKG_VERSION = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")).version;

mkdirSync(dirname(OUTFILE), { recursive: true });

const common = {
    entryPoints: [resolve(ROOT, "bin/loom.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    // Resolve TS path alias `@/...` → repo root, matching tsconfig.json.
    alias: { "@": ROOT },
    define: { "process.env.LOOM_VERSION": JSON.stringify(PKG_VERSION) },
    logLevel: "info",
};

await esbuild.build({
    ...common,
    outfile: OUTFILE,
    // npm deps are installed alongside; bundling only our own TS source.
    packages: "external",
});

await esbuild.build({
    ...common,
    outfile: STANDALONE_OUTFILE,
    // Everything except Node builtins goes in the file.
    packages: "bundle",
    // Some of those deps resolve to CJS, and esbuild's ESM output cannot
    // `require` them: its `__require` shim throws unless a real `require`
    // is in scope. Provide one. (esbuild emits the shebang before the
    // banner, so this does not displace it.)
    banner: {
        js: [
            'import { createRequire as __createRequire } from "node:module";',
            "const require = __createRequire(import.meta.url);",
        ].join("\n"),
    },
});

for (const f of [OUTFILE, STANDALONE_OUTFILE]) {
    chmodSync(f, 0o755);
    console.log(`built ${f}`);
}
