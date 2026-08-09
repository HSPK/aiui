import { appendFileSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

// Benchmarks are only useful if the numbers survive the run. Every spec
// appends a JSON line; `bench-report.mjs` renders them into a table so a
// regression is visible in a diff rather than buried in test output.

const OUT = resolve(process.cwd(), "e2e/.artifacts/perf-metrics.jsonl");

export interface Metric {
    group: string;
    name: string;
    values: Record<string, number>;
    notes?: string;
}

export function recordMetric(m: Metric): void {
    mkdirSync(dirname(OUT), { recursive: true });
    appendFileSync(OUT, JSON.stringify({ ...m, at: new Date().toISOString() }) + "\n");
    const pretty = Object.entries(m.values).map(([k, v]) => `${k}=${v}`).join("  ");
    console.log(`  [perf] ${m.group.padEnd(12)} ${m.name.padEnd(20)} ${pretty}`);
}

export function resetMetrics(): void {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, "");
}

export function readMetrics(): Metric[] {
    if (!existsSync(OUT)) return [];
    return readFileSync(OUT, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Metric);
}
