// Recreates the `.next/node_modules/<pkg>-<hash>` symlinks that Turbopack
// hard-codes into the built chunks for `serverExternalPackages`. npm pack
// drops any `node_modules` directory from the tarball, so on a fresh install
// these aliases are missing — and bun additionally blocks postinstall scripts
// by default, so we can't rely on the postinstall hook either. Running this
// at CLI startup is the only path that works on every package manager.
//
// Safe and cheap to run on every invocation: existing valid symlinks are
// left untouched. No-op when the manifest is absent (source repo before
// first build).

import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, relative, resolve } from "node:path";
import { PACKAGE_ROOT } from "./paths";

const MANIFEST = resolve(PACKAGE_ROOT, ".next/external-aliases.json");
const MODULES_DIR = resolve(PACKAGE_ROOT, ".next/node_modules");

export function ensureExternalAliases(): void {
    if (!existsSync(MANIFEST)) return;

    let aliases: Record<string, string>;
    try {
        aliases = JSON.parse(readFileSync(MANIFEST, "utf8"));
    } catch (err) {
        console.warn(`[loom] failed to parse ${MANIFEST}:`, (err as Error).message);
        return;
    }
    if (!aliases || typeof aliases !== "object" || Object.keys(aliases).length === 0) return;

    mkdirSync(MODULES_DIR, { recursive: true });
    const requireFromPkg = createRequire(resolve(PACKAGE_ROOT, "package.json"));

    let created = 0;
    for (const [hashed, real] of Object.entries(aliases)) {
        const linkPath = resolve(MODULES_DIR, hashed);

        try {
            const stat = lstatSync(linkPath);
            if (stat.isSymbolicLink()) {
                const target = resolve(MODULES_DIR, readlinkSync(linkPath));
                if (existsSync(target)) continue;
            }
            rmSync(linkPath, { recursive: true, force: true });
        } catch {
            // Doesn't exist yet — fall through to create.
        }

        let realPkgDir: string;
        try {
            realPkgDir = dirname(requireFromPkg.resolve(`${real}/package.json`));
        } catch (err) {
            console.warn(`[loom] couldn't resolve "${real}" for alias "${hashed}": ${(err as Error).message}`);
            continue;
        }

        const target = relative(MODULES_DIR, realPkgDir);
        try {
            symlinkSync(target, linkPath, "junction");
            created++;
        } catch (err) {
            console.warn(`[loom] failed to symlink "${hashed}" -> "${target}": ${(err as Error).message}`);
        }
    }

    if (created > 0) {
        console.log(`[loom] linked ${created} external package alias${created === 1 ? "" : "es"}`);
    }
}
