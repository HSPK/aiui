import "server-only";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { mcpServers } from "../db/schema";
import { badRequest, notFound } from "../response";
import { serializeMcpServer } from "./serializer";
import { checkMcpServer } from "./checks";
import { encryptConfig } from "./config-crypto";
import { sanitize } from "./dispatch";
import { deleteMcpLogs } from "./logs";
import { disposeMcpClient, forgetMcpServer } from "./runtime";
import type { McpServerCreateInput, McpServerDTO, McpServerUpdateInput } from "@/lib/schemas/mcp";

function findByIdOrName(idOrName: string) {
    return (
        db.select().from(mcpServers).where(eq(mcpServers.id, idOrName)).get() ||
        db.select().from(mcpServers).where(eq(mcpServers.name, idOrName)).get()
    );
}

/** Reject name choices whose `sanitize()` projection would break tool
 *  dispatch — both via prefix collision with another server AND via
 *  the more subtle mangle-encoding issues:
 *
 *  - `qualify(name, tool)` uses `__` as the separator, and `unqualify`
 *    splits on the FIRST `__`. A sanitized name containing `__` (e.g.
 *    `my__server` or `foo!!bar` → `foo__bar`) makes `unqualify` slice
 *    in the wrong place and look up a non-existent server.
 *  - A sanitized name starting with `_` produces a qualified name
 *    starting with `__`, where `unqualify` returns `null` (its
 *    `idx <= 0` guard against malformed input).
 *
 *  Enforce both at the CRUD boundary so the runtime never sees ambiguous
 *  or unparseable prefixes. */
function assertNameSafe(
    name: string,
    excludeId: string | undefined,
    reader: { select: typeof db.select } = db,
): void {
    const prefix = sanitize(name);
    if (prefix.startsWith("_")) {
        throw badRequest(
            `Server name "${name}" sanitises to "${prefix}" which starts with "_"; ` +
            `that breaks tool dispatch parsing. Pick a name starting with an alphanumeric character.`,
        );
    }
    if (prefix.includes("__")) {
        throw badRequest(
            `Server name "${name}" sanitises to "${prefix}" which contains "__"; ` +
            `that's the tool-dispatch separator and would alias multiple servers. ` +
            `Avoid consecutive underscores and avoid characters that map to "_" (anything outside [a-zA-Z0-9_-]).`,
        );
    }
    // Reader-parameterised select so callers wrapping us in a
    // `db.transaction((tx) => …)` block can pass `tx` and have the
    // collision check participate in the same isolation level as the
    // subsequent INSERT/UPDATE. Without this, two concurrent admin
    // requests could both pass the check and then both commit.
    const all = reader.select({ id: mcpServers.id, name: mcpServers.name }).from(mcpServers).all();
    for (const r of all) {
        if (r.id === excludeId) continue;
        if (sanitize(r.name) === prefix) {
            throw badRequest(
                `Server name conflicts with "${r.name}" — both reduce to the same tool prefix "${prefix}". ` +
                `Tool dispatch requires unique sanitized prefixes (alphanumeric, _ and -; first 32 chars).`,
            );
        }
    }
}

/** Fire-and-forget validation. We deliberately don't await it from the
 *  CRUD response — the spawn can take seconds (npx cold cache, uv
 *  install, etc.) and we don't want the dialog to hang. The FE polls
 *  the resource for the updated `last_check_*` fields. The optional
 *  `connectTimeoutMs` should come from the requesting admin's
 *  `mcp_connect_timeout_seconds` preference so slow networks (Aliyun
 *  reaching npm/PyPI mirrors) don't silently fall back to the 15s HTTP
 *  default. */
function scheduleCheck(id: string, connectTimeoutMs?: number): void {
    void checkMcpServer(id, connectTimeoutMs).catch(() => { /* persisted as error */ });
}

export function listMcpServers(opts?: { redactSecrets?: boolean }): McpServerDTO[] {
    return db.select().from(mcpServers).orderBy(mcpServers.name).all().map((r) => serializeMcpServer(r, opts));
}

export function getMcpServer(idOrName: string, opts?: { redactSecrets?: boolean }): McpServerDTO {
    const s = findByIdOrName(idOrName);
    if (!s) throw notFound("MCP server not found");
    return serializeMcpServer(s, opts);
}

export function createMcpServer(input: McpServerCreateInput, opts: { connectTimeoutMs?: number } = {}): McpServerDTO {
    const name = input.name.trim();
    // Wrap the read-then-write pair in a single transaction so two
    // concurrent admin requests can't both pass the uniqueness +
    // sanitize-prefix checks and then both commit conflicting rows.
    // better-sqlite3's transactions are synchronous (matches Drizzle's
    // sqlite adapter) — no await leaks between SELECT and INSERT.
    const id = randomUUID();
    db.transaction((tx) => {
        const dup = tx.select().from(mcpServers).where(eq(mcpServers.name, name)).get();
        if (dup) throw badRequest("Server name already exists");
        assertNameSafe(name, undefined, tx);
        tx.insert(mcpServers).values({
            id,
            name,
            description: input.description ?? "",
            transport: input.transport,
            config: encryptConfig(input.transport, input.config),
            enabled: input.enabled ?? true,
            // Fresh config version on every create. The runtime state
            // machine snapshots this into its `built_for`; mismatch on
            // next access triggers a transparent rebuild.
            configVersion: randomUUID(),
        }).run();
    });
    scheduleCheck(id, opts.connectTimeoutMs);
    return getMcpServer(id);
}

