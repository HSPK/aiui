import { defineCommand } from "citty";
import { runNext } from "../next-runtime";
import { sharedServerArgs } from "../shared-args";

export const startCommand = defineCommand({
    meta: {
        name: "start",
        description: "Run the production server (next start)",
    },
    args: sharedServerArgs,
    run({ args }) {
        runNext("start", { port: args.port, hostname: args.hostname });
    },
});
