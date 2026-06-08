import "server-only";
import type { McpPreset } from "@/lib/schemas/mcp";

/**
 * Hardcoded catalogue of well-known MCP servers. One-click presets the
 * admin can import into the create-form, then top up with any required
 * secrets / paths (the `slots` array lists what they need to fill).
 *
 * Source: the official `@modelcontextprotocol/servers` monorepo +
 * community standards. Versions / package names tracked in the upstream
 * docs; we don't pin a version so users always get the latest.
 *
 * Adding a preset = one entry below. Keep names canonical (matches the
 * npm package suffix); add a `slots` entry for any field the user has
 * to fill before save.
 */

export const MCP_PRESETS: McpPreset[] = [
    {
        id: "filesystem",
        name: "filesystem",
        description: "Read / write access to an allowed local directory.",
        transport: "stdio",
        config: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem", "<ALLOWED_PATH>"],
            env: {},
        },
        slots: [
            { path: "args[2]", label: "Allowed root path", kind: "path" },
        ],
        homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",
    },
    {
        id: "github",
        name: "github",
        description: "Read / search GitHub repos, issues, PRs; create comments.",
        transport: "stdio",
        config: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-github"],
            env: { GITHUB_PERSONAL_ACCESS_TOKEN: "<GITHUB_TOKEN>" },
        },
        slots: [
            { path: "env.GITHUB_PERSONAL_ACCESS_TOKEN", label: "GitHub personal access token", kind: "secret" },
        ],
        homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/github",
    },
    {
        id: "gitlab",
        name: "gitlab",
        description: "Read / search GitLab projects, issues, MRs.",
        transport: "stdio",
        config: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-gitlab"],
            env: {
                GITLAB_PERSONAL_ACCESS_TOKEN: "<GITLAB_TOKEN>",
                GITLAB_API_URL: "https://gitlab.com/api/v4",
            },
        },
        slots: [
            { path: "env.GITLAB_PERSONAL_ACCESS_TOKEN", label: "GitLab personal access token", kind: "secret" },
        ],
        homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/gitlab",
    },
    {
        id: "fetch",
        name: "fetch",
        description: "HTTP fetch with HTML → markdown conversion.",
        transport: "stdio",
        config: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-fetch"],
            env: {},
        },
        slots: [],
        homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/fetch",
    },
    {
        id: "brave-search",
        name: "brave-search",
        description: "Web + local search via the Brave Search API.",
        transport: "stdio",
        config: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-brave-search"],
            env: { BRAVE_API_KEY: "<BRAVE_API_KEY>" },
        },
        slots: [
            { path: "env.BRAVE_API_KEY", label: "Brave Search API key", kind: "secret" },
        ],
        homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search",
    },
    {
        id: "google-maps",
        name: "google-maps",
        description: "Geocoding, places, directions via Google Maps Platform.",
        transport: "stdio",
        config: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-google-maps"],
            env: { GOOGLE_MAPS_API_KEY: "<GOOGLE_MAPS_API_KEY>" },
        },
        slots: [
            { path: "env.GOOGLE_MAPS_API_KEY", label: "Google Maps API key", kind: "secret" },
        ],
        homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/google-maps",
    },
    {
        id: "slack",
        name: "slack",
        description: "Read / post Slack messages, list channels and users.",
        transport: "stdio",
        config: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-slack"],
            env: {
                SLACK_BOT_TOKEN: "<SLACK_BOT_TOKEN>",
                SLACK_TEAM_ID: "<SLACK_TEAM_ID>",
            },
        },
        slots: [
            { path: "env.SLACK_BOT_TOKEN", label: "Slack bot token (xoxb-…)", kind: "secret" },
            { path: "env.SLACK_TEAM_ID", label: "Slack team / workspace id", kind: "text" },
        ],
        homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/slack",
    },
    {
        id: "postgres",
        name: "postgres",
        description: "Read-only SQL access to a Postgres database.",
        transport: "stdio",
        config: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-postgres", "<CONNECTION_STRING>"],
            env: {},
        },
        slots: [
            { path: "args[2]", label: "Postgres connection string (postgresql://…)", kind: "secret" },
        ],
        homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/postgres",
    },
    {
        id: "sqlite",
        name: "sqlite",
        description: "Query a local SQLite database file.",
        transport: "stdio",
        config: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-sqlite", "<DB_PATH>"],
            env: {},
        },
        slots: [
            { path: "args[2]", label: "SQLite database file path", kind: "path" },
        ],
        homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/sqlite",
    },
    {
        id: "memory",
        name: "memory",
        description: "Persistent key-value memory across conversations.",
        transport: "stdio",
        config: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-memory"],
            env: {},
        },
        slots: [],
        homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/memory",
    },
    {
        id: "puppeteer",
        name: "puppeteer",
        description: "Headless browser automation via Puppeteer.",
        transport: "stdio",
        config: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-puppeteer"],
            env: {},
        },
        slots: [],
        homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/puppeteer",
    },
    {
        id: "sequential-thinking",
        name: "sequential-thinking",
        description: "Step-by-step reasoning tool for complex problems.",
        transport: "stdio",
        config: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
            env: {},
        },
        slots: [],
        homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking",
    },
    {
        id: "time",
        name: "time",
        description: "Time-zone-aware date / time queries.",
        transport: "stdio",
        config: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-time"],
            env: { LOCAL_TIMEZONE: "UTC" },
        },
        slots: [
            { path: "env.LOCAL_TIMEZONE", label: "IANA timezone (e.g. America/Los_Angeles)", kind: "text" },
        ],
        homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/time",
    },
];
