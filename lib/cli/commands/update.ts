import { defineCommand } from "citty";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const RELEASES_API = "https://api.github.com/repos/HSPK/loom/releases/latest";
const LATEST_TARBALL_URL = "https://github.com/HSPK/loom/releases/latest/download/loom.tgz";

interface LatestRelease {
    tag_name: string;
    name: string | null;
    html_url: string;
    published_at: string;
    assets: Array<{ name: string; browser_download_url: string }>;
}

// Minimal ANSI styling — no external deps. NO_COLOR + non-TTY fall
// back to plain text so the output stays readable in piped logs.
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const style = {
    bold: (s: string) => useColor ? `\x1b[1m${s}\x1b[22m` : s,
    dim: (s: string) => useColor ? `\x1b[2m${s}\x1b[22m` : s,
    cyan: (s: string) => useColor ? `\x1b[36m${s}\x1b[39m` : s,
    green: (s: string) => useColor ? `\x1b[32m${s}\x1b[39m` : s,
    yellow: (s: string) => useColor ? `\x1b[33m${s}\x1b[39m` : s,
    red: (s: string) => useColor ? `\x1b[31m${s}\x1b[39m` : s,
    magenta: (s: string) => useColor ? `\x1b[35m${s}\x1b[39m` : s,
};
const sym = {
    ok: useColor ? "✓" : "[ok]",
    warn: useColor ? "⚠" : "[warn]",
    err: useColor ? "✗" : "[x]",
    arrow: useColor ? "→" : "->",
    bullet: useColor ? "•" : "-",
};

/** Compare two semver-ish version strings ("1.3.6", "v1.3.7"). */
function compareVersions(a: string, b: string): number {
    const norm = (v: string) => v.replace(/^v/, "").split(/[-.]/);
    const pa = norm(a);
    const pb = norm(b);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
        const na = Number(pa[i]);
        const nb = Number(pb[i]);
        if (Number.isFinite(na) && Number.isFinite(nb)) {
            if (na !== nb) return na < nb ? -1 : 1;
            continue;
        }
        const sa = pa[i] ?? "";
        const sb = pb[i] ?? "";
        if (sa !== sb) return sa < sb ? -1 : 1;
    }
    return 0;
}

function which(cmd: string): boolean {
    const result = spawnSync(process.platform === "win32" ? "where" : "which", [cmd], {
        stdio: "ignore",
    });
    return result.status === 0;
}

interface PackageManager {
    cmd: string;
    install: (url: string) => string[];
    remove: () => string[];
}

/** Pick a package manager that's actually installed. */
function resolvePackageManager(pm?: string): PackageManager | null {
    if (pm === "bun") return { cmd: "bun", install: (url) => ["add", "-g", url], remove: () => ["remove", "-g", "loom"] };
    if (pm === "npm") return { cmd: "npm", install: (url) => ["i", "-g", url], remove: () => ["rm", "-g", "loom"] };
    if (which("bun")) return { cmd: "bun", install: (url) => ["add", "-g", url], remove: () => ["remove", "-g", "loom"] };
    if (which("npm")) return { cmd: "npm", install: (url) => ["i", "-g", url], remove: () => ["rm", "-g", "loom"] };
    return null;
}

async function fetchLatest(): Promise<LatestRelease> {
    const res = await fetch(RELEASES_API, {
        headers: { Accept: "application/vnd.github+json", "User-Agent": "loom-cli-update" },
    });
    if (!res.ok) {
        throw new Error(`GitHub Releases API returned HTTP ${res.status}: ${res.statusText}`);
    }
    return (await res.json()) as LatestRelease;
}

/** Render a horizontally-padded box header. */
function header(title: string): string {
    const pad = "  ";
    return [
        style.dim("┌" + "─".repeat(title.length + pad.length * 2) + "┐"),
        style.dim("│") + pad + style.bold(title) + pad + style.dim("│"),
        style.dim("└" + "─".repeat(title.length + pad.length * 2) + "┘"),
    ].join("\n");
}

/** Spawn a child process, inheriting stdio, returning its exit code. */
function run(cmd: string, args: string[]): Promise<number> {
    return new Promise((resolve) => {
        const child = spawn(cmd, args, { stdio: "inherit" });
        child.on("exit", (code) => resolve(code ?? 1));
        child.on("error", (err) => {
            console.error(style.red(`\n${sym.err} Failed to spawn ${cmd}: ${err.message}`));
            resolve(1);
        });
    });
}

