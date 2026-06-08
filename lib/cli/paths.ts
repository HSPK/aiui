// Constants shared across CLI subcommands.
//
// PACKAGE_ROOT is set by the entry shim (`bin/aiui.ts`) BEFORE any
// other CLI module is imported. Esbuild bundles everything into
// `bin/aiui.mjs`, so we can't reliably derive the package root from
// `import.meta.url` in arbitrary modules — it always points back at
// the bundle. Letting the entry compute it once and stash it in an
// env var sidesteps the issue.

const pkgRoot = process.env.AIUI_PACKAGE_ROOT;
if (!pkgRoot) {
    throw new Error(
        "AIUI_PACKAGE_ROOT was not set. This module should only be imported by `bin/aiui.ts`.",
    );
}

/** Filesystem root of the installed `aiui` package. */
export const PACKAGE_ROOT = pkgRoot;

/** Directory the user invoked `aiui` from — config / DB resolve here. */
export const USER_CWD = process.cwd();

