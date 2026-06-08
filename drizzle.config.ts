import type { Config } from "drizzle-kit";

export default {
    schema: "./lib/server/db/schema.ts",
    out: "./drizzle",
    dialect: "sqlite",
    dbCredentials: {
        url: process.env.LOOM_DB_PATH || "./data/loom.db",
    },
} satisfies Config;
