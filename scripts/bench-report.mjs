#!/usr/bin/env node
// Render the browser benchmark results into a readable table.
//
//   node scripts/bench-report.mjs            # markdown to stdout
//   node scripts/bench-report.mjs --json     # raw metrics
//
// Reads the JSONL written by e2e/perf/support/report.ts during a
// `--project=perf` run. Checked-in expectations live in e2e/perf/BASELINE.md
// so a regression shows up as a diff rather than as folklore.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const FILE = resolve(process.cwd(), "e2e/.artifacts/perf-metrics.jsonl");

if (!existsSync(FILE)) {
    console.error("No metrics found. Run:  bun run bench:web");
    process.exit(1);
}

const metrics = readFileSync(FILE, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

if (process.argv.includes("--json")) {
    console.log(JSON.stringify(metrics, null, 2));
    process.exit(0);
}

const groups = new Map();
for (const m of metrics) {
    if (!groups.has(m.group)) groups.set(m.group, []);
    groups.get(m.group).push(m);
}

const TITLES = {
    "web-vitals": "Core Web Vitals (cold navigation, production build)",
    bundle: "Transferred bytes per route",
    streaming: "Streaming responsiveness",
};

console.log(`# Loom browser benchmarks\n`);
console.log(`Generated ${new Date().toISOString()} — Chromium, \`next start\`, loopback.\n`);

for (const [group, rows] of groups) {
    console.log(`## ${TITLES[group] ?? group}\n`);
    const cols = [...new Set(rows.flatMap((r) => Object.keys(r.values)))];
    console.log(`| target | ${cols.join(" | ")} |`);
    console.log(`| --- | ${cols.map(() => "---:").join(" | ")} |`);
    for (const r of rows) {
        console.log(`| \`${r.name}\` | ${cols.map((c) => r.values[c] ?? "").join(" | ")} |`);
    }
    console.log("");
}

const streaming = groups.get("streaming") ?? [];
const inp = streaming.find((r) => r.values.inp_p95_ms !== undefined);
if (inp) {
    const p95 = inp.values.inp_p95_ms;
    const verdict = p95 < 200 ? "good" : p95 < 500 ? "needs improvement" : "poor";
    console.log(`> Interaction-to-next-paint while streaming: **p95 ${p95} ms** (${verdict} by Core Web Vitals thresholds).`);
}
