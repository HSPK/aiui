import { defineCommand } from "citty";
import { runNext } from "../next-runtime";
import { sharedServerArgs } from "../shared-args";

export const devCommand = defineCommand({
    meta: {
        name: "dev",
        description: "Run the development server (next dev)",
    },
    args: sharedServerArgs,
    run({ args }) {
        runNext("dev", { port: args.port, hostname: args.hostname });
    },
});
