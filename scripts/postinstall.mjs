#!/usr/bin/env node
// Install-time: recreate the .next/node_modules/<pkg>-<hash> symlinks that
// Turbopack hard-codes into the built chunks. npm pack drops `node_modules`
// directories from the tarball, so these symlinks are missing on the user's
// machine. We read the manifest written at build time, locate each real
// package via createRequire, and rebuild the symlink.
//
// Safe to run multiple times: existing valid symlinks are left untouched,
// missing manifests skipped silently (e.g. when this script runs inside the
// source repo before the first build).

import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(HERE, "..");
const MANIFEST = resolve(PKG_ROOT, ".next/external-aliases.json");
const MODULES_DIR = resolve(PKG_ROOT, ".next/node_modules");

if (!existsSync(MANIFEST)) {
    process.exit(0);
}

let aliases;
try {
    aliases = JSON.parse(readFileSync(MANIFEST, "utf8"));
} catch (err) {
    console.error(`[loom] failed to parse ${MANIFEST}:`, err.message);
    process.exit(0);
}

if (!aliases || typeof aliases !== "object" || Object.keys(aliases).length === 0) {
    process.exit(0);
}

mkdirSync(MODULES_DIR, { recursive: true });

const requireFromPkg = createRequire(resolve(PKG_ROOT, "package.json"));

let created = 0;
let skipped = 0;
for (const [hashed, real] of Object.entries(aliases)) {
    const linkPath = resolve(MODULES_DIR, hashed);
    let realPkgDir;
    try {
        // Resolve the real package's package.json to find its directory.
        const pkgJsonPath = requireFromPkg.resolve(`${real}/package.json`);
        realPkgDir = dirname(pkgJsonPath);
    } catch (err) {
        console.warn(`[loom] couldn't resolve "${real}" for alias "${hashed}": ${err.message}`);
        continue;
    }

    // If the link already exists and points somewhere valid, leave it.
    try {
        const stat = lstatSync(linkPath);
        if (stat.isSymbolicLink()) {
            const target = resolve(MODULES_DIR, readlinkSync(linkPath));
            if (existsSync(target)) {
                skipped++;
                continue;
            }
        }
        rmSync(linkPath, { recursive: true, force: true });
    } catch {
        // Doesn't exist — fine.
    }

    // Symlink with junction type so Windows works without admin rights.
    const target = relative(MODULES_DIR, realPkgDir);
    try {
        symlinkSync(target, linkPath, "junction");
        created++;
    } catch (err) {
        console.warn(`[loom] failed to symlink "${hashed}" -> "${target}": ${err.message}`);
    }
}

if (created > 0 || skipped > 0) {
    console.log(`[loom] external aliases: ${created} created, ${skipped} already in place`);
}
