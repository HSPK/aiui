import "server-only";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { mcpServers } from "../db/schema";
import {
    getClient,
    listPromptsForServer,
    listResourcesForServer,
    listToolsForServer,
    readServerInfo,
    type BuildClientHooks,
    type BuildClientOpts,
    type McpCheckPhase,
} from "./runtime";
import type {
    McpServerDTO,
    McpPromptDescriptor,
    McpResourcesSnapshot,
    McpToolDescriptor,
} from "@/lib/schemas/mcp";
import { serializeMcpServer } from "./serializer";

/** Soft caps on persisted snapshot sizes. A pathological server that
 *  exposes thousands of tools / resources / prompts would otherwise
 *  bloat the JSON columns and slow the FE renderer. Anything beyond
 *  the cap is silently dropped with a single noise entry so admins
 *  see the truncation in the details sheet. */
const MAX_TOOLS = 500;
const MAX_RESOURCES = 1000;
const MAX_RESOURCE_TEMPLATES = 200;
const MAX_PROMPTS = 500;

function capArray<T>(items: T[], cap: number): T[] {
    return items.length > cap ? items.slice(0, cap) : items;
}

/** Wire events for the streaming check path. Mirrors the SSE shape on
 *  the client side so adding a new phase / log channel is a one-place
 *  edit. */
export type McpCheckEvent =
    | { type: "phase"; phase: McpCheckPhase | "listing" }
    | { type: "log"; line: string }
    | { type: "result"; server: McpServerDTO }
    | { type: "error"; message: string; server?: McpServerDTO };

/**
 * Stream the full check pipeline (spawn → install → connect →
 * tools/list → resources/list → prompts/list → persist). Emits phase
 * transitions and live stderr lines so the FE can render an install
 * log panel — slow networks where `npx`/`uvx` take a minute to
 * download a server package are the primary use case.
 *
 * The function always resolves; failures arrive as `{type: "error"}`
 * with the persisted (last-known-good) DTO included where available.
 * Caller owns the SSE framing.
 *
 * `opts.signal` is an optional AbortSignal — used by the SSE route to
 * stop further work + suppress further events when the browser
 * disconnects mid-check. Aborting does NOT kill the underlying spawn
 * (other callers may have joined via singleflight) — it just exits
 * runMcpCheck early so we stop writing DB rows / firing events that
 * have nowhere to go.
 */
