import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
    appendMcpLog,
    closeMcpLogWriter,
    deleteMcpLogs,
    readMcpLog,
} from "@/lib/server/mcp/logs";

// logs.ts resolves its root dir once at import time from
// LOOM_MCP_LOGS_DIR || `${LOOM_USER_CWD}/data/mcp-logs`. tests/setup/node.ts
// points LOOM_USER_CWD at this file's private temp dir before any import
// runs, so this mirrors exactly what the module itself computed.
const ROOT_DIR = resolve(process.env.LOOM_USER_CWD as string, "data", "mcp-logs");

const openWriterIds: string[] = [];
function newId(): string {
    const id = randomUUID();
    openWriterIds.push(id);
    return id;
}

afterEach(() => {
    // Tear down every writer opened by the test so fds never leak across
    // tests within this file (writers/tombstones persist on globalThis for
    // the lifetime of the file's module instance).
    for (const id of openWriterIds.splice(0)) {
        closeMcpLogWriter(id);
    }
});

describe("appendMcpLog / readMcpLog", () => {
    it("returns an empty array for a server that was never logged", () => {
        expect(readMcpLog(newId())).toEqual([]);
    });

    it("appends a single line and reads it back with a level tag", () => {
        const id = newId();
        appendMcpLog(id, "lifecycle", "spawning command=npx");
        const lines = readMcpLog(id);
        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z \[lifecycle] spawning command=npx$/);
    });

    it("preserves insertion order across multiple appends (newest-last)", () => {
        const id = newId();
        appendMcpLog(id, "stderr", "line one");
        appendMcpLog(id, "connect", "line two");
        appendMcpLog(id, "lifecycle", "line three");
        const lines = readMcpLog(id);
        expect(lines).toHaveLength(3);
        expect(lines[0]).toContain("line one");
        expect(lines[0]).toContain("[stderr]");
        expect(lines[1]).toContain("line two");
        expect(lines[1]).toContain("[connect]");
        expect(lines[2]).toContain("line three");
    });

    it("collapses embedded newlines/carriage-returns into a single log line", () => {
        const id = newId();
        appendMcpLog(id, "stderr", "first\nsecond\r\nthird");
        const lines = readMcpLog(id);
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain("first second third");
    });

    it("caps an individual record at 4096 characters", () => {
        const id = newId();
        const huge = "x".repeat(5000);
        appendMcpLog(id, "stderr", huge);
        const lines = readMcpLog(id);
        expect(lines).toHaveLength(1);
        // "<iso> [stderr] " prefix + up to 4096 chars of message.
        const message = lines[0].split("] ").slice(1).join("] ");
        expect(message.length).toBe(4096);
    });

    it("respects the maxLines cap, keeping only the tail", () => {
        const id = newId();
        for (let i = 0; i < 10; i++) appendMcpLog(id, "lifecycle", `entry-${i}`);
        const lines = readMcpLog(id, 3);
        expect(lines).toHaveLength(3);
        expect(lines[0]).toContain("entry-7");
        expect(lines[1]).toContain("entry-8");
        expect(lines[2]).toContain("entry-9");
    });

    it("keeps independent log files per server id", () => {
        const idA = newId();
        const idB = newId();
        appendMcpLog(idA, "lifecycle", "for A only");
        appendMcpLog(idB, "lifecycle", "for B only");
        expect(readMcpLog(idA).join()).toContain("for A only");
        expect(readMcpLog(idA).join()).not.toContain("for B only");
        expect(readMcpLog(idB).join()).toContain("for B only");
    });

    it("sanitizes a pathological serverId instead of writing outside the log root", () => {
        const traversal = "../../etc/passwd";
        expect(() => appendMcpLog(traversal, "lifecycle", "should stay contained")).not.toThrow();
        // The sanitized filename lands inside ROOT_DIR — no file escapes it.
        const entries = existsSync(ROOT_DIR) ? readdirSync(ROOT_DIR) : [];
        for (const entry of entries) {
            expect(entry).not.toContain("..");
            expect(entry).not.toContain("/");
        }
        closeMcpLogWriter(traversal);
        deleteMcpLogs(traversal);
    });
});

describe("closeMcpLogWriter", () => {
    it("is a no-op for a server that was never logged", () => {
        expect(() => closeMcpLogWriter(newId())).not.toThrow();
    });

    it("closes the fd but leaves the file's content readable via readMcpLog", () => {
        const id = newId();
        appendMcpLog(id, "lifecycle", "before close");
        closeMcpLogWriter(id);
        expect(readMcpLog(id)).toEqual([expect.stringContaining("before close")]);
    });

    it("reopens a fresh writer on the next append after being closed", () => {
        const id = newId();
        appendMcpLog(id, "lifecycle", "first");
        closeMcpLogWriter(id);
        appendMcpLog(id, "lifecycle", "second");
        const lines = readMcpLog(id);
        expect(lines).toHaveLength(2);
        expect(lines[0]).toContain("first");
        expect(lines[1]).toContain("second");
    });
});

