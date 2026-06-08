#!/usr/bin/env node
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// lib/preflight.ts
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
function userCwd() {
  return process.env.AIUI_USER_CWD || process.cwd();
}
function xdgConfigHome() {
  return process.env.XDG_CONFIG_HOME || resolve(homedir(), ".config");
}
function locateConfigFile() {
  const explicit = process.env.AIUI_CONFIG_PATH;
  if (explicit) {
    const p = resolve(userCwd(), explicit);
    return existsSync(p) ? p : null;
  }
  const cwd = userCwd();
  const candidates = [
    ...DEFAULT_FILENAMES.map((f) => resolve(cwd, f)),
    ...DOT_CONFIG_FILENAMES.map((f) => resolve(cwd, ".config", f)),
    ...DOT_CONFIG_FILENAMES.map((f) => resolve(xdgConfigHome(), f))
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}
function interpolateEnv(value) {
  if (typeof value === "string") {
    return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_m, name) => process.env[name] ?? "");
  }
  if (Array.isArray(value)) {
    return value.map((v) => interpolateEnv(v));
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = interpolateEnv(v);
    }
    return out;
  }
  return value;
}
function parseConfigFile(path) {
  const text3 = readFileSync(path, "utf8");
  const raw = path.endsWith(".json") ? JSON.parse(text3) : parseYaml(text3);
  return interpolateEnv(raw ?? {});
}
function setEnvIfMissing(name, value) {
  if (value === void 0 || value === null) return;
  if (process.env[name] !== void 0 && process.env[name] !== "") return;
  const str = typeof value === "string" ? value : String(value);
  if (!str) return;
  process.env[name] = str;
}
function applyConfigEnv(cfg) {
  if (!cfg || typeof cfg !== "object") return [];
  const applied = [];
  const map = (envName, value) => {
    const before = process.env[envName];
    setEnvIfMissing(envName, value);
    if (process.env[envName] !== before) applied.push(envName);
  };
  map("AIUI_MASTER_KEY", cfg.master_key);
  map("AIUI_DB_PATH", cfg.database?.path);
  map("AIUI_ADMIN_USERNAME", cfg.admin?.username);
  map("AIUI_ADMIN_PASSWORD", cfg.admin?.password);
  map("AIUI_SESSION_TTL_DAYS", cfg.session?.ttl_days);
  map("AIUI_MODELS_CACHE_TTL", cfg.cache?.models_ttl_seconds);
  map("AIUI_SERVER_PORT", cfg.server?.port);
  map("AIUI_SERVER_HOSTNAME", cfg.server?.hostname);
  return applied;
}
function preflightFromConfig() {
  const path = locateConfigFile();
  if (!path) return { path: null, cfg: null, applied: [] };
  let cfg;
  try {
    cfg = parseConfigFile(path);
  } catch (err) {
    console.error(`[aiui:config] failed to parse ${path}:`, err);
    return { path, cfg: null, applied: [] };
  }
  const applied = applyConfigEnv(cfg);
  return { path, cfg, applied };
}
var DEFAULT_FILENAMES, DOT_CONFIG_FILENAMES;
var init_preflight = __esm({
  "lib/preflight.ts"() {
    "use strict";
    DEFAULT_FILENAMES = ["aiui.config.yaml", "aiui.config.yml", "aiui.config.json"];
    DOT_CONFIG_FILENAMES = ["aiui.yaml", "aiui.yml", "aiui.json"];
  }
});

// lib/cli/paths.ts
var pkgRoot, PACKAGE_ROOT, USER_CWD;
var init_paths = __esm({
  "lib/cli/paths.ts"() {
    "use strict";
    pkgRoot = process.env.AIUI_PACKAGE_ROOT;
    if (!pkgRoot) {
      throw new Error(
        "AIUI_PACKAGE_ROOT was not set. This module should only be imported by `bin/aiui.ts`."
      );
    }
    PACKAGE_ROOT = pkgRoot;
    USER_CWD = process.cwd();
  }
});

