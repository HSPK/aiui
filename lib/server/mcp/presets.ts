import "server-only";
import type { McpPreset } from "@/lib/schemas/mcp";

/**
 * Curated catalogue of known-working MCP servers. Every entry below
 * was probed end-to-end (stdio spawn → initialize → tools/list)
 * against the version of the package shown by the date stamp on its
 * id; entries that 404'd on npm, were marked deprecated upstream, or
 * couldn't complete the initialize handshake are intentionally not
 * shipped. Configure those manually if you need them.
 *
 * TypeScript reference servers run via `npx -y @modelcontextprotocol/
 * server-<name>`. Python ones run via `uvx mcp-server-<name>` — you
 * need `uv` (https://docs.astral.sh/uv/) installed on the host.
 *
 * Adding a preset = one entry below + a probe in the manual checklist.
 * `slots` lists fields the admin has to fill before saving (we still
 * always run a real connection check on save, so a forgotten slot
 * surfaces in `last_check_error` rather than silently shipping a
 * broken row).
 */

export const MCP_PRESETS: McpPreset[] = [
    {
        id: "filesystem",
        name: "filesystem",
        description: "Read / write access to allowed local directories (Node).",
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
        id: "memory",
        name: "memory",
        description: "Persistent knowledge-graph memory across conversations (Node).",
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
        id: "sequential-thinking",
        name: "sequential-thinking",
        description: "Step-by-step reasoning helper for complex problems (Node).",
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
        id: "everything",
        name: "everything",
        description: "Reference / demo MCP server with the full surface area (Node).",
        transport: "stdio",
        config: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-everything"],
            env: {},
        },
        slots: [],
        homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/everything",
    },
    {
        id: "github",
        name: "github",
        description: "Read / search GitHub repos, issues, PRs; comment, etc. (Node).",
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
        id: "github-remote",
        name: "github-remote",
        description: "GitHub's hosted MCP endpoint — no local install required.",
        transport: "http",
        config: {
            url: "https://api.githubcopilot.com/mcp/",
            headers: { Authorization: "Bearer <GITHUB_TOKEN>" },
        },
        slots: [
            { path: "headers.Authorization", label: "Authorization header (Bearer <github PAT>)", kind: "secret" },
        ],
        homepage: "https://github.com/github/github-mcp-server",
    },
    {
        id: "time",
        name: "time",
        description: "Time-zone-aware date / time queries (Python — requires uvx).",
        transport: "stdio",
        config: {
            command: "uvx",
            args: ["mcp-server-time", "--local-timezone=UTC"],
            env: {},
        },
        slots: [
            { path: "args[1]", label: "IANA timezone flag (e.g. --local-timezone=America/Los_Angeles)", kind: "text" },
        ],
        homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/time",
    },
    {
        id: "fetch",
        name: "fetch",
        description: "HTTP fetch with HTML → markdown conversion (Python — requires uvx).",
        transport: "stdio",
        config: {
            command: "uvx",
            args: ["mcp-server-fetch"],
            env: {},
        },
        slots: [],
        homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/fetch",
    },
    {
        id: "git",
        name: "git",
        description: "Git tools — log, diff, blame, search (Python — requires uvx).",
        transport: "stdio",
        config: {
            command: "uvx",
            args: ["mcp-server-git", "--repository", "<REPO_PATH>"],
            env: {},
        },
        slots: [
            { path: "args[2]", label: "Git repository root path", kind: "path" },
        ],
        homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/git",
    },
    {
        id: "sqlite",
        name: "sqlite",
        description: "Query a local SQLite database file (Python — requires uvx).",
        transport: "stdio",
        config: {
            command: "uvx",
            args: ["mcp-server-sqlite", "--db-path", "<DB_PATH>"],
            env: {},
        },
        slots: [
            { path: "args[2]", label: "SQLite database file path", kind: "path" },
        ],
        homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/sqlite",
    },
];
