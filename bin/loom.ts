#!/usr/bin/env node
// Loom CLI entry shim.
//
// All subcommand wiring lives under `lib/cli/`. This file just:
//   1. Computes PACKAGE_ROOT from its own URL and stashes it in
//      LOOM_PACKAGE_ROOT so other CLI modules (which can't reliably
//      use `import.meta.url` after esbuild bundling) can read it.
//   2. Hands control to citty.
//
// `scripts/build-cli.mjs` bundles this file (+ transitive imports)
// into `bin/loom.mjs`. The output sits in the same `bin/` directory,
// so `dirname(import.meta.url) + ".."` resolves to PACKAGE_ROOT in
// both source and bundled builds.

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runMain } from "citty";

process.env.LOOM_PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Lazy import so paths.ts sees the env var on first read.
const { main } = await import("../lib/cli/main");
runMain(main);
