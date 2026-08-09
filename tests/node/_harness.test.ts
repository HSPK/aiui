import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "@/lib/server/db";
import { resetDb, seedUser, seedProvider, seedModel, seedConversation, seedMessage, seedLog, seedTool, seedMcpServer } from "../helpers/db";

describe("test harness", () => {
    beforeEach(() => resetDb());

    it("seeds every table and wipes cleanly", () => {
        const u = seedUser({ username: "alice" });
        const p = seedProvider({ name: "openai" });
        const m = seedModel({ providerId: p.id, name: "gpt-4o" });
        const c = seedConversation({ userId: u.id });
        seedMessage({ conversationId: c.id });
        seedLog({ userId: u.id });
        seedTool();
        seedMcpServer();

        expect(db.select().from(schema.users).all()).toHaveLength(1);
        expect(db.select().from(schema.models).all()[0].name).toBe("gpt-4o");
        expect(m.providerId).toBe(p.id);

        resetDb();
        expect(db.select().from(schema.users).all()).toHaveLength(0);
        expect(db.select().from(schema.messages).all()).toHaveLength(0);
    });
});
