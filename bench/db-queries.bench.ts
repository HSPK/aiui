import { bench, describe } from "vitest";
import { randomUUID } from "node:crypto";
import { db, schema } from "@/lib/server/db";
import { refreshQueryPlannerStats } from "@/lib/server/db/startup";
import { listLogs } from "@/lib/server/logs";
import { getOverview } from "@/lib/server/stats";
import { listConversations, listMessages } from "@/lib/server/conversations";
import type { SessionUser } from "@/lib/server/auth";

// Page-load queries against a realistically-sized table. The point is to
// catch "works on my 50-row dev database, full-scans in production".

const LOG_ROWS = 20_000;
const MSG_ROWS = 2_000;

const NOW_ISO = new Date().toISOString();
const admin: SessionUser = { id: "u-admin", username: "admin", role: "admin", createdAt: NOW_ISO };
const member: SessionUser = { id: "u-member", username: "member", role: "user", createdAt: NOW_ISO };

const MODELS = ["gpt-4o-mini", "gpt-4o", "claude-sonnet-4", "deepseek-chat", "text-embedding-3-small"];
const CAPS = ["chat", "chat", "chat", "embedding", "image"];
const STATUS = ["completed", "completed", "completed", "failed", "pending"] as const;

let conversationId = "";

function seed(): void {
    for (const u of [admin, member]) {
        db.insert(schema.users).values({
            id: u.id, username: u.username, passwordHash: "x", role: u.role,
            createdAt: new Date().toISOString(),
        }).onConflictDoNothing().run();
    }

    const now = Date.now();
    const batch: (typeof schema.generationLogs.$inferInsert)[] = [];
    for (let i = 0; i < LOG_ROWS; i++) {
        batch.push({
            id: randomUUID(),
            userId: i % 3 === 0 ? member.id : admin.id,
            modelName: MODELS[i % MODELS.length],
            capability: CAPS[i % CAPS.length],
            status: STATUS[i % STATUS.length],
            input: { messages: [{ role: "user", content: "hi" }] },
            inputSummary: `request number ${i}`,
            output: "some output text",
            generationKwargs: {},
            promptTokens: 100 + (i % 50),
            completionTokens: 200 + (i % 90),
            totalTokens: 300 + (i % 140),
            firstTokenLatencyMs: 50 + (i % 400),
            totalLatencyMs: 400 + (i % 3000),
            isDeleted: false,
            // Spread across ~30 days so the stats window has real buckets.
            createdAt: new Date(now - (i % 30) * 86_400_000 - (i % 1000) * 1000).toISOString(),
            updatedAt: new Date(now).toISOString(),
        });
    }
    db.transaction((tx) => {
        for (let i = 0; i < batch.length; i += 500) {
            tx.insert(schema.generationLogs).values(batch.slice(i, i + 500)).run();
        }
    });

    for (let c = 0; c < 40; c++) {
        const id = randomUUID();
        if (c === 0) conversationId = id;
        db.insert(schema.conversations).values({
            id, userId: member.id, title: `conversation ${c}`, config: {},
            groupId: null, isDeleted: false,
            createdAt: new Date(now - c * 3600_000).toISOString(),
            updatedAt: new Date(now - c * 3600_000).toISOString(),
        }).run();
    }

    const msgs: (typeof schema.messages.$inferInsert)[] = [];
    for (let i = 0; i < MSG_ROWS; i++) {
        msgs.push({
            id: randomUUID(),
            conversationId,
            role: i % 2 === 0 ? "user" : "assistant",
            content: [{ type: "text", text: `message body ${i} `.repeat(10) }],
            isActive: true,
            createdAt: new Date(now - (MSG_ROWS - i) * 1000).toISOString(),
        });
    }
    db.transaction((tx) => {
        for (let i = 0; i < msgs.length; i += 500) {
            tx.insert(schema.messages).values(msgs.slice(i, i + 500)).run();
        }
    });
}

seed();
// Mirror production boot: lib/server/db/index.ts calls this after
// migrations so the planner has statistics for the 9 indexes on
// generation_logs. Benchmarking without it measures a database state
// that never reaches production.
refreshQueryPlannerStats(db);

describe(`listLogs (${LOG_ROWS} rows)`, () => {
    bench("page 1, no filter, admin", () => {
        listLogs(admin, { page: 1, page_size: 20, sort: "-created_at" } as never);
    });

    bench("page 1, non-admin (scoped to own rows)", () => {
        listLogs(member, { page: 1, page_size: 20, sort: "-created_at" } as never);
    });

    bench("filter by capability", () => {
        listLogs(admin, { page: 1, page_size: 20, sort: "-created_at", capability: "chat" } as never);
    });

    bench("filter by status", () => {
        listLogs(admin, { page: 1, page_size: 20, sort: "-created_at", status: "failed" } as never);
    });

    bench("LIKE filter on model_name", () => {
        listLogs(admin, { page: 1, page_size: 20, sort: "-created_at", model_name: "gpt" } as never);
    });

    bench("deep page (offset 10000)", () => {
        listLogs(admin, { page: 501, page_size: 20, sort: "-created_at" } as never);
    });
});

describe(`stats getOverview (${LOG_ROWS} rows)`, () => {
    bench("7-day window", () => {
        getOverview(admin, { days: 7 } as never);
    });

    bench("30-day window", () => {
        getOverview(admin, { days: 30 } as never);
    });
});

describe("conversations", () => {
    bench("listConversations page 1", () => {
        listConversations(member.id, { page: 1, page_size: 20, sort: "-updated_at" } as never);
    });

    bench(`listMessages page 1 (${MSG_ROWS} in conversation)`, () => {
        listMessages(member.id, conversationId, { page: 1, page_size: 30, sort: "-created_at" } as never);
    });
});
