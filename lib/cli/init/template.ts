// `loom.config.yaml` template builder. Pure functions over inputs —
// no I/O, no prompts — so it's trivially testable and the wizard /
// non-interactive --yes path / --print all share the same output.

import { randomBytes } from "node:crypto";
import type { ProviderEntry } from "./types";

export interface ConfigTemplateOptions {
    masterKey: string;
    adminUsername?: string;
    adminPasswordRef?: string;
    providers?: ProviderEntry[];
    port?: number;
    hostname?: string;
}

export function generateMasterKey(): string {
    return randomBytes(32).toString("hex");
}

function quoteYamlScalar(value: string): string {
    // Plain identifiers stay unquoted; anything with shell-meta or
    // interpolation braces survives best as a double-quoted scalar.
    if (/^[A-Za-z0-9_./:-]+$/.test(value)) return value;
    return JSON.stringify(value);
}

function renderProviders(providers: ProviderEntry[] | undefined): string {
    const header = `# ---- Providers ----------------------------------------------------------
# Models are NOT configured here — they are discovered live from each
# provider's /models endpoint. Use the admin UI to register per-model
# overrides (Azure deployment names, display-name aliases, context-window
# pinning).
`;
    if (!providers || providers.length === 0) {
        return `${header}# providers:
#   - name: openai
#     base_url: https://api.openai.com/v1
#     api_key: \${OPENAI_API_KEY}
`;
    }
    const lines: string[] = ["providers:"];
    for (const p of providers) {
        switch (p.kind) {
            case "openai":
                lines.push("  - name: openai");
                lines.push("    base_url: https://api.openai.com/v1");
                lines.push(`    api_key: ${quoteYamlScalar(p.apiKeyRef)}`);
                lines.push("    document_page: https://platform.openai.com/docs");
                break;
            case "azure-openai":
                lines.push("  - name: azure-openai");
                lines.push("    adapter_id: azure-openai");
                lines.push(`    base_url: ${quoteYamlScalar(p.baseUrl)}`);
                lines.push(`    api_version: ${quoteYamlScalar(p.apiVersion)}`);
                lines.push(`    api_key: ${quoteYamlScalar(p.apiKeyRef)}`);
                break;
            case "azure-foundry":
                lines.push("  - name: foundry");
                lines.push("    adapter_id: azure-foundry");
                lines.push(`    base_url: ${quoteYamlScalar(p.baseUrl)}`);
                lines.push(`    api_key: ${quoteYamlScalar(p.apiKeyRef)}`);
                break;
        }
        lines.push("");
    }
    return `${header}${lines.join("\n")}`;
}

export function buildConfigTemplate(opts: ConfigTemplateOptions): string {
    const adminUsername = opts.adminUsername ?? "admin";
    const adminPasswordRef = opts.adminPasswordRef ?? "${LOOM_ADMIN_PASSWORD}";
    const serverBlock =
        opts.port != null || opts.hostname
            ? `server:\n${opts.port != null ? `  port: ${opts.port}\n` : ""}${opts.hostname ? `  hostname: ${quoteYamlScalar(opts.hostname)}\n` : ""}`
            : `# server:\n#   port: 3000\n#   hostname: 0.0.0.0\n`;

    return `# Loom gateway configuration
# -----------------------------------------------------------------------------
# This file is the single source of truth for everything you can configure on
# the gateway. Strings support \${ENV_VAR} interpolation. Env vars that are
# already set ALWAYS win over values here.
#
# Search order: \$LOOM_CONFIG_PATH ▸ ./loom.config.{yaml,yml,json}
#               ▸ ./.config/loom.{yaml,yml,json}
#               ▸ \$XDG_CONFIG_HOME/loom.{yaml,yml,json}
#
# KEEP THIS FILE SECRET — the master_key below decrypts every stored Provider
# API key. Rotating it makes existing encrypted keys unreadable.

master_key: ${quoteYamlScalar(opts.masterKey)}

# ---- Storage ------------------------------------------------------------
# Relative paths resolve against your cwd. Default: <cwd>/data/loom.db
# database:
#   path: ./data/loom.db

# ---- Server -------------------------------------------------------------
${serverBlock}
# ---- Admin bootstrap ----------------------------------------------------
# Created on first boot if the users table is empty.
admin:
  username: ${quoteYamlScalar(adminUsername)}
  password: ${quoteYamlScalar(adminPasswordRef)}

# ---- Session ------------------------------------------------------------
# session:
#   ttl_days: 30

# ---- Caching ------------------------------------------------------------
# cache:
#   models_ttl_seconds: 300

${renderProviders(opts.providers)}`;
}
