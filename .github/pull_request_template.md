## What this changes

<!-- One or two sentences. Link the issue if there is one: Fixes #123 -->

## Why

<!-- The problem being solved. Skip if it's obvious from the above. -->

## How it was verified

<!-- Tick what you ran. Delete what doesn't apply. -->

- [ ] `bun run build` (includes strict TypeScript checking)
- [ ] `bun run lint` — no *new* problems above the baseline
- [ ] `bun run test`, or a specific `scripts/e2e-*.mjs`:
- [ ] Manual check in the UI:
- [ ] `docker build .` / container smoke test

## Notes for reviewers

<!-- Anything surprising: schema migrations, config changes, breaking behaviour. -->

- [ ] Adds or changes a Drizzle migration (`bunx drizzle-kit generate` was run)
- [ ] Changes the config file shape, an env var, or a CLI flag — docs updated
