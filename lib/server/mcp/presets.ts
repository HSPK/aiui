import "server-only";
import type { McpPreset } from "@/lib/schemas/mcp";

/**
 * Curated catalogue of probe-verified MCP servers.
 *
 * Every entry below was tested end-to-end (transport spawn or HTTP
 * connect → initialize → tools/list) against the latest version of
 * the package. Entries that 404'd on the registry, got marked
 * deprecated upstream, or couldn't complete the handshake are not
 * shipped — configure those manually if you need them.
 *
 * TypeScript reference servers run via `npx -y @scope/server-<name>`.
 * Python servers run via `uvx <package>` — you need `uv` installed
 * on the host (https://docs.astral.sh/uv/).
 *
 * The `category` field groups presets in the gallery view. Adding a
 * preset = one entry below + a probe; the catalogue page picks up
 * new entries automatically.
 */

export const MCP_PRESETS: McpPreset[] = [
    // ---------------- system / filesystem / runtime ----------------
    {
        id: "filesystem",
        name: "filesystem",
        description: "Read / write access to allowed local directories.",
        transport: "stdio",
        category: "official",
        config: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem", "<ALLOWED_PATH>"],
            env: {},
        },
        slots: [{ path: "args[2]", label: "Allowed root path", kind: "path" }],
        homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",
    },
    {
        id: "memory",
        name: "memory",
        description: "Persistent knowledge-graph memory across conversations.",
        transport: "stdio",
        category: "official",
        config: { command: "npx", args: ["-y", "@modelcontextprotocol/server-memory"], env: {} },
        slots: [],
        homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/memory",
    },
    {
        id: "sequential-thinking",
        name: "sequential-thinking",
        description: "Step-by-step reasoning helper for complex problems.",
        transport: "stdio",
        category: "official",
        config: { command: "npx", args: ["-y", "@modelcontextprotocol/server-sequential-thinking"], env: {} },
        slots: [],
        homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking",
    },
    {
        id: "everything",
        name: "everything",
        description: "Reference / demo server exposing the full MCP surface area.",
        transport: "stdio",
        category: "official",
        config: { command: "npx", args: ["-y", "@modelcontextprotocol/server-everything"], env: {} },
        slots: [],
        homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/everything",
    },
    {
        id: "time",
        name: "time",
        description: "Time-zone-aware date / time queries.",
        transport: "stdio",
        category: "official",
        config: {
            // Pinned: mcp SDK 2.0 is a breaking release (McpError renamed to
            // MCPError, Server.list_tools removed, mcp.server.fastmcp moved)
            // and this package's dependency range is unbounded, so an
            // unpinned uvx run dies before the handshake. Probed all 11 uvx
            // presets against the live registry: six need this, five don't.
            command: "uvx",
            args: ["--with", "mcp<2", "mcp-server-time", "--local-timezone=UTC"],
            env: {},
        },
        slots: [
            { path: "args[3]", label: "IANA timezone flag (e.g. --local-timezone=America/Los_Angeles)", kind: "text" },
        ],
        homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/time",
    },
    {
        id: "fetch",
        name: "fetch",
        description: "HTTP fetch with HTML → markdown conversion.",
        transport: "stdio",
        category: "official",
        // Pinned for the same reason as `time` — see above.
        config: { command: "uvx", args: ["--with", "mcp<2", "mcp-server-fetch"], env: {} },
        slots: [],
        homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/fetch",
    },

    // ---------------- dev / source control ----------------
    {
        id: "github",
        name: "github",
        description: "Read / search GitHub repos, issues, PRs; create comments.",
        transport: "stdio",
        category: "dev",
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
        category: "dev",
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
        id: "git",
        name: "git",
        description: "Git tools — log, diff, blame, search a local repo.",
        transport: "stdio",
        category: "dev",
        config: {
            // Pinned for the same reason as `time` — see above.
            command: "uvx",
            args: ["--with", "mcp<2", "mcp-server-git", "--repository", "<REPO_PATH>"],
            env: {},
        },
        slots: [{ path: "args[4]", label: "Git repository root path", kind: "path" }],
        homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/git",
    },

    // ---------------- data ----------------
    {
        id: "sqlite",
        name: "sqlite",
        description: "Query a local SQLite database file.",
        transport: "stdio",
        category: "data",
        config: {
            // Pinned for the same reason as `time` — see above.
            command: "uvx",
            args: ["--with", "mcp<2", "mcp-server-sqlite", "--db-path", "<DB_PATH>"],
            env: {},
        },
        slots: [{ path: "args[4]", label: "SQLite database file path", kind: "path" }],
        homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/sqlite",
    },

    // ---------------- academic ----------------
    {
        id: "scholarly",
        name: "scholarly",
        description: "Search arXiv + Google Scholar in one server. No API key needed.",
        transport: "stdio",
        category: "academic",
        // Pinned for the same reason as `time` — see above.
        config: { command: "uvx", args: ["--with", "mcp<2", "mcp-scholarly"], env: {} },
        slots: [],
        homepage: "https://pypi.org/project/mcp-scholarly/",
    },
    {
        id: "arxiv",
        name: "arxiv",
        description: "Search and download arXiv papers (10 tools — search, read, citations).",
        transport: "stdio",
        category: "academic",
        config: { command: "uvx", args: ["arxiv-mcp-server"], env: {} },
        slots: [],
        homepage: "https://github.com/blazickjp/arxiv-mcp-server",
    },
    {
        id: "pubmed",
        name: "pubmed",
        description: "Search biomedical literature abstracts on PubMed.",
        transport: "stdio",
        category: "academic",
        // Pinned: needs mcp.server.fastmcp, which moved in mcp SDK 2.0.
        config: { command: "uvx", args: ["--with", "mcp<2", "pubmedmcp"], env: {} },
        slots: [],
        homepage: "https://pypi.org/project/pubmedmcp/",
    },

    // ---------------- system: shell / cli ----------------
    {
        id: "shell",
        name: "shell",
        description: "Execute allow-listed shell commands (curl, ls, etc.). Set ALLOW_COMMANDS to the comma-separated whitelist.",
        transport: "stdio",
        category: "system",
        config: {
            command: "uvx",
            args: ["mcp-shell-server"],
            env: { ALLOW_COMMANDS: "ls,pwd,cat,curl,echo,wc,head,tail,grep" },
        },
        slots: [
            { path: "env.ALLOW_COMMANDS", label: "Allowed commands (comma-separated)", kind: "text" },
        ],
        homepage: "https://pypi.org/project/mcp-shell-server/",
    },
    {
        id: "shell-node",
        name: "shell-node",
        description: "Node-based shell command runner (alternative to mcp-shell-server). Review allow-list carefully.",
        transport: "stdio",
        category: "system",
        config: { command: "npx", args: ["-y", "shell-mcp-server"], env: {} },
        slots: [],
        homepage: "https://www.npmjs.com/package/shell-mcp-server",
    },
    {
        id: "playwright",
        name: "playwright",
        description: "Headless browser automation (23 tools: navigate, click, type, screenshot, console, network).",
        transport: "stdio",
        category: "system",
        config: { command: "npx", args: ["-y", "@playwright/mcp@latest"], env: {} },
        slots: [],
        homepage: "https://github.com/microsoft/playwright-mcp",
    },
    {
        id: "code-runner",
        name: "code-runner",
        description: "Execute snippets of code in many languages — JS, Python, Bash, Rust, Go, etc.",
        transport: "stdio",
        category: "dev",
        config: { command: "npx", args: ["-y", "mcp-server-code-runner"], env: {} },
        slots: [],
        homepage: "https://www.npmjs.com/package/mcp-server-code-runner",
    },

    // ---------------- web / knowledge ----------------
    {
        id: "duckduckgo",
        name: "duckduckgo",
        description: "Web search via DuckDuckGo + scrape page content. No API key needed.",
        transport: "stdio",
        category: "web",
        config: { command: "uvx", args: ["duckduckgo-mcp-server"], env: {} },
        slots: [],
        homepage: "https://pypi.org/project/duckduckgo-mcp-server/",
    },
    {
        id: "wikipedia",
        name: "wikipedia",
        description: "Search and read Wikipedia articles (search, get article, random).",
        transport: "stdio",
        category: "web",
        config: { command: "npx", args: ["-y", "wikipedia-mcp-server"], env: {} },
        slots: [],
        homepage: "https://www.npmjs.com/package/wikipedia-mcp-server",
    },

    // ---------------- productivity ----------------
    {
        id: "notion",
        name: "notion",
        description: "Read / write Notion pages and databases via the official OpenAPI MCP server.",
        transport: "stdio",
        category: "productivity",
        config: {
            command: "npx",
            args: ["-y", "notion-mcp-server"],
            env: { OPENAPI_MCP_HEADERS: '{"Authorization":"Bearer <NOTION_TOKEN>","Notion-Version":"2022-06-28"}' },
        },
        slots: [
            { path: "env.OPENAPI_MCP_HEADERS", label: "Headers JSON with Notion integration token", kind: "secret" },
        ],
        homepage: "https://github.com/makenotion/notion-mcp-server",
    },
    {
        id: "pandoc",
        name: "pandoc",
        description: "Convert between document formats — markdown ↔ html ↔ pdf ↔ docx (uses local pandoc).",
        transport: "stdio",
        category: "productivity",
        config: { command: "uvx", args: ["mcp-pandoc"], env: {} },
        slots: [],
        homepage: "https://pypi.org/project/mcp-pandoc/",
    },

    // ---------------- data: vector / kb ----------------
    {
        id: "qdrant",
        name: "qdrant",
        description: "Store + retrieve from a Qdrant vector database (RAG over a custom corpus).",
        transport: "stdio",
        category: "data",
        config: {
            command: "uvx",
            args: ["mcp-server-qdrant"],
            env: {
                QDRANT_URL: "http://localhost:6333",
                COLLECTION_NAME: "<COLLECTION_NAME>",
            },
        },
        slots: [
            { path: "env.QDRANT_URL", label: "Qdrant URL (e.g. http://localhost:6333)", kind: "text" },
            { path: "env.COLLECTION_NAME", label: "Qdrant collection name", kind: "text" },
        ],
        homepage: "https://github.com/qdrant/mcp-server-qdrant",
    },
];