export function updateMcpServer(idOrName: string, input: McpServerUpdateInput, opts: { connectTimeoutMs?: number } = {}): McpServerDTO {
    const s = findByIdOrName(idOrName);
    if (!s) throw notFound("MCP server not found");

    // Defense: changing transport without also providing config would
    // leave the row in a hybrid state (transport="http", config still
    // has stdio command/args/env) — every subsequent buildClient call
    // would throw `Invalid URL`. Zod's superRefine only validates the
    // both-fields-present case; this is the missing single-field guard.
    if (input.transport !== undefined && input.transport !== s.transport && input.config === undefined) {
        throw badRequest("Changing transport requires sending a matching config blob in the same PATCH");
    }

    // Same TOCTOU rationale as createMcpServer — wrap the rename
    // collision check + write together.
    let willBeEnabled = !!s.enabled;
    let enabledFlip = false;
    let configChanged = false;
    db.transaction((tx) => {
        const updates: Partial<typeof mcpServers.$inferInsert> = {};
        if (input.name !== undefined) {
            const newName = input.name.trim();
            if (!newName) throw badRequest("Server name cannot be empty");
            if (newName !== s.name) {
                const dup = tx.select().from(mcpServers).where(eq(mcpServers.name, newName)).get();
                if (dup) throw badRequest("Server name already exists");
                assertNameSafe(newName, s.id, tx);
                updates.name = newName;
            }
        }
        if (input.description !== undefined) updates.description = input.description;
        const finalTransport = input.transport ?? s.transport;
        if (input.transport !== undefined && input.transport !== s.transport) {
            updates.transport = input.transport;
            configChanged = true;
        }
        if (input.config !== undefined) {
            updates.config = encryptConfig(finalTransport, input.config);
            configChanged = true;
        }
        if (input.enabled !== undefined) updates.enabled = !!input.enabled;
        // `updatedAt` is row mtime — bumps on ANY field edit. Distinct
        // from `configVersion` which only advances when transport/config
        // actually changes. Keeping them separate is what stops the cached
        // child process from being respawned for a rename.
        updates.updatedAt = new Date().toISOString();
        if (configChanged) {
            updates.configVersion = randomUUID();
            // Invalidate the tools/resources/prompts caches AND the
            // health-check signal inside the same transaction. Without
            // this, `dispatch.aggregateFromCache` keeps serving the
            // OLD config's tool list (it gates only on
            // last_check_status==="ok" + age) until the async
            // `scheduleCheck` fires below finishes — seconds for a
            // warm server, minutes for a stdio cold spawn. During
            // that window the model picks tools from the stale list,
            // then `executeTool` (which builds against the NEW config)
            // fails with "unknown tool" — confusing the user right
            // after they edited the config.
            updates.toolsCache = null;
            updates.resourcesCache = null;
            updates.promptsCache = null;
            updates.lastCheckStatus = null;
            updates.lastCheckAt = null;
            updates.lastCheckError = null;
        }

        tx.update(mcpServers).set(updates).where(eq(mcpServers.id, s.id)).run();
        willBeEnabled = input.enabled !== undefined ? input.enabled : !!s.enabled;
        enabledFlip = input.enabled === true && !s.enabled;
    });

    // Single needsCheck predicate avoids the "PATCH {enabled:true,
    // config:{...}}" case firing TWO concurrent scheduleChecks (one
    // for the re-enable, one for the configChange) that race on the
    // same DB row's lastCheck* columns. Side effects fire OUTSIDE the
    // transaction so the (synchronous) tx commits before async
    // dispose/check work runs.
    const needsCheck = willBeEnabled && (enabledFlip || configChanged);

    if (input.enabled === false && s.enabled) {
        void disposeMcpClient(s.id).catch(() => { /* ignore */ });
    } else if (needsCheck) {
        scheduleCheck(s.id, opts.connectTimeoutMs);
    }
    return getMcpServer(s.id);
}

export function deleteMcpServer(idOrName: string): void {
    const s = findByIdOrName(idOrName);
    if (!s) throw notFound("MCP server not found");
    db.delete(mcpServers).where(eq(mcpServers.id, s.id)).run();
    // Free the cached connection — the row is gone, so anything in
    // the runtime state machine pointing at it would leak a child
    // process / socket for the rest of the server's lifetime.
    // Persisted log files would otherwise outlive the row indefinitely.
    // Disable keeps logs (admin may want post-mortem); delete wipes
    // them along with everything else. Order matters: dispose's final
    // `disconnected` lifecycle event must land + the writer fd must
    // close BEFORE we unlink the file, otherwise the writer reopens
    // it and re-creates the deleted artefact. forgetMcpServer comes
    // AFTER dispose so any in-flight runMcpCheck mutation is allowed
    // to land on the still-tracked entry (the row deletion + the
    // isServerEnabledInDb gate already prevent NEW builds).
    void disposeMcpClient(s.id)
        .catch(() => { /* ignore */ })
        .finally(() => {
            forgetMcpServer(s.id);
            try { deleteMcpLogs(s.id); } catch { /* ignore */ }
        });
}
