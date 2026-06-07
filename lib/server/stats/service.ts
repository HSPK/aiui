import "server-only";
import { and, count, eq, gte, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import { generationLogs } from "../db/schema";
import { listAllModels } from "../models";
import type { SessionUser } from "../auth";
import type {
    ModelStatsDTO,
    StatsBucket,
    StatsModelTrendDetail,
    StatsModelTrendPoint,
    StatsOverviewDTO,
    StatsQuery,
    StatsTrendPoint,
} from "@/lib/schemas/stats";

const TOP_MODEL_BUCKETS = 8;
const OTHER_KEY = "_other";

function toDay(d: Date): string {
    return d.toISOString().slice(0, 10);
}

function makeWindow(days: number) {
    const end = new Date();
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - (days - 1));
    start.setUTCHours(0, 0, 0, 0);
    return {
        startIso: start.toISOString(),
        startDay: toDay(start),
        endDay: toDay(end),
        start,
        days,
    };
}

function fillDays<T extends { day: string }>(
    start: Date,
    days: number,
    rows: Map<string, T>,
    blank: (day: string) => T
): T[] {
    const out: T[] = []
    const cursor = new Date(start)
    for (let i = 0; i < days; i++) {
        const d = toDay(cursor)
        out.push(rows.get(d) ?? blank(d))
        cursor.setUTCDate(cursor.getUTCDate() + 1)
    }
    return out
}

/** SQLite-friendly day truncation. `created_at` is stored as ISO text;
 *  the first 10 chars are the YYYY-MM-DD prefix. */
const dayExpr = sql<string>`substr(${generationLogs.createdAt}, 1, 10)`;

function userScopeFilters(user: SessionUser, requestedUserId?: string): SQL[] {
    const filters: SQL[] = [eq(generationLogs.isDeleted, false)];
    if (user.role !== "admin") {
        filters.push(eq(generationLogs.userId, user.id));
    } else if (requestedUserId) {
        filters.push(eq(generationLogs.userId, requestedUserId));
    }
    return filters;
}