// lib/cli/next-runtime.ts
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { resolve as resolve2 } from "node:path";
function resolveNextBin() {
  const requireFromPkg = createRequire(resolve2(PACKAGE_ROOT, "package.json"));
  try {
    return requireFromPkg.resolve("next/dist/bin/next");
  } catch (err) {
    console.error("Couldn't locate the `next` binary.");
    console.error("If you installed via npm/bunx, this usually means the install was incomplete.");
    console.error("Run `npm install -g aiui` (or your package manager's equivalent) and try again.");
    console.error("Details:", err);
    process.exit(1);
  }
}
function runNext(mode, opts) {
  const nextBin = resolveNextBin();
  process.env.AIUI_USER_CWD = USER_CWD;
  process.env.AIUI_PACKAGE_ROOT = PACKAGE_ROOT;
  const { path: cfgPath, applied } = preflightFromConfig();
  if (cfgPath) {
    const note2 = applied.length > 0 ? ` (env: ${applied.join(", ")})` : "";
    console.log(`[aiui] loaded config from ${cfgPath}${note2}`);
  }
  const args = [mode];
  const port = opts.port || process.env.AIUI_SERVER_PORT || process.env.PORT;
  const host = opts.hostname || process.env.AIUI_SERVER_HOSTNAME;
  if (port) args.push("-p", String(port));
  if (host) args.push("-H", String(host));
  const child = spawn(process.execPath, [nextBin, ...args], {
    cwd: PACKAGE_ROOT,
    env: process.env,
    stdio: "inherit"
  });
  child.on("exit", (code) => process.exit(code ?? 0));
}
var init_next_runtime = __esm({
  "lib/cli/next-runtime.ts"() {
    "use strict";
    init_preflight();
    init_paths();
  }
});

// lib/cli/shared-args.ts
var sharedServerArgs;
var init_shared_args = __esm({
  "lib/cli/shared-args.ts"() {
    "use strict";
    sharedServerArgs = {
      port: {
        type: "string",
        alias: "p",
        description: "Port to listen on (default 3000)"
      },
      hostname: {
        type: "string",
        alias: "H",
        description: "Hostname (default 0.0.0.0)"
      }
    };
  }
});

// lib/cli/commands/dev.ts
import { defineCommand } from "citty";
var devCommand;
var init_dev = __esm({
  "lib/cli/commands/dev.ts"() {
    "use strict";
    init_next_runtime();
    init_shared_args();
    devCommand = defineCommand({
      meta: {
        name: "dev",
        description: "Run the development server (next dev)"
      },
      args: sharedServerArgs,
      run({ args }) {
        runNext("dev", { port: args.port, hostname: args.hostname });
      }
    });
  }
});

// lib/cli/init/prompts.ts
import { cancel, isCancel } from "@clack/prompts";
function bail(reason) {
  cancel(reason);
  process.exit(1);
}
async function ask(promise) {
  const value = await promise;
  if (isCancel(value)) bail("Cancelled.");
  return value;
}
function defined(fn) {
  return (v) => v === void 0 ? void 0 : fn(v);
}
var init_prompts = __esm({
  "lib/cli/init/prompts.ts"() {
    "use strict";
  }
});

