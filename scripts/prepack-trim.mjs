#!/usr/bin/env node
// Strip dev/build-only artifacts from `.next/` before `npm pack` so the
// distributed tarball stays lean. The `files:` whitelist in package.json
// pulls in `.next` recursively; `.npmignore` patterns inside an explicit
// include are unreliable across npm versions, so we delete physically.
//
// What goes:
//   - Source maps (.js.map / .css.map) — 60%+ of the pack with zero
//     runtime value. End users hit a stack? Re-run against the GitHub
//     source.
//   - .next/cache, .next/dev, .next/trace*, .next/diagnostics — build
//     telemetry. .next/build, .next/types — build manifests / TS types
//     not consulted at runtime.
//   - *.tsbuildinfo, OS cruft.
//
// What stays:
//   - .next/server, .next/static, .next/required-server-files.json,
//     manifests `next start` consumes.

import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const NEXT_DIR = join(ROOT, ".next");

if (!existsSync(NEXT_DIR)) {
    console.warn("[loom:prepack-trim] no .next/ to trim — did `bun run build` finish?");
    process.exit(0);
}

const EXACT_PATHS = [
    "cache",
    "dev",
    "trace",
    "trace-build",
    "diagnostics",
    "build",
    "types",
];

const SUFFIXES = [".js.map", ".css.map", ".tsbuildinfo"];

let removedFiles = 0;
let removedBytes = 0;

for (const name of EXACT_PATHS) {
    const p = join(NEXT_DIR, name);
    if (!existsSync(p)) continue;
    const before = dirSize(p);
    rmSync(p, { recursive: true, force: true });
    removedFiles += before.count;
    removedBytes += before.bytes;
}

function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            walk(full);
            continue;
        }
        if (!SUFFIXES.some((s) => entry.name.endsWith(s))) continue;
        const size = statSync(full).size;
        rmSync(full, { force: true });
        removedFiles++;
        removedBytes += size;
    }
}

walk(NEXT_DIR);

function dirSize(dir) {
    let bytes = 0;
    let count = 0;
    if (!statSync(dir).isDirectory()) {
        return { bytes: statSync(dir).size, count: 1 };
    }
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            const inner = dirSize(full);
            bytes += inner.bytes;
            count += inner.count;
        } else {
            bytes += statSync(full).size;
            count++;
        }
    }
    return { bytes, count };
}

const mb = (removedBytes / 1024 / 1024).toFixed(1);
console.log(`[loom:prepack-trim] removed ${removedFiles} files (${mb} MB) from .next/`);