export function getOverview(user: SessionUser, query: StatsQuery): StatsOverviewDTO {
    const { startIso, startDay, endDay, start, days } = makeWindow(query.days);

    const baseFilters: SQL[] = [
        ...userScopeFilters(user, query.user_id),
        gte(generationLogs.createdAt, startIso),
    ];
    const where = and(...baseFilters);

    // ---- totals ----
    const totalsRow = db
        .select({
            requests: count(),
            completed: sql<number>`sum(case when ${generationLogs.status} = 'completed' then 1 else 0 end)`,
            failed: sql<number>`sum(case when ${generationLogs.status} = 'failed' then 1 else 0 end)`,
            pending: sql<number>`sum(case when ${generationLogs.status} = 'pending' then 1 else 0 end)`,
            promptTokens: sql<number>`coalesce(sum(${generationLogs.promptTokens}), 0)`,
            completionTokens: sql<number>`coalesce(sum(${generationLogs.completionTokens}), 0)`,
            totalTokens: sql<number>`coalesce(sum(${generationLogs.totalTokens}), 0)`,
            avgFirst: sql<number | null>`avg(${generationLogs.firstTokenLatencyMs})`,
            avgTotal: sql<number | null>`avg(${generationLogs.totalLatencyMs})`,
        })
        .from(generationLogs)
        .where(where)
        .get();

    // ---- per-day trend ----
    const trendRows = db
        .select({
            day: dayExpr,
            requests: count(),
            promptTokens: sql<number>`coalesce(sum(${generationLogs.promptTokens}), 0)`,
            completionTokens: sql<number>`coalesce(sum(${generationLogs.completionTokens}), 0)`,
            totalTokens: sql<number>`coalesce(sum(${generationLogs.totalTokens}), 0)`,
            failed: sql<number>`sum(case when ${generationLogs.status} = 'failed' then 1 else 0 end)`,
        })
        .from(generationLogs)
        .where(where)
        .groupBy(dayExpr)
        .all();

    const trendByDay = new Map<string, StatsTrendPoint>();
    for (const r of trendRows) {
        trendByDay.set(r.day, {
            day: r.day,
            requests: Number(r.requests ?? 0),
            prompt_tokens: Number(r.promptTokens ?? 0),
            completion_tokens: Number(r.completionTokens ?? 0),
            total_tokens: Number(r.totalTokens ?? 0),
            failed: Number(r.failed ?? 0),
        });
    }
    const trend = fillDays(start, days, trendByDay, (day) => ({
        day,
        requests: 0,
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        failed: 0,
    }));

    // ---- by capability ----
    const capRows = db
        .select({
            key: generationLogs.capability,
            requests: count(),
            totalTokens: sql<number>`coalesce(sum(${generationLogs.totalTokens}), 0)`,
        })
        .from(generationLogs)
        .where(where)
        .groupBy(generationLogs.capability)
        .all();
    const by_capability: StatsBucket[] = capRows
        .map((r) => ({
            key: r.key ?? "unknown",
            label: r.key ?? "unknown",
            requests: Number(r.requests ?? 0),
            total_tokens: Number(r.totalTokens ?? 0),
        }))
        .sort((a, b) => b.requests - a.requests);

    // ---- by model (full + top slice) ----
    const modelRows = db
        .select({
            key: generationLogs.modelName,
            requests: count(),
            totalTokens: sql<number>`coalesce(sum(${generationLogs.totalTokens}), 0)`,
        })
        .from(generationLogs)
        .where(where)
        .groupBy(generationLogs.modelName)
        .all();
    const allByModel: StatsBucket[] = modelRows
        .map((r) => ({
            key: r.key,
            label: r.key,
            requests: Number(r.requests ?? 0),
            total_tokens: Number(r.totalTokens ?? 0),
        }))
        .sort((a, b) => b.requests - a.requests);
    const by_model = allByModel.slice(0, TOP_MODEL_BUCKETS);

    // ---- trend by model (long format, top N + _other) ----
    const topModelKeys = by_model.map((b) => b.key);
    const trendByModelRows = db
        .select({
            day: dayExpr,
            model: generationLogs.modelName,
            requests: count(),
        })
        .from(generationLogs)
        .where(where)
        .groupBy(dayExpr, generationLogs.modelName)
        .all();

    const topSet = new Set(topModelKeys);
    const hasOther = allByModel.length > by_model.length;
    const trend_by_model: StatsModelTrendPoint[] = [];
    const otherByDay = new Map<string, number>();
    for (const r of trendByModelRows) {
        const requests = Number(r.requests ?? 0);
        if (topSet.has(r.model)) {
            trend_by_model.push({ day: r.day, model: r.model, requests });
        } else if (hasOther) {
            otherByDay.set(r.day, (otherByDay.get(r.day) ?? 0) + requests);
        }
    }
    for (const [day, requests] of otherByDay) {
        trend_by_model.push({ day, model: OTHER_KEY, requests });
    }
    const trend_models = hasOther ? [...topModelKeys, OTHER_KEY] : topModelKeys;

    return {
        window_start: startDay,
        window_end: endDay,
        days,
        totals: {
            requests: Number(totalsRow?.requests ?? 0),
            completed: Number(totalsRow?.completed ?? 0),
            failed: Number(totalsRow?.failed ?? 0),
            pending: Number(totalsRow?.pending ?? 0),
            prompt_tokens: Number(totalsRow?.promptTokens ?? 0),
            completion_tokens: Number(totalsRow?.completionTokens ?? 0),
            total_tokens: Number(totalsRow?.totalTokens ?? 0),
            avg_first_token_latency_ms:
                totalsRow?.avgFirst != null ? Math.round(Number(totalsRow.avgFirst)) : null,
            avg_total_latency_ms:
                totalsRow?.avgTotal != null ? Math.round(Number(totalsRow.avgTotal)) : null,
        },
        trend,
        trend_by_model,
        trend_models,
        by_capability,
        by_model,
    };
}

/** Per-model deep dive. Looks up model meta from the registered catalog
 *  (provider / capability / context) then aggregates logs scoped to
 *  that model name in the same window shape as the overview. */
