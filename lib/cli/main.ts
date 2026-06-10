// Root CLI command tree. Adding a new subcommand:
//   1. Create `lib/cli/commands/<name>.ts` exporting a `defineCommand` instance
//   2. Add one entry to `subCommands` below
// That's it — no other file in the codebase changes.

import { defineCommand } from "citty";
import { devCommand } from "./commands/dev";
import { initCommand } from "./commands/init";
import { startCommand } from "./commands/start";
import { updateCommand } from "./commands/update";

export const main = defineCommand({
    meta: {
        name: "loom",
        version: process.env.LOOM_VERSION || "0.0.0-dev",
        description: "Self-hosted AI testing platform — playground, MCP runtime, request logs, and an OpenAI-compatible gateway.",
    },
    subCommands: {
        start: startCommand,
        dev: devCommand,
        init: initCommand,
        update: updateCommand,
    },
    // No subcommand → fall through to `start` so `loom` and
    // `loom -p 4000` Just Work. (citty calls main.run() AFTER the
    // matched subcommand, so we can't use `run` here — that would
    // double-execute on every `loom init` / `loom dev`.)
    default: "start",
});