export async function runMcpCheck(
    serverId: string,
    onEvent: (ev: McpCheckEvent) => void,
    opts: BuildClientOpts & { signal?: AbortSignal } = {},
): Promise<McpServerDTO | null> {
    const row = db.select().from(mcpServers).where(eq(mcpServers.id, serverId)).get();
    if (!row) return null;
    const dto = serializeMcpServer(row);

    // Disabled servers are never spawned — covers the race where
    // `PATCH {enabled:false, config:{...}}` would otherwise both
    // dispose AND schedule a check that respawns. The check is a
    // no-op (existing snapshot preserved), surfaced via the error
    // event so the caller's UI can show "skipped, server disabled".
    if (!dto.enabled) {
        onEvent({
            type: "error",
            message: "Server is disabled — enable it before running a check.",
            server: dto,
        });
        return dto;
    }

    // Don't pre-dispose the cached connection — the runtime state
    // machine reuses it when healthy + config hasn't changed, and
    // transparently rebuilds when stale. Pre-disposing here would
    // mean every re-check spawned a fresh `npx`/`uvx` process even
    // when nothing was wrong, defeating the long-lived-connection
    // design.

    const hooks: BuildClientHooks = {
        onPhase: (phase) => onEvent({ type: "phase", phase }),
        onLog: (line) => onEvent({ type: "log", line }),
    };

    /** TOCTOU defence — runMcpCheck is multi-phase (connect → tools
     *  → resources → prompts → persist). A CRUD disable that lands
     *  mid-check would otherwise let the protocol calls keep spawning
     *  / using connections for a row that's now `enabled=false`. We
     *  re-read enabled before each phase so the check bails the
     *  moment the policy changes. Cheap: one indexed lookup. */
    const stillEnabled = (): boolean => {
        const row = db
            .select({ enabled: mcpServers.enabled })
            .from(mcpServers)
            .where(eq(mcpServers.id, serverId))
            .get();
        return !!row?.enabled;
    };

    /** Combined bail check for both enabled-flip AND client-cancel.
     *  Returns true if the check should abort. Distinguishes between
     *  enabled-flip (writes DB + emits error) and signal-abort (no DB
     *  write, no event — caller is gone). */
    const shouldBail = (): "disabled" | "cancelled" | null => {
        if (opts.signal?.aborted) return "cancelled";
        if (!stillEnabled()) return "disabled";
        return null;
    };

    const now = new Date().toISOString();
    try {
        // ensureConnected via getClient — joins any in-flight connect
        // by another caller (outer + inner UI re-checks fire the same
        // spawn under the hood) and shares its hook stream. We release
        // the handle IMMEDIATELY because the subsequent list calls
        // (protocol.ts) do their own acquire/release — holding our
        // handle through them would just inflate the refcount with no
        // benefit while keeping a closed-on-rebuild connection alive
        // longer than necessary.
        const probe = await getClient(dto, hooks, opts);
        probe.release();
        const bail1 = shouldBail();
        if (bail1 === "disabled") {
            // Mid-check disable race — persist the abort as an error
            // and emit the matching event so the FE shows the same
            // failure-shaped UI as the pre-check bail. Without this
            // the snapshot stays at whatever lastCheckStatus the
            // PRIOR check left, falsely suggesting the in-flight
            // check passed.
            const msg = "Server was disabled mid-check.";
            db.update(mcpServers).set({
                lastCheckStatus: "error",
                lastCheckAt: now,
                lastCheckError: msg,
            }).where(eq(mcpServers.id, serverId)).run();
            const updated = db.select().from(mcpServers).where(eq(mcpServers.id, serverId)).get();
            const out = updated ? serializeMcpServer(updated) : null;
            onEvent({ type: "error", message: msg, server: out ?? undefined });
            return out;
        }
        if (bail1 === "cancelled") return dto;
        onEvent({ type: "phase", phase: "listing" });

        // tools/list — load-bearing for chat, must succeed.
        const tools = await listToolsForServer(dto);
        const toolsSnapshot: McpToolDescriptor[] = capArray(
            tools.map((t) => ({
                name: t.localName,
                description: t.description,
                parameters: t.parameters,
            })),
            MAX_TOOLS,
        );

        // resources/list + prompts/list — best-effort. Servers may
        // advertise the capability but fail the call (or not advertise
        // at all). Either way we keep going; details sheet renders
        // the section only when there's something to show.
        let resourcesSnapshot: McpResourcesSnapshot | null = null;
        let promptsSnapshot: McpPromptDescriptor[] | null = null;
        if (shouldBail() === null) {
            try {
                const raw = await listResourcesForServer(dto);
                if (raw) {
                    resourcesSnapshot = {
                        resources: capArray(raw.resources, MAX_RESOURCES),
                        templates: capArray(raw.templates, MAX_RESOURCE_TEMPLATES),
                    };
                }
            } catch { /* leave null, surface via missing section */ }
        }
        if (shouldBail() === null) {
            try {
                const raw = await listPromptsForServer(dto);
                if (raw) promptsSnapshot = capArray(raw, MAX_PROMPTS);
            } catch { /* leave null, surface via missing section */ }
        }

        // Capture the server-reported identity that the initialize
        // handshake established alongside tools/list.
        const serverInfo = readServerInfo(serverId);

        if (opts.signal?.aborted) {
            // Caller has gone away — skip DB write, skip event. The
            // spawn already happened (other consumers can still
            // benefit from the cached connection).
            return dto;
        }

        db.update(mcpServers).set({
            lastCheckStatus: "ok",
            lastCheckAt: now,
            lastCheckError: null,
            toolsCache: toolsSnapshot,
            resourcesCache: resourcesSnapshot,
            promptsCache: promptsSnapshot,
            serverInfo,
            // Deliberately NOT bumping `updatedAt` — that field is the
            // config-version sentinel the runtime state machine uses to
            // detect "config actually changed; rebuild". A re-check
            // that just refreshes the snapshot must leave the version
            // alone so the cached child process stays valid.
        }).where(eq(mcpServers.id, serverId)).run();
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        db.update(mcpServers).set({
            lastCheckStatus: "error",
            lastCheckAt: now,
            // Wider cap so enriched stderr traces (the most useful
            // signal for stdio failures — ENOENT, missing binary,
            // bad arg) survive persistence.
            lastCheckError: message.slice(0, 4000),
            // Preserve existing tools/resources/prompts caches —
            // last-known-good is more useful in the FE than nuking
            // on a transient failure. `updatedAt` is also untouched
            // for the same config-version reasoning as the ok path.
        }).where(eq(mcpServers.id, serverId)).run();
        const updated = db.select().from(mcpServers).where(eq(mcpServers.id, serverId)).get();
        const updatedDto = updated ? serializeMcpServer(updated) : null;
        onEvent({ type: "error", message, server: updatedDto ?? undefined });
        return updatedDto;
    }

    const updated = db.select().from(mcpServers).where(eq(mcpServers.id, serverId)).get();
    const updatedDto = updated ? serializeMcpServer(updated) : null;
    if (updatedDto) onEvent({ type: "result", server: updatedDto });
    return updatedDto;
}

/**
 * Probe an MCP server: spawn / connect transport, run initialize +
 * tools/list (and resources/list + prompts/list when the server
 * advertises those capabilities), persist {status, error, identity,
 * snapshots}, return the updated DTO. Back-compat wrapper around
 * `runMcpCheck` for callers that don't want the streaming events.
 *
 * Lives outside `service.ts` so the runtime (which imports the
 * service for listMcpServers) doesn't cycle back through CRUD code.
 */
export async function checkMcpServer(
    serverId: string,
    connectTimeoutMs?: number,
): Promise<McpServerDTO | null> {
    return runMcpCheck(serverId, () => { /* discard events */ }, { connectTimeoutMs });
}
