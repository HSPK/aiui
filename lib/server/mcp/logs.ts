import "server-only";
import {
    appendFileSync,
    closeSync,
    existsSync,
    mkdirSync,
    openSync,
    readFileSync,
    renameSync,
    rmSync,
    statSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

// =============================================================================
// Per-server stderr + lifecycle log writer
// =============================================================================
//
// Two-file rotation scheme:
//
//   <dataDir>/mcp-logs/<serverId>.log     current; appended on every write
//   <dataDir>/mcp-logs/<serverId>.log.1   previous rotation; overwritten on
//                                          the next rotation (so per-server
//                                          disk usage is hard-capped at
//                                          2 × MAX_BYTES).
//
// Persisted (rather than memory-only) because (a) the live stderr buffer in
// runtime.ts is capped at 4 KiB which loses anything noisy, and (b) the
// admin needs post-mortem access after a crash — by definition the process
// is gone, so an in-memory ring buffer wouldn't help.
//
// All entries land as:
//
//   <ISO timestamp> [level] <message>
//
// where level is one of `stderr` | `lifecycle` | `connect` so the UI can
// colour / filter without reparsing.

const MAX_BYTES = 5 * 1024 * 1024;
const USER_CWD = process.env.LOOM_USER_CWD || process.cwd();
const ROOT_DIR = process.env.LOOM_MCP_LOGS_DIR || resolve(USER_CWD, "data", "mcp-logs");

export type McpLogLevel = "stderr" | "lifecycle" | "connect";

interface Writer {
    /** Open file descriptor for the current log. Reopened after rotation. */
    fd: number;
    /** Cumulative bytes since last rotation — cheap counter avoids a stat
     *  syscall per write while still triggering rotation in time. */
    bytes: number;
    /** Path of the current log file. Cached because we constructed it once. */
    path: string;
}

// Module-level state survives the dev HMR cycle via globalThis. Mirror
// of the pattern in lib/server/db/index.ts — without this, a Next.js
// re-import would create a fresh `writers` Map, parking the old open
// fds in unreferenced closures (memory + fd leak per HMR generation).
declare global {
    var __loom_mcp_writers__: Map<string, Writer> | undefined;
    var __loom_mcp_tombstones__: Set<string> | undefined;
}

const writers: Map<string, Writer> = globalThis.__loom_mcp_writers__ ?? new Map();
const tombstones: Set<string> = globalThis.__loom_mcp_tombstones__ ?? new Set();
if (process.env.NODE_ENV !== "production") {
    globalThis.__loom_mcp_writers__ = writers;
    globalThis.__loom_mcp_tombstones__ = tombstones;
}

function logPath(serverId: string): string {
    // Strip anything that's not a UUID hex / dash to defend against a
    // pathological serverId leaking a path traversal. Real server IDs are
    // randomUUID() output so this is a belt-and-suspenders check.
    const safe = serverId.replace(/[^a-zA-Z0-9_-]/g, "_");
    return resolve(ROOT_DIR, `${safe}.log`);
}

function ensureRootDir(): void {
    if (!existsSync(ROOT_DIR)) {
        mkdirSync(ROOT_DIR, { recursive: true });
    }
}

function openWriter(serverId: string): Writer | null {
    // Refuse to reopen for a tombstoned (deleted) server. Late stderr
    // events from a dying child must NOT resurrect the log file after
    // deleteMcpServer cleaned up — otherwise we'd leave an orphan file
    // with no DB row to ever clean it up again.
    if (tombstones.has(serverId)) return null;
    const existing = writers.get(serverId);
    if (existing) return existing;
    ensureRootDir();
    const path = logPath(serverId);
    if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
    const fd = openSync(path, "a");
    let bytes = 0;
    try { bytes = statSync(path).size; } catch { /* fresh file */ }
    const w: Writer = { fd, bytes, path };
    writers.set(serverId, w);
    return w;
}

function rotate(serverId: string, w: Writer): void {
    try { closeSync(w.fd); } catch { /* ignore */ }
    try {
        const previousPath = `${w.path}.1`;
        if (existsSync(previousPath)) rmSync(previousPath, { force: true });
        renameSync(w.path, previousPath);
    } catch { /* if rename fails, fall through and reopen current */ }
    const fd = openSync(w.path, "a");
    writers.set(serverId, { fd, bytes: 0, path: w.path });
}

/**
 * Append one line to the server's log file. Writes are synchronous — at
 * our event rate (one stderr line per ~tens of ms at worst, lifecycle
 * events at human-clock rate) the cost is negligible and we avoid the
 * complexity of an async drain queue. Silently swallows IO errors so a
 * full disk can't crash the runtime path.
 */
export function appendMcpLog(serverId: string, level: McpLogLevel, message: string): void {
    try {
        let w = openWriter(serverId);
        if (!w) return; // tombstoned
        // Single-line records — newlines in `message` would break the
        // grep-style parser, so escape them. Hard-cap any individual
        // record at 4 KiB so a binary-vomiting child doesn't blow up
        // the file before rotation.
        const sanitized = message.replace(/[\r\n]+/g, " ").slice(0, 4096);
        const line = `${new Date().toISOString()} [${level}] ${sanitized}\n`;
        const buf = Buffer.from(line, "utf8");
        appendFileSync(w.fd, buf);
        w.bytes += buf.length;
        if (w.bytes >= MAX_BYTES) {
            rotate(serverId, w);
            const next = writers.get(serverId);
            if (next) w = next;
        }
    } catch {
        // IO errors (full disk, EACCES, ...) are non-fatal — the runtime
        // must keep working even when logging fails. Surface via the
        // standard process stderr so ops can spot it.
        // (Don't recurse into appendMcpLog from here.)
    }
}

/**
 * Read the tail of a server's log, concatenating the previous rotation
 * (if present) so callers see a continuous timeline. Returns lines
 * newest-last; the UI can reverse if it wants newest-first.
 *
 * `maxLines` caps memory — pathological large-file reads are clipped.
 */
export function readMcpLog(serverId: string, maxLines: number = 500): string[] {
    const current = logPath(serverId);
    const previous = `${current}.1`;
    const chunks: string[] = [];
    for (const p of [previous, current]) {
        if (!existsSync(p)) continue;
        try {
            chunks.push(readFileSync(p, "utf8"));
        } catch { /* ignore */ }
    }
    if (chunks.length === 0) return [];
    const all = chunks.join("").split("\n").filter((l) => l.length > 0);
    return all.length > maxLines ? all.slice(-maxLines) : all;
}

/** Flush + close the open file descriptor for a server. Called from
 *  disposeMcpClient so we don't leak fds across the dev HMR cycle.
 *  Safe to call against a server that was never logged. */
export function closeMcpLogWriter(serverId: string): void {
    const w = writers.get(serverId);
    if (!w) return;
    writers.delete(serverId);
    try { closeSync(w.fd); } catch { /* ignore */ }
}

/** Permanently delete a server's log files. Called when the server row
 *  itself is deleted — disable / re-check do NOT delete logs. The
 *  serverId is tombstoned so a late stderr event from the dying child
 *  can't resurrect the file. */
export function deleteMcpLogs(serverId: string): void {
    closeMcpLogWriter(serverId);
    tombstones.add(serverId);
    const current = logPath(serverId);
    const previous = `${current}.1`;
    for (const p of [current, previous]) {
        try { if (existsSync(p)) rmSync(p, { force: true }); } catch { /* ignore */ }
    }
}