function confirmPrompt(question: string): Promise<boolean> {
    return new Promise((resolve) => {
        process.stdout.write(question);
        process.stdin.setEncoding("utf8");
        process.stdin.resume();
        const onData = (chunk: string) => {
            process.stdin.pause();
            process.stdin.off("data", onData);
            const answer = chunk.trim().toLowerCase();
            resolve(answer === "y" || answer === "yes");
        };
        process.stdin.on("data", onData);
    });
}

/** Tiny spinner for the API check. Stops on resolve/reject. */
async function withSpinner<T>(label: string, fn: () => Promise<T>): Promise<T> {
    if (!useColor) {
        process.stdout.write(`${label}... `);
        try {
            const v = await fn();
            process.stdout.write("done\n");
            return v;
        } catch (err) {
            process.stdout.write("failed\n");
            throw err;
        }
    }
    const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    let i = 0;
    process.stdout.write(`${style.cyan(frames[0])} ${label}`);
    const id = setInterval(() => {
        i = (i + 1) % frames.length;
        process.stdout.write(`\r${style.cyan(frames[i])} ${label}`);
    }, 80);
    try {
        const v = await fn();
        clearInterval(id);
        process.stdout.write(`\r${style.green(sym.ok)} ${label}\n`);
        return v;
    } catch (err) {
        clearInterval(id);
        process.stdout.write(`\r${style.red(sym.err)} ${label}\n`);
        throw err;
    }
}

export const updateCommand = defineCommand({
    meta: {
        name: "update",
        description: "Check for newer Loom releases and re-install via your package manager.",
    },
    args: {
        check: {
            type: "boolean",
            description: "Only check for updates — don't install",
        },
        pm: {
            type: "string",
            description: "Force a package manager (bun | npm). Default: auto-detect (prefers bun)",
        },
        yes: {
            type: "boolean",
            alias: "y",
            description: "Skip the install confirmation prompt",
        },
        clean: {
            type: "boolean",
            description: "Remove the existing global install before re-installing (clears stale entries)",
        },
    },
    async run({ args }) {
        const current = process.env.LOOM_VERSION || "0.0.0-dev";

        console.log("");
        console.log(header("Loom Update"));
        console.log("");
        console.log(`  ${style.dim("Installed")}   ${style.bold("v" + current)}`);

        let release: LatestRelease | null = null;
        try {
            release = await withSpinner("Checking GitHub Releases", fetchLatest);
        } catch (err) {
            console.error(style.red(`\n${sym.err} Failed to reach GitHub: ${(err as Error).message}`));
            console.error(style.dim("  Check your network or try again later."));
            process.exit(1);
        }
        // Explicit guard instead of trusting process.exit() to have halted
        // us — everything below dereferences `release`.
        if (!release) return;

        const latestTag = release.tag_name;
        const latestVersion = latestTag.replace(/^v/, "");
        const publishedRel = formatRelativeTime(release.published_at);
        console.log(`  ${style.dim("Latest")}      ${style.bold(latestTag)} ${style.dim(`(${publishedRel})`)}`);
        console.log("");

        const cmp = compareVersions(current, latestVersion);
        if (cmp > 0) {
            console.log(`  ${style.yellow(sym.warn)} You're running ${style.bold("v" + current)} which is newer than the latest release.`);
            console.log(style.dim(`     Probably a dev build — nothing to do.\n`));
            return;
        }
        if (cmp === 0) {
            console.log(`  ${style.green(sym.ok)} ${style.bold("Up to date")} — no newer release available.\n`);
            return;
        }

        console.log(`  ${style.cyan(sym.bullet)} ${style.bold("v" + current)} ${style.dim(sym.arrow)} ${style.bold(style.cyan(latestTag))}`);
        console.log(`  ${style.dim("Release notes:")} ${style.cyan(release.html_url)}`);
        console.log("");

        if (args.check) {
            console.log(style.dim(`  (${sym.bullet}--check) Skipping install. Run \`loom update\` to install.\n`));
            return;
        }

        const pm = resolvePackageManager(typeof args.pm === "string" ? args.pm : undefined);
        if (!pm) {
            console.error(style.red(`\n${sym.err} Neither \`bun\` nor \`npm\` found on PATH.`));
            console.error(style.dim(`  Install manually: bun add -g ${LATEST_TARBALL_URL}\n`));
            process.exit(1);
            // Belt and braces: everything below dereferences `pm`.
            return;
        }

        // ALWAYS install via the stable latest URL — it dedups against
        // any prior global install (which also used this URL per the
        // README), avoiding bun's "dependency loop" when the same
        // package name is recorded with two different specifiers (e.g.
        // versioned URL vs latest URL). Versioned URLs are still
        // documented for users who want to pin a specific release —
        // but `loom update` itself sticks to latest for safety.
        const installUrl = LATEST_TARBALL_URL;
        const installCmdline = `${pm.cmd} ${pm.install(installUrl).join(" ")}`;

        console.log(`  ${style.dim("Package manager:")} ${style.bold(pm.cmd)}`);
        if (args.clean) {
            console.log(`  ${style.dim("Pre-clean:")} ${style.bold(`${pm.cmd} ${pm.remove().join(" ")}`)}`);
        }
        console.log(`  ${style.dim("Install:")} ${style.bold(installCmdline)}`);
        console.log("");

        if (!args.yes) {
            const ok = await confirmPrompt(`${style.dim("?")} Proceed? ${style.dim("[y/N]")} `);
            if (!ok) {
                console.log(style.dim("\nAborted.\n"));
                return;
            }
            console.log("");
        }

        // Best-effort pre-clean when --clean is passed. Non-fatal — a
        // first-time install via a different PM would otherwise abort
        // here before we've even tried to install the new version.
        if (args.clean) {
            console.log(style.dim(`Running pre-clean...`));
            await run(pm.cmd, pm.remove());
            console.log("");
        }

        // Auto-tidy the bun global package.json + lockfile BEFORE the
        // install. Bun appends a new "loom" entry without deduping the
        // existing one each time we install via URL — left alone, the
        // global package.json accumulates 2, 3, 5 duplicate "loom":
        // entries and bun spams "Duplicate key" warnings on every
        // command (eventually causing a real DependencyLoop on bun
        // <1.3.14 — see R20 / v1.3.x history). Cleaning silently
        // before bun even runs keeps the output clean and the lockfile
        // tidy. No-op when bun isn't the PM or files don't exist.
        if (pm.cmd === "bun") tidyBunGlobals();

        console.log(style.dim(`Running install...`));
        const code = await run(pm.cmd, pm.install(installUrl));

        // ...and once more AFTER install to clean any duplicates the
        // bun install itself appended.
        if (pm.cmd === "bun") tidyBunGlobals();

        if (code === 0) {
            console.log("");
            console.log(`  ${style.green(sym.ok)} ${style.bold(`Updated to ${latestTag}`)}`);
            console.log(`  ${style.dim("Verify:")} ${style.bold("loom --version")}\n`);
        } else {
            console.log("");
            console.error(style.red(`  ${sym.err} Install failed with exit code ${code}.`));
            if (!args.clean) {
                console.error(style.dim(`  Tip: retry with ${style.bold("loom update --clean")} to remove the existing install first`));
                console.error(style.dim(`       (helps when stale duplicate entries cause a dependency loop).\n`));
            }
            process.exit(code);
        }
    },
});

