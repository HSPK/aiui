#!/usr/bin/env node
// Build-time: scan .next/node_modules for the package-hash symlinks that
// Turbopack emits for `serverExternalPackages`, and write a manifest mapping
// hashed-name -> real package name. The manifest is then consumed by the
// install-time postinstall hook to recreate the symlinks, since `npm pack`
// silently drops any `node_modules` directory from the tarball.

import { existsSync, mkdirSync, readdirSync, readlinkSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const NEXT_DIR = resolve(ROOT, ".next");
const MODULES_DIR = resolve(NEXT_DIR, "node_modules");
const OUT = resolve(NEXT_DIR, "external-aliases.json");

if (!existsSync(MODULES_DIR)) {
    console.log("[loom] no .next/node_modules — skipping alias manifest");
    writeFileSync(OUT, "{}\n");
    process.exit(0);
}

const aliases = {};
for (const name of readdirSync(MODULES_DIR)) {
    const full = resolve(MODULES_DIR, name);
    let target;
    try {
        target = readlinkSync(full);
    } catch {
        // Not a symlink — could be a real directory copied by Turbopack.
        // We can't reverse-map those, so skip.
        continue;
    }
    // Resolve the target to figure out which real package it points at.
    // Targets look like "../../node_modules/<scope>/<pkg>" or "../../node_modules/<pkg>".
    const absTarget = resolve(MODULES_DIR, target);
    const parts = absTarget.split("/node_modules/");
    if (parts.length < 2) continue;
    const tail = parts[parts.length - 1];
    // <pkg> or @scope/<pkg>
    const segs = tail.split("/").filter(Boolean);
    const realName = segs[0].startsWith("@") ? `${segs[0]}/${segs[1]}` : segs[0];
    aliases[name] = realName;
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(aliases, null, 2) + "\n");
console.log(`[loom] wrote ${OUT} (${Object.keys(aliases).length} aliases)`);
for (const [hashed, real] of Object.entries(aliases)) {
    console.log(`  ${hashed} -> ${real}`);
}