describe("deleteMcpLogs", () => {
    it("removes the log file from disk", () => {
        const id = newId();
        appendMcpLog(id, "lifecycle", "will be deleted");
        expect(readMcpLog(id)).toHaveLength(1);
        deleteMcpLogs(id);
        expect(readMcpLog(id)).toEqual([]);
    });

    it("tombstones the id so a late append cannot resurrect the file", () => {
        const id = newId();
        appendMcpLog(id, "lifecycle", "will be deleted");
        deleteMcpLogs(id);
        // Simulates a straggling stderr flush from a dying child arriving
        // AFTER the row (and its logs) were already deleted.
        appendMcpLog(id, "stderr", "late straggler, must be dropped");
        expect(readMcpLog(id)).toEqual([]);
    });

    it("is safe to call twice in a row", () => {
        const id = newId();
        appendMcpLog(id, "lifecycle", "x");
        expect(() => {
            deleteMcpLogs(id);
            deleteMcpLogs(id);
        }).not.toThrow();
    });

    it("only deletes the targeted server's files, not siblings", () => {
        const idA = newId();
        const idB = newId();
        appendMcpLog(idA, "lifecycle", "keep me");
        appendMcpLog(idB, "lifecycle", "delete me");
        deleteMcpLogs(idB);
        expect(readMcpLog(idA)).toHaveLength(1);
        expect(readMcpLog(idB)).toEqual([]);
    });
});

describe("appendMcpLog error resilience", () => {
    it("silently swallows an IO error instead of throwing (read-only log root)", () => {
        mkdirSync(ROOT_DIR, { recursive: true });
        const before = statSync(ROOT_DIR).mode;
        chmodSync(ROOT_DIR, 0o500); // r-x — blocks creating a new file inside.
        const id = newId();
        try {
            expect(() => appendMcpLog(id, "stderr", "should not throw")).not.toThrow();
        } finally {
            chmodSync(ROOT_DIR, before);
        }
        expect(readMcpLog(id)).toEqual([]);
    });
});

/** Append near-max-size (4096-char) records of `fillChar` until `.log.1`
 *  first appears (i.e. exactly one rotation happens), then stop — no extra
 *  writes land in the fresh post-rotation file. Returns the iteration count
 *  so a caller can replay the identical count to deterministically trigger
 *  a SECOND rotation from a known-empty starting file. */
function fillUntilRotated(id: string, fillChar: string, previousPath: string): number {
    const chunk = fillChar.repeat(4096);
    let count = 0;
    while (!existsSync(previousPath) && count < 5000) {
        appendMcpLog(id, "stderr", chunk);
        count++;
    }
    if (!existsSync(previousPath)) throw new Error("did not rotate within 5000 iterations");
    return count;
}

describe("rotation", () => {
    it("rotates to <id>.log.1 once the current file crosses MAX_BYTES, and a fresh write after rotation lands in the new current file", () => {
        const id = newId();
        const current = resolve(ROOT_DIR, `${id}.log`);
        const previous = resolve(ROOT_DIR, `${id}.log.1`);
        fillUntilRotated(id, "a", previous);

        // The append that crossed the threshold triggered rotation — the
        // then-current file (now holding ~5 MiB) became `.log.1`, and a
        // brand-new (empty) file was opened as `.log`.
        expect(statSync(current).size).toBe(0);
        expect(statSync(previous).size).toBeGreaterThanOrEqual(5 * 1024 * 1024);

        appendMcpLog(id, "lifecycle", "after rotation");
        const lines = readMcpLog(id, 1);
        expect(lines[0]).toContain("after rotation");
    }, 30_000);

    it("overwrites (not accumulates) the previous rotation on a second rotation", () => {
        const id = newId();
        const previous = resolve(ROOT_DIR, `${id}.log.1`);
        // First rotation, filled with "b"s. fillUntilRotated stops the
        // instant rotation fires, so the post-rotation current file is
        // guaranteed empty (0 bytes) — no "b" leftovers to contaminate
        // round two.
        const n = fillUntilRotated(id, "b", previous);
        const firstRotationSize = statSync(previous).size;
        expect(firstRotationSize).toBeGreaterThan(0);

        // Current starts at 0 bytes again with the same record size as
        // round one, so replaying the identical iteration count crosses
        // MAX_BYTES on the exact same nth append — deterministic without
        // needing to poll or re-derive the crossing point.
        const chunk2 = "c".repeat(4096);
        for (let i = 0; i < n; i++) appendMcpLog(id, "stderr", chunk2);

        expect(existsSync(previous)).toBe(true);
        // Second rotation must OVERWRITE, not append to, the previous
        // rotation file — its content is entirely "c"s, no "b" survives.
        const content = readFileSync(previous, "utf8");
        expect(content).not.toContain("b");
        expect(content).toContain("c");
    }, 30_000);
});