export async function getModelStats(
    user: SessionUser,
    modelName: string,
    query: StatsQuery
): Promise<ModelStatsDTO> {
    const { startIso, startDay, endDay, start, days } = makeWindow(query.days);

    const baseFilters: SQL[] = [
        ...userScopeFilters(user, query.user_id),
        gte(generationLogs.createdAt, startIso),
        // Match both the canonical alias and any historical entry by the
        // upstream model id by checking against a single column. We only
        // know the alias here, which is what gateway writes to logs.
        inArray(generationLogs.modelName, [modelName]),
    ];
    const where = and(...baseFilters);

    // ---- totals ----
    const totalsRow = db
        .select({
            requests: count(),
            completed: sql<number>`sum(case when ${generationLogs.status} = 'completed' then 1 else 0 end)`,
            failed: sql<number>`sum(case when ${generationLogs.status} = 'failed' then 1 else 0 end)`,
            pending: sql<number>`sum(case when ${generationLogs.status} = 'pending' then 1 else 0 end)`,
            promptTokens: sql<number>`coalesce(sum(${generationLogs.promptTokens}), 0)`,
            completionTokens: sql<number>`coalesce(sum(${generationLogs.completionTokens}), 0)`,
            totalTokens: sql<number>`coalesce(sum(${generationLogs.totalTokens}), 0)`,
            avgFirst: sql<number | null>`avg(${generationLogs.firstTokenLatencyMs})`,
            avgTotal: sql<number | null>`avg(${generationLogs.totalLatencyMs})`,
        })
        .from(generationLogs)
        .where(where)
        .get();

    // ---- per-day trend ----
    const trendRows = db
        .select({
            day: dayExpr,
            requests: count(),
            failed: sql<number>`sum(case when ${generationLogs.status} = 'failed' then 1 else 0 end)`,
            promptTokens: sql<number>`coalesce(sum(${generationLogs.promptTokens}), 0)`,
            completionTokens: sql<number>`coalesce(sum(${generationLogs.completionTokens}), 0)`,
            totalTokens: sql<number>`coalesce(sum(${generationLogs.totalTokens}), 0)`,
            avgFirst: sql<number | null>`avg(${generationLogs.firstTokenLatencyMs})`,
            avgTotal: sql<number | null>`avg(${generationLogs.totalLatencyMs})`,
        })
        .from(generationLogs)
        .where(where)
        .groupBy(dayExpr)
        .all();

    const trendByDay = new Map<string, StatsModelTrendDetail>();
    for (const r of trendRows) {
        trendByDay.set(r.day, {
            day: r.day,
            requests: Number(r.requests ?? 0),
            failed: Number(r.failed ?? 0),
            prompt_tokens: Number(r.promptTokens ?? 0),
            completion_tokens: Number(r.completionTokens ?? 0),
            total_tokens: Number(r.totalTokens ?? 0),
            avg_first_token_latency_ms:
                r.avgFirst != null ? Math.round(Number(r.avgFirst)) : null,
            avg_total_latency_ms:
                r.avgTotal != null ? Math.round(Number(r.avgTotal)) : null,
        });
    }
    const trend = fillDays(start, days, trendByDay, (day) => ({
        day,
        requests: 0,
        failed: 0,
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        avg_first_token_latency_ms: null,
        avg_total_latency_ms: null,
    }));

    // ---- model meta (best effort — model may have been deleted) ----
    let provider: string | null = null;
    let capability: string | null = null;
    let description: string | null = null;
    let context_window: number | null = null;
    let max_tokens: number | null = null;
    try {
        // listAllModels merges DB-backed overrides with live discovered
        // models, so freshly-discovered (no DB row) entries also resolve.
        const all = await listAllModels();
        const m = all.find((x) => x.name === modelName);
        if (m) {
            provider = m.provider ?? null;
            capability = m.type ?? null;
            description = m.description ?? null;
            context_window = m.context_window ?? null;
            max_tokens = m.max_tokens ?? null;
        }
    } catch {
        // Discovery failure — return stats with null meta rather than 500.
    }

    return {
        model_name: modelName,
        provider,
        capability,
        description,
        context_window,
        max_tokens,
        window_start: startDay,
        window_end: endDay,
        days,
        totals: {
            requests: Number(totalsRow?.requests ?? 0),
            completed: Number(totalsRow?.completed ?? 0),
            failed: Number(totalsRow?.failed ?? 0),
            pending: Number(totalsRow?.pending ?? 0),
            prompt_tokens: Number(totalsRow?.promptTokens ?? 0),
            completion_tokens: Number(totalsRow?.completionTokens ?? 0),
            total_tokens: Number(totalsRow?.totalTokens ?? 0),
            avg_first_token_latency_ms:
                totalsRow?.avgFirst != null ? Math.round(Number(totalsRow.avgFirst)) : null,
            avg_total_latency_ms:
                totalsRow?.avgTotal != null ? Math.round(Number(totalsRow.avgTotal)) : null,
        },
        trend,
    };
}
