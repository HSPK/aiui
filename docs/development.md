# Development

## Local setup

```bash
git clone https://github.com/HSPK/loom.git
cd loom
bun install
bun run dev          # http://localhost:3000 with hot reload
```

Loom uses **bun** as its package manager. Don't mix with npm / yarn / pnpm — `bun.lock` is the source of truth.

## Scripts

| Command            | What it does                                                         |
| ------------------ | -------------------------------------------------------------------- |
| `bun run dev`      | Next.js dev server with HMR                                          |
| `bun run build`    | Builds the CLI bundle + production Next.js build                     |
| `bun run start`    | Runs the production server (after `build`)                           |
| `bun run lint`     | ESLint (baseline 107 problems; only call out new ones)               |
| `bun run build:cli`| Re-bundle `bin/loom.ts` → `bin/loom.mjs` (also runs in `prepare`)    |

## Database migrations

Drizzle Kit generates the migrations from `lib/server/db/schema.ts`:

```bash
bunx drizzle-kit generate
```

This is an interactive prompt — run it inside a TTY or via `script -qc '...' /dev/null`. Migrations execute automatically on server boot.

## End-to-end tests

There are no unit tests. Verification happens via standalone E2E scripts that spawn the gateway against a temp `LOOM_USER_CWD`:

```bash
node scripts/e2e-mcp-loop.mjs
node scripts/e2e-mcp-check.mjs
node scripts/e2e-multimodal.mjs
node scripts/e2e-messages-pagination.mjs
node scripts/e2e-preferences.mjs
node scripts/e2e-tracing-fixes.mjs
node scripts/e2e-responses-variant.mjs
node scripts/e2e-latency-split.mjs
```

When adding a feature with non-trivial wire surface, write a new `e2e-*.mjs` in the same style.

## Design principles

Loom is built around **"new features should require minimum code churn"**. The rules:

- One domain per folder (`lib/server/<domain>/`)
- Schemas in `lib/schemas/*.ts` are the single source of truth — every TS type derives from `z.infer`, never hand-written interfaces
- Use factories — `defineRoute`, `defineResource`, `defineCommand`, `registerCapability`, `registerAdapter`
- Add new functionality by adding files + a single registration line, never by editing core files

Concretely:

| Adding a... | Touches |
| --- | --- |
| Wire field | zod schema + Drizzle column + 1 serializer line |
| CRUD endpoint | zod schema + `defineRoute` + service function |
| Modality | one capability file + one Route Handler |
| Protocol variant | one adapter file + one registration line |
| FE domain | one `defineResource(...)` call |
| CLI subcommand | one file in `lib/cli/commands/` + one line in `main.ts` |

## Documentation

Docs live under `docs/` and are built with **mkdocs-material**.

```bash
pip install -r docs/requirements.txt
mkdocs serve              # preview at http://localhost:8000
mkdocs build --strict     # what CI runs — fails on broken cross-page links
```

On push to `main`, the [`Docs`](https://github.com/HSPK/loom/actions/workflows/docs.yml) workflow builds the site with `--strict` and publishes to GitHub Pages at <https://hspk.github.io/loom>. Pull requests run the build step only, so broken links are caught before merge.

## Contributing

Issues and pull requests are welcome. Please:

1. Read [`.github/copilot-instructions.md`](https://github.com/HSPK/loom/blob/main/.github/copilot-instructions.md) for the full design contract.
2. Keep each PR atomic — one feature or one fix.
3. Verify `bun run build`, `bun run lint`, and at least one relevant E2E pass.
4. Don't widen the lint baseline of 107 problems.

## Repository layout

```
app/                       # Next.js App Router (UI + Route Handlers)
  (dashboard)/             # Authenticated pages
  (auth)/login/            # Public login
  api/                     # Route Handlers (gateway + admin CRUD)
bin/loom.ts                # CLI entry shim (esbuild bundled to bin/loom.mjs)
components/                # React components (shadcn/ui composed)
context/                   # React context providers (auth, theme)
docs/                      # This documentation (mkdocs)
drizzle/                   # SQL migrations (generated)
lib/
  api/                     # Frontend HTTP client per domain
  cli/                     # CLI command tree
  schemas/                 # Zod schemas (wire types)
  server/                  # Server-only modules
    adapters/              # Per-protocol adapters
    capabilities/          # Per-modality handlers
    db/                    # Drizzle schema + SQLite setup
    gateway/               # OpenAI-compatible forwarder
    mcp/                   # MCP runtime
    <domain>/              # One folder per domain
  stores/                  # Zustand stores (client state)
public/                    # Static assets
scripts/                   # Build CLI + E2E tests
```
