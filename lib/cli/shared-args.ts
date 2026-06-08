// Args shared by `start` and `dev`. citty supports `as const` arg
// descriptors directly — we lift them out so adding a flag (e.g.
// --keep-alive) flows through both subcommands at once.

export const sharedServerArgs = {
    port: {
        type: "string",
        alias: "p",
        description: "Port to listen on (default 3000)",
    },
    hostname: {
        type: "string",
        alias: "H",
        description: "Hostname (default 0.0.0.0)",
    },
} as const;
