# Playground

The playground is a built-in conversational client wired to the same `/api/v1/*` endpoints your apps use. It's not a sandbox — it talks to the same providers, the same MCP servers, and is gated by the same authentication.

## Chat (`/playground/chat`)

- Pick one or several models and stream simultaneous responses for comparison
- Tool calls, when triggered by the model, render inline with full request / response inspection
- Per-conversation settings: model selection, temperature, max tokens, default-params overrides
- Conversations are persisted; reopen any past one and continue
- Branching: edit any past message to fork the conversation

### Live metrics

Every assistant message carries:

- Token usage (prompt / completion / total)
- Time-to-first-token (TTFT)
- End-to-end latency
- Provider + model the request actually hit

### Stop, retry, fork

- **Stop** cancels an in-flight stream and persists what arrived
- **Retry** re-sends the last user turn against the same model
- Editing any prior user message creates a new branch from that point

### Working with tool calls

When MCP servers are registered and enabled, every chat request advertises their tools. Tool invocations are rendered as collapsible cards with the full input / output. Large tool transcripts collapse by default — open the ones you care about.

## Embedding (`/playground/embedding`)

- Side-by-side embedding comparison across multiple models / providers
- Pairwise cosine similarity matrix for the input list
- Toggle to view raw vectors or only their distance metrics

## Settings persistence

The playground splits state in two places:

- **Per-device UI**: send-on-enter, show-timestamps, compact-mode → `localStorage`
- **Cross-device**: default model, default temperature, default tools enabled → server-side `user_preferences` table

So your provider / model defaults follow you between browsers, but window-level UI tweaks stay local.
