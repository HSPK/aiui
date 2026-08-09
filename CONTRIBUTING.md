# Contributing to Loom

Thanks for taking the time. Issues and pull requests are both welcome.

## Getting set up

```bash
git clone https://github.com/HSPK/loom.git
cd loom
bun install
bun run dev          # http://localhost:3000 with hot reload
```

Loom uses **bun**. Don't mix in npm / yarn / pnpm — `bun.lock` is the source
of truth.

Full details, including the database migration workflow, live in
[docs/development.md](docs/development.md).

## Before you open a pull request

There are no unit tests. Verification is:

```bash
bun run build        # includes strict TypeScript checking
bun run lint         # only new problems matter; the baseline is noisy
bun run test         # end-to-end scripts under scripts/e2e-*.mjs
```

If you touched the gateway, the playground stream pipeline, or MCP dispatch,
run the relevant `scripts/e2e-*.mjs` script and say so in the PR description.

For container or install-script changes:

```bash
docker build -t loom .
docker run --rm -p 3000:3000 -v loom-data:/data loom
sh install.sh --dry-run
```

## Architecture in one minute

Loom is a single Next.js App Router codebase. There is no separate backend —
Route Handlers are the API, the OpenAI-compatible gateway, and the MCP runtime.

Adding things is meant to be cheap, because the extension points are
registries rather than switch statements:

| You want to add | You write |
| --- | --- |
| A CRUD endpoint | `defineRoute({ auth, body, handler })` |
| A frontend domain | one `defineResource({ path, key })` call |
| A modality (chat, image, …) | one file in `lib/server/capabilities/` |
| An upstream wire shape | one file in `lib/server/api-variants/` |
| An upstream transport | one file in `lib/server/adapters/` |
| A CLI subcommand | one `defineCommand` in `lib/cli/commands/` |

If a change forces you to edit `gateway/index.ts`, `route.ts`, or
`resource.ts`, that's a signal the abstraction is wrong — please raise it in
the issue before writing a lot of code.

See [docs/architecture.md](docs/architecture.md) for the full picture.

## Conventions

- **zod schemas in `lib/schemas/<domain>.ts` are the only source of wire
  types.** Derive TypeScript types with `z.infer`; never hand-write a parallel
  interface.
- **Drizzle's `lib/server/db/schema.ts` is the only source of DB types.** After
  editing it, run `bunx drizzle-kit generate`.
- Server code starts with `import "server-only"`. Client code starts with
  `"use client"`. They never import each other — both import from
  `@/lib/schemas/*`.
- Services throw `HttpError` on failure. Don't return `null` sometimes and
  throw other times.
- Tailwind classes merge through `cn()`; use semantic tokens
  (`bg-background`, `text-muted-foreground`) rather than raw colours.

## Reporting bugs

Include your Loom version (`loom --version` or the image tag), how you
installed it, and the relevant log lines. If it's a gateway problem, the
matching row from `/logs` is worth more than a description.

## Security

Don't open a public issue for a vulnerability — see [SECURITY.md](SECURITY.md).

## License

By contributing you agree that your work is licensed under the
[MIT License](LICENSE).
