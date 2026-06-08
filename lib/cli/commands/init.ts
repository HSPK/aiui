import { defineCommand } from "citty";
import { runInteractiveInit } from "../init/wizard";

export const initCommand = defineCommand({
    meta: {
        name: "init",
        description: "Interactive setup wizard — generates aiui.config.yaml",
    },
    args: {
        out: {
            type: "string",
            description: "Write to <path> instead of ./aiui.config.yaml",
        },
        user: {
            type: "boolean",
            description: "Write to ~/.config/aiui.yaml (shortcut)",
        },
        force: {
            type: "boolean",
            description: "Overwrite an existing file without prompting",
        },
        yes: {
            type: "boolean",
            alias: "y",
            description: "Skip the wizard — write a default template (CI-friendly)",
        },
        print: {
            type: "boolean",
            description: "Print the template to stdout instead of writing a file",
        },
    },
    async run({ args }) {
        await runInteractiveInit({
            explicitOut: args.out,
            user: args.user,
            force: args.force,
            yes: args.yes,
            print: args.print,
        });
    },
});