// lib/cli/init/provider-prompt.ts
import { password, select, text } from "@clack/prompts";
async function promptProvider() {
  const kind = await ask(
    select({
      message: "First provider (you can add more later in the admin UI)",
      options: [
        { value: "openai", label: "OpenAI / compatible (DeepSeek, vLLM, Ollama, \u2026)" },
        { value: "azure-openai", label: "Azure OpenAI" },
        { value: "azure-foundry", label: "Azure AI Foundry" },
        { value: "skip", label: "Skip \u2014 I'll add providers later" }
      ],
      initialValue: "openai"
    })
  );
  if (kind === "skip") return null;
  const apiKeyRef = await promptApiKey(kind);
  if (kind === "openai") {
    return { kind: "openai", apiKeyRef };
  }
  const baseUrl = await ask(
    text({
      message: kind === "azure-openai" ? "Azure OpenAI endpoint" : "Foundry endpoint",
      placeholder: kind === "azure-openai" ? "https://my-resource.openai.azure.com" : "https://my-foundry.services.ai.azure.com",
      validate: defined((v) => /^https?:\/\//.test(v) ? void 0 : "Must start with http(s)://")
    })
  );
  if (kind === "azure-openai") {
    const apiVersion = await ask(
      text({
        message: "API version",
        initialValue: "2024-10-21"
      })
    );
    return { kind: "azure-openai", baseUrl, apiVersion, apiKeyRef };
  }
  return { kind: "azure-foundry", baseUrl, apiKeyRef };
}
async function promptApiKey(kind) {
  const mode = await ask(
    select({
      message: "API key handling",
      options: [
        { value: "env", label: "Reference an environment variable (recommended)" },
        { value: "inline", label: "Embed literal value in the config file" }
      ],
      initialValue: "env"
    })
  );
  if (mode === "env") {
    const defaultName = kind === "openai" ? "OPENAI_API_KEY" : kind === "azure-openai" ? "AZURE_OPENAI_API_KEY" : "AZURE_FOUNDRY_API_KEY";
    const name = await ask(
      text({
        message: "Env var name",
        placeholder: defaultName,
        initialValue: defaultName,
        validate: defined((v) => /^[A-Z][A-Z0-9_]*$/.test(v) ? void 0 : "Use UPPER_SNAKE_CASE")
      })
    );
    return `\${${name}}`;
  }
  return ask(password({ message: "API key (stored in config file)" }));
}
var init_provider_prompt = __esm({
  "lib/cli/init/provider-prompt.ts"() {
    "use strict";
    init_prompts();
  }
});

// lib/cli/init/template.ts
import { randomBytes } from "node:crypto";
function generateMasterKey() {
  return randomBytes(32).toString("hex");
}
function quoteYamlScalar(value) {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) return value;
  return JSON.stringify(value);
}
function renderProviders(providers) {
  const header = `# ---- Providers ----------------------------------------------------------
# Models are NOT configured here \u2014 they are discovered live from each
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
  const lines = ["providers:"];
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
function buildConfigTemplate(opts) {
  const adminUsername = opts.adminUsername ?? "admin";
  const adminPasswordRef = opts.adminPasswordRef ?? "${AIUI_ADMIN_PASSWORD}";
  const serverBlock = opts.port != null || opts.hostname ? `server:
${opts.port != null ? `  port: ${opts.port}
` : ""}${opts.hostname ? `  hostname: ${quoteYamlScalar(opts.hostname)}
` : ""}` : `# server:
#   port: 3000
#   hostname: 0.0.0.0
`;
  return `# AIUI gateway configuration
# -----------------------------------------------------------------------------
# This file is the single source of truth for everything you can configure on
# the gateway. Strings support \${ENV_VAR} interpolation. Env vars that are
# already set ALWAYS win over values here.
#
# Search order: $AIUI_CONFIG_PATH \u25B8 ./aiui.config.{yaml,yml,json}
#               \u25B8 ./.config/aiui.{yaml,yml,json}
#               \u25B8 $XDG_CONFIG_HOME/aiui.{yaml,yml,json}
#
# KEEP THIS FILE SECRET \u2014 the master_key below decrypts every stored Provider
# API key. Rotating it makes existing encrypted keys unreadable.

master_key: ${quoteYamlScalar(opts.masterKey)}

# ---- Storage ------------------------------------------------------------
# Relative paths resolve against your cwd. Default: <cwd>/data/aiui.db
# database:
#   path: ./data/aiui.db

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
var init_template = __esm({
  "lib/cli/init/template.ts"() {
    "use strict";
  }
});

// lib/cli/init/wizard.ts
import { existsSync as existsSync2, mkdirSync, writeFileSync } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { dirname, resolve as resolve3 } from "node:path";
import { confirm, group, intro, log, note, outro, password as password2, select as select2, text as text2 } from "@clack/prompts";
async function runInteractiveInit(opts) {
  if (opts.print) {
    process.stdout.write(buildConfigTemplate({ masterKey: generateMasterKey() }));
    return;
  }
  if (opts.yes) {
    const outPath2 = resolveOutPath(opts);
    if (existsSync2(outPath2) && !opts.force) {
      console.error(`Refusing to overwrite existing file: ${outPath2}`);
      console.error("Pass --force to replace it.");
      process.exit(1);
    }
    writeOut(outPath2, buildConfigTemplate({ masterKey: generateMasterKey() }));
    return;
  }
  intro("AIUI setup");
  const outPath = await promptOutPath();
  await promptOverwrite(outPath);
  const { username, passwordRef, providerSpec, portStr, hostnameStr } = await group(
    {
      username: () => ask(
        text2({
          message: "Admin username",
          initialValue: "admin",
          validate: defined((v) => v.trim().length >= 2 ? void 0 : "At least 2 characters")
        })
      ),
      passwordRef: () => promptAdminPassword(),
      providerSpec: () => promptProvider(),
      portStr: () => ask(
        text2({
          message: "Port",
          initialValue: "3000",
          validate: defined((v) => /^\d+$/.test(v) ? void 0 : "Must be a number")
        })
      ),
      hostnameStr: () => ask(
        text2({
          message: "Hostname",
          initialValue: "0.0.0.0"
        })
      )
    },
    { onCancel: () => bail("Cancelled.") }
  );
  const port = Number(portStr);
  const providers = providerSpec ? [providerSpec] : [];
  const yaml = buildConfigTemplate({
    masterKey: generateMasterKey(),
    adminUsername: username,
    adminPasswordRef: passwordRef,
    providers,
    port: port === 3e3 ? void 0 : port,
    hostname: hostnameStr === "0.0.0.0" ? void 0 : hostnameStr
  });
  writeOut(outPath, yaml);
  const nextSteps = [];
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
      initialValue: false
    })
  );
  outro(`Config written to ${outPath}`);
  if (startNow) {
    runNext("start", {
      port: port !== 3e3 ? String(port) : void 0,
      hostname: hostnameStr !== "0.0.0.0" ? hostnameStr : void 0
    });
  }
}
async function promptOutPath() {
  const target = await ask(
    select2({
      message: "Where should the config live?",
      options: [
        { value: "project", label: "Project (./aiui.config.yaml)" },
        { value: "user", label: "User (~/.config/aiui.yaml)" },
        { value: "custom", label: "Pick a custom path" }
      ],
      initialValue: "project"
    })
  );
  if (target === "project") return resolve3(USER_CWD, "aiui.config.yaml");
  if (target === "user") {
    const xdg = process.env.XDG_CONFIG_HOME || resolve3(homedir2(), ".config");
    return resolve3(xdg, "aiui.yaml");
  }
  const custom = await ask(
    text2({
      message: "Config path",
      placeholder: resolve3(USER_CWD, "aiui.config.yaml"),
      initialValue: resolve3(USER_CWD, "aiui.config.yaml")
    })
  );
  return resolve3(USER_CWD, custom);
}
async function promptOverwrite(outPath) {
  if (!existsSync2(outPath)) return;
  const overwrite = await ask(
    confirm({
      message: `${outPath} already exists. Overwrite?`,
      initialValue: false
    })
  );
  if (!overwrite) bail("Aborted \u2014 existing config left untouched.");
}
async function promptAdminPassword() {
  const mode = await ask(
    select2({
      message: "Admin password handling",
      options: [
        { value: "env", label: "Reference AIUI_ADMIN_PASSWORD env var (default)" },
        { value: "inline", label: "Set an inline password now (saved in config file)" }
      ],
      initialValue: "env"
    })
  );
  if (mode === "env") return "${AIUI_ADMIN_PASSWORD}";
  return ask(
    password2({
      message: "Admin password",
      validate: defined((v) => v.length >= 8 ? void 0 : "Use at least 8 characters")
    })
  );
}
function resolveOutPath(opts) {
  if (opts.explicitOut) return resolve3(USER_CWD, opts.explicitOut);
  if (opts.user) {
    const xdg = process.env.XDG_CONFIG_HOME || resolve3(homedir2(), ".config");
    return resolve3(xdg, "aiui.yaml");
  }
  return resolve3(USER_CWD, "aiui.config.yaml");
}
function writeOut(outPath, yaml) {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, yaml, { mode: 384 });
  log.success(`Wrote ${outPath}`);
}
var init_wizard = __esm({
  "lib/cli/init/wizard.ts"() {
    "use strict";
    init_next_runtime();
    init_paths();
    init_prompts();
    init_provider_prompt();
    init_template();
  }
});

