import { defineCommand } from "citty";
import { spawn, spawnSync } from "node:child_process";

const RELEASES_API = "https://api.github.com/repos/HSPK/loom/releases/latest";
const ASSET_NAME = "loom.tgz";

interface LatestRelease {
    tag_name: string;
    name: string | null;
    html_url: string;
    assets: Array<{ name: string; browser_download_url: string }>;
}

/** Compare two semver-ish version strings ("1.3.6", "v1.3.7"). Returns
 *  -1 / 0 / +1 like Array.sort. Non-numeric segments fall back to
 *  string compare so pre-release suffixes (e.g. "1.4.0-beta.1") sort
 *  before "1.4.0" — sufficient for "is the latest newer than mine?". */
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

/** Pick a package manager that's actually installed. Honor `--pm` when
 *  the user forces one; otherwise prefer bun (the project's canonical
 *  install path per README) and fall back to npm. */
function resolvePackageManager(pm?: string): { cmd: string; args: (url: string) => string[] } | null {
    if (pm === "bun") return { cmd: "bun", args: (url) => ["add", "-g", url] };
    if (pm === "npm") return { cmd: "npm", args: (url) => ["i", "-g", url] };
    if (which("bun")) return { cmd: "bun", args: (url) => ["add", "-g", url] };
    if (which("npm")) return { cmd: "npm", args: (url) => ["i", "-g", url] };
    return null;
}

async function fetchLatest(): Promise<LatestRelease> {
    const res = await fetch(RELEASES_API, {
        headers: {
            "Accept": "application/vnd.github+json",
            "User-Agent": "loom-cli-update",
        },
    });
    if (!res.ok) {
        throw new Error(`GitHub Releases API returned HTTP ${res.status}: ${res.statusText}`);
    }
    return (await res.json()) as LatestRelease;
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
    },
    async run({ args }) {
        const current = process.env.LOOM_VERSION || "0.0.0-dev";

        console.log(`Current: v${current}`);
        process.stdout.write("Checking for updates... ");

        let release: LatestRelease;
        try {
            release = await fetchLatest();
        } catch (err) {
            console.error("\nFailed to reach GitHub Releases:", (err as Error).message);
            console.error("Check your network or try again later.");
            process.exit(1);
        }

        const latestTag = release.tag_name;
        const latestVersion = latestTag.replace(/^v/, "");
        console.log(`latest: ${latestTag}`);

        const cmp = compareVersions(current, latestVersion);
        if (cmp >= 0) {
            console.log("\n✔ You're on the latest release.");
            return;
        }

        // Prefer the stable-name `loom.tgz` asset (works with
        // `/releases/latest/download/` redirects too) — fall back to
        // the versioned filename if the alias isn't present (older
        // releases predating v1.3.3).
        const aliasAsset = release.assets.find((a) => a.name === ASSET_NAME);
        const versionedAsset = release.assets.find((a) => /^loom-\d.*\.tgz$/.test(a.name));
        const asset = aliasAsset ?? versionedAsset;
        if (!asset) {
            console.error("\nNo loom tarball found on the latest release — please report this.");
            console.error(`Release page: ${release.html_url}`);
            process.exit(1);
        }

        console.log(`\nA newer version is available: v${current} → ${latestTag}`);
        console.log(`Release notes: ${release.html_url}`);

        if (args.check) {
            console.log("\n(--check) skipping install.");
            return;
        }

        const pm = resolvePackageManager(typeof args.pm === "string" ? args.pm : undefined);
        if (!pm) {
            console.error("\nNeither `bun` nor `npm` is on your PATH — can't auto-install.");
            console.error(`Run manually: bun add -g ${asset.browser_download_url}`);
            process.exit(1);
        }

        const installArgs = pm.args(asset.browser_download_url);
        const cmdline = `${pm.cmd} ${installArgs.join(" ")}`;

        if (!args.yes) {
            const confirmed = await confirmPrompt(`\nRun: ${cmdline}\nProceed? [y/N] `);
            if (!confirmed) {
                console.log("Aborted.");
                return;
            }
        } else {
            console.log(`\nRunning: ${cmdline}`);
        }

        const child = spawn(pm.cmd, installArgs, { stdio: "inherit" });
        const exitCode = await new Promise<number>((resolve) => {
            child.on("exit", (code) => resolve(code ?? 1));
            child.on("error", (err) => {
                console.error(`\nFailed to spawn ${pm.cmd}:`, err.message);
                resolve(1);
            });
        });

        if (exitCode === 0) {
            console.log(`\n✔ Updated to ${latestTag}. Run \`loom --version\` to verify.`);
        } else {
            console.error(`\n✗ Install failed with exit code ${exitCode}.`);
            process.exit(exitCode);
        }
    },
});

/** Minimal y/N prompt — citty / @clack are overkill for a single
 *  binary question and would drag a UI library into the update path. */
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