/** Dedupe duplicate keys in bun's global package.json + lockfile.
 *
 *  Bun appends a new line for the same package each time you install
 *  via a remote URL — even when the URL is identical to the existing
 *  entry. After N installs the global package.json has N "loom"
 *  entries, which (a) spams "Duplicate key" warnings on every bun
 *  command, (b) historically caused an actual DependencyLoop error
 *  (R20 v1.3.x). JSON.parse takes the LAST duplicate value, so a
 *  parse-and-restringify cycle naturally dedupes. Lockfile gets the
 *  same treatment — same line-level duplication pattern there.
 *
 *  Silent + best-effort: if files don't exist (npm-only setup, fresh
 *  bun install) or are unparseable (mid-install corruption), bail
 *  without touching anything. Never fails the update flow. */
function tidyBunGlobals(): void {
    const dir = resolve(homedir(), ".bun", "install", "global");
    tidyJsonFile(resolve(dir, "package.json"));
    tidyJsonFile(resolve(dir, "bun.lock"));
}

function tidyJsonFile(path: string): void {
    if (!existsSync(path)) return;
    let raw: string;
    try {
        raw = readFileSync(path, "utf8");
    } catch {
        return;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        // bun.lock isn't strict JSON (it's JSONC with comments). Skip
        // unparseable files — leaving duplicates is better than
        // mangling the lockfile.
        return;
    }
    const rewritten = JSON.stringify(parsed, null, 2) + "\n";
    if (rewritten === raw) return;
    try {
        writeFileSync(path, rewritten, "utf8");
    } catch {
        /* read-only fs etc. — ignore */
    }
}

/** Render a published-at ISO timestamp as a friendly relative time. */
function formatRelativeTime(iso: string): string {
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return iso;
    const delta = Date.now() - then;
    const sec = Math.round(delta / 1000);
    if (sec < 60) return `${sec}s ago`;
    const min = Math.round(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.round(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.round(hr / 24);
    if (day < 30) return `${day}d ago`;
    const mo = Math.round(day / 30);
    if (mo < 12) return `${mo}mo ago`;
    const yr = Math.round(mo / 12);
    return `${yr}y ago`;
}
