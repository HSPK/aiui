// The interactive `aiui init` flow. Drives a sequence of clack
// prompts, renders the result via `template.ts`, optionally chains
// into `aiui start`. The matching defineCommand wrapper (with arg
// descriptors) lives in `lib/cli/commands/init.ts`.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { confirm, group, intro, log, note, outro, password, select, text } from "@clack/prompts";

import { runNext } from "../next-runtime";
import { USER_CWD } from "../paths";
import { ask, bail, defined } from "./prompts";
import { promptProvider } from "./provider-prompt";
import { buildConfigTemplate, generateMasterKey } from "./template";
import type { ProviderEntry } from "./types";

export interface InitFlowOptions {
    explicitOut?: string;
    user?: boolean;
    force?: boolean;
    yes?: boolean;
    print?: boolean;
}

export async function runInteractiveInit(opts: InitFlowOptions): Promise<void> {
    // Quick non-interactive paths bypass the wizard entirely.
    if (opts.print) {
        process.stdout.write(buildConfigTemplate({ masterKey: generateMasterKey() }));
        return;
    }
    if (opts.yes) {
        const outPath = resolveOutPath(opts);
        if (existsSync(outPath) && !opts.force) {
            console.error(`Refusing to overwrite existing file: ${outPath}`);
            console.error("Pass --force to replace it.");
            process.exit(1);
        }
        writeOut(outPath, buildConfigTemplate({ masterKey: generateMasterKey() }));
        return;
    }

    intro("AIUI setup");

    const outPath = await promptOutPath();
    await promptOverwrite(outPath);

    const { username, passwordRef, providerSpec, portStr, hostnameStr } = await group(
        {
            username: () =>
                ask(
                    text({
                        message: "Admin username",
                        initialValue: "admin",
                        validate: defined((v) => (v.trim().length >= 2 ? undefined : "At least 2 characters")),
                    }),
                ),
            passwordRef: () => promptAdminPassword(),
            providerSpec: () => promptProvider(),
            portStr: () =>
                ask(
                    text({
                        message: "Port",
                        initialValue: "3000",
                        validate: defined((v) => (/^\d+$/.test(v) ? undefined : "Must be a number")),
                    }),
                ),
            hostnameStr: () =>
                ask(
                    text({
                        message: "Hostname",
                        initialValue: "0.0.0.0",
                    }),
                ),
        },
        { onCancel: () => bail("Cancelled.") },
    );

    const port = Number(portStr);
    const providers: ProviderEntry[] = providerSpec ? [providerSpec] : [];
    const yaml = buildConfigTemplate({
        masterKey: generateMasterKey(),
        adminUsername: username,
        adminPasswordRef: passwordRef,
        providers,
        port: port === 3000 ? undefined : port,
        hostname: hostnameStr === "0.0.0.0" ? undefined : hostnameStr,
    });
    writeOut(outPath, yaml);

    const nextSteps: string[] = [];
    if (passwordRef.startsWith("${")) {
        nextSteps.push(`export ${passwordRef.slice(2, -1)}='choose a strong password'`);
    }
    if (providerSpec && providerSpec.apiKeyRef.startsWith("${")) {
        nextSteps.push(`export ${providerSpec.apiKeyRef.slice(2, -1)}='<your-key>'`);
    }
    nextSteps.push("aiui start");
    note(nextSteps.join("\n"), "Next steps");

    const startNow = await ask(
        confirm({
            message: "Start the server now?",
            initialValue: false,
        }),
    );
    outro(`Config written to ${outPath}`);

    if (startNow) {
        runNext("start", {
            port: port !== 3000 ? String(port) : undefined,
            hostname: hostnameStr !== "0.0.0.0" ? hostnameStr : undefined,
        });
    }
}

// ---------------------------------------------------------------------------
// Step helpers
// ---------------------------------------------------------------------------

async function promptOutPath(): Promise<string> {
    const target = await ask(
        select({
            message: "Where should the config live?",
            options: [
                { value: "project", label: "Project (./aiui.config.yaml)" },
                { value: "user", label: "User (~/.config/aiui.yaml)" },
                { value: "custom", label: "Pick a custom path" },
            ],
            initialValue: "project" as const,
        }),
    );

    if (target === "project") return resolve(USER_CWD, "aiui.config.yaml");
    if (target === "user") {
        const xdg = process.env.XDG_CONFIG_HOME || resolve(homedir(), ".config");
        return resolve(xdg, "aiui.yaml");
    }
    const custom = await ask(
        text({
            message: "Config path",
            placeholder: resolve(USER_CWD, "aiui.config.yaml"),
            initialValue: resolve(USER_CWD, "aiui.config.yaml"),
        }),
    );
    return resolve(USER_CWD, custom);
}

async function promptOverwrite(outPath: string): Promise<void> {
    if (!existsSync(outPath)) return;
    const overwrite = await ask(
        confirm({
            message: `${outPath} already exists. Overwrite?`,
            initialValue: false,
        }),
    );
    if (!overwrite) bail("Aborted — existing config left untouched.");
}

async function promptAdminPassword(): Promise<string> {
    const mode = await ask(
        select({
            message: "Admin password handling",
            options: [
                { value: "env", label: "Reference AIUI_ADMIN_PASSWORD env var (default)" },
                { value: "inline", label: "Set an inline password now (saved in config file)" },
            ],
            initialValue: "env" as const,
        }),
    );
    if (mode === "env") return "${AIUI_ADMIN_PASSWORD}";
    return ask(
        password({
            message: "Admin password",
            validate: defined((v) => (v.length >= 8 ? undefined : "Use at least 8 characters")),
        }),
    );
}

export function resolveOutPath(opts: InitFlowOptions): string {
    if (opts.explicitOut) return resolve(USER_CWD, opts.explicitOut);
    if (opts.user) {
        const xdg = process.env.XDG_CONFIG_HOME || resolve(homedir(), ".config");
        return resolve(xdg, "aiui.yaml");
    }
    return resolve(USER_CWD, "aiui.config.yaml");
}

export function writeOut(outPath: string, yaml: string): void {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, yaml, { mode: 0o600 });
    log.success(`Wrote ${outPath}`);
}
