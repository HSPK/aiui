# Browser suite

Real-Chromium tests via Playwright, split into two projects:

| Project | What it does |
| --- | --- |
| `e2e` | Functional coverage of the real UI — auth, routing, admin CRUD, chat flows |
| `experience` | Accessibility (axe), mobile viewport, keyboard/focus, cross-account isolation |
| `perf` | Benchmarks — Core Web Vitals, INP under streaming, byte budgets, slow device, SPA transitions, memory |

```bash
bun run test:browser        # functional
bun run test:experience     # a11y / mobile / keyboard / isolation
bun run bench:web           # benchmarks
bun run bench:web:report    # render the last run as a table

./scripts/e2e-docker.sh                 # no local browsers? run it all in the container
./scripts/e2e-docker.sh --project=perf
```

Both need a production build first (`bun run build`). The suite deliberately
measures `next start`, never `next dev` — dev bundles are unminified and
lazily compiled, so any number taken against them is fiction.

## How it runs

`e2e/support/boot.mjs` starts two processes against a throwaway SQLite file:

- **the app** (`next start`) with a seeded admin and a known password
- **`e2e/support/fake-upstream.mjs`**, a tiny OpenAI-compatible server

The fake upstream is what makes the streaming benchmark possible: `tokens=N`
and `delay=M` in the prompt control the token count and cadence, so the load
is repeatable instead of depending on a live provider's mood.

All three projects run with `workers: 1`. One app server and one SQLite file
back the whole suite, so parallel workers contend on shared state and surface
as timeouts that look like product flake but aren't.

## Traps worth knowing about

**Authentication must go through the browser.** The session cookie is
`secure: true` under `NODE_ENV=production`. Playwright's API client refuses to
store a Secure cookie delivered over http, so `request.post("/api/login")`
appears to succeed and every later call is a 401. Only the browser's own
network stack accepts it (Chromium treats localhost as trustworthy). Hence
`loginViaUi()` and the in-page `fetch` in `ensureProvider()`.

**The composer is not the first textbox.** `getByRole("textbox").first()`
matches the sidebar's "Search chats" input. Typing a benchmark prompt into it
silently filters the conversation list instead of sending anything — which
turns a streaming benchmark into a measurement of a completely idle page.
`e2e/perf/support/chat.ts` targets the composer by placeholder and asserts a
real `/api/playground/chat` request started before any timing is recorded.

**Empty pages hide bugs.** The accessibility suite initially passed because
the pages under test had no data: the per-conversation action menu (which was
missing an accessible name) only renders once a conversation exists. Seed
realistic state before asserting, or the audit measures an empty shell.

**Contrast counts scale with rows.** Counting axe `color-contrast` *nodes*
made the baseline depend on how much data earlier specs had created. The
baseline counts distinct violation signatures (rule + element classes)
instead, so it reflects the number of bad style rules rather than the number
of rendered cells.

## Benchmarks

`e2e/perf/BASELINE.md` holds the last recorded numbers so a regression shows
up as a diff. The budgets in `bundle-budget.spec.ts` are set just above the
current measurements: they are **regression ratchets, not targets**. The
current ~660–790 KB of JS per route is known debt — see the note in that file
before raising a budget rather than fixing the cause.
