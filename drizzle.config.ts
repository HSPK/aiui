import type { Config } from "drizzle-kit";

export default {
    schema: "./lib/server/db/schema.ts",
    out: "./drizzle",
    dialect: "sqlite",
    dbCredentials: {
        url: process.env.AIUI_DB_PATH || "./data/aiui.db",
    },
} satisfies Config;