// lib/cli/commands/init.ts
import { defineCommand as defineCommand2 } from "citty";
var initCommand;
var init_init = __esm({
  "lib/cli/commands/init.ts"() {
    "use strict";
    init_wizard();
    initCommand = defineCommand2({
      meta: {
        name: "init",
        description: "Interactive setup wizard \u2014 generates aiui.config.yaml"
      },
      args: {
        out: {
          type: "string",
          description: "Write to <path> instead of ./aiui.config.yaml"
        },
        user: {
          type: "boolean",
          description: "Write to ~/.config/aiui.yaml (shortcut)"
        },
        force: {
          type: "boolean",
          description: "Overwrite an existing file without prompting"
        },
        yes: {
          type: "boolean",
          alias: "y",
          description: "Skip the wizard \u2014 write a default template (CI-friendly)"
        },
        print: {
          type: "boolean",
          description: "Print the template to stdout instead of writing a file"
        }
      },
      async run({ args }) {
        await runInteractiveInit({
          explicitOut: args.out,
          user: args.user,
          force: args.force,
          yes: args.yes,
          print: args.print
        });
      }
    });
  }
});

// lib/cli/commands/start.ts
import { defineCommand as defineCommand3 } from "citty";
var startCommand;
var init_start = __esm({
  "lib/cli/commands/start.ts"() {
    "use strict";
    init_next_runtime();
    init_shared_args();
    startCommand = defineCommand3({
      meta: {
        name: "start",
        description: "Run the production server (next start)"
      },
      args: sharedServerArgs,
      run({ args }) {
        runNext("start", { port: args.port, hostname: args.hostname });
      }
    });
  }
});

// lib/cli/main.ts
var main_exports = {};
__export(main_exports, {
  main: () => main
});
import { defineCommand as defineCommand4 } from "citty";
var main;
var init_main = __esm({
  "lib/cli/main.ts"() {
    "use strict";
    init_dev();
    init_init();
    init_start();
    main = defineCommand4({
      meta: {
        name: "loom",
        version: "0.1.0",
        description: "Weave LLM providers, MCP tools, and a playground into one OpenAI-compatible surface."
      },
      subCommands: {
        start: startCommand,
        dev: devCommand,
        init: initCommand
      },
      // No subcommand → fall through to `start` so `loom` and
      // `loom -p 4000` Just Work. (citty calls main.run() AFTER the
      // matched subcommand, so we can't use `run` here — that would
      // double-execute on every `loom init` / `loom dev`.)
      default: "start"
    });
  }
});

// bin/aiui.ts
import { dirname as dirname2, resolve as resolve4 } from "node:path";
import { fileURLToPath } from "node:url";
import { runMain } from "citty";
process.env.AIUI_PACKAGE_ROOT = resolve4(dirname2(fileURLToPath(import.meta.url)), "..");
var { main: main2 } = await Promise.resolve().then(() => (init_main(), main_exports));
runMain(main2);
