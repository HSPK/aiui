// Root CLI command tree. Adding a new subcommand:
//   1. Create `lib/cli/commands/<name>.ts` exporting a `defineCommand` instance
//   2. Add one entry to `subCommands` below
// That's it — no other file in the codebase changes.

import { defineCommand } from "citty";
import { devCommand } from "./commands/dev";
import { initCommand } from "./commands/init";
import { startCommand } from "./commands/start";

export const main = defineCommand({
    meta: {
        name: "loom",
        version: "0.1.0",
        description: "Weave LLM providers, MCP tools, and a playground into one OpenAI-compatible surface.",
    },
    subCommands: {
        start: startCommand,
        dev: devCommand,
        init: initCommand,
    },
    // No subcommand → fall through to `start` so `loom` and
    // `loom -p 4000` Just Work. (citty calls main.run() AFTER the
    // matched subcommand, so we can't use `run` here — that would
    // double-execute on every `loom init` / `loom dev`.)
    default: "start",
});
