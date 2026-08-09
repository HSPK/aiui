#!/usr/bin/env node
// Lint gate that fails on NEW errors rather than on the existing backlog.
//
// `eslint` exits non-zero while the repo carries its documented baseline of
// pre-existing errors, so a plain `bun run lint` in CI can never go green and
// tells you nothing. This compares the current error count against that
// baseline: more than the baseline fails, fewer prints how far to lower it.
//
//   node scripts/lint-baseline.mjs

import { spawnSync } from "node:child_process";

// Errors present before the test suite landed, all in app/ and components/.
// Lower this whenever the count drops — never raise it to make a build pass.
const BASELINE_ERRORS = 78;

const run = spawnSync("npx", ["eslint", ".", "-f", "json"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
});

if (!run.stdout) {
    console.error("[lint] eslint produced no output");
    console.error(run.stderr ?? "");
    process.exit(1);
}

let results;
try {
    results = JSON.parse(run.stdout);
} catch {
    console.error("[lint] could not parse eslint JSON output");
    console.error(run.stdout.slice(0, 2000));
    process.exit(1);
}

const byDir = new Map();
let errors = 0;
let warnings = 0;
for (const file of results) {
    const rel = file.filePath.replace(`${process.cwd()}/`, "");
    const dir = rel.split("/")[0];
    for (const m of file.messages) {
        if (m.severity === 2) {
            errors++;
            byDir.set(dir, (byDir.get(dir) ?? 0) + 1);
        } else {
            warnings++;
        }
    }
}

const summary = [...byDir.entries()].sort((a, b) => b[1] - a[1]).map(([d, n]) => `${d}=${n}`).join(" ");
console.log(`[lint] ${errors} errors, ${warnings} warnings (baseline ${BASELINE_ERRORS})`);
if (summary) console.log(`[lint] errors by directory: ${summary}`);

if (errors > BASELINE_ERRORS) {
    console.error(`\n[lint] FAIL: ${errors - BASELINE_ERRORS} new error(s) above the baseline.`);
    for (const file of results) {
        for (const m of file.messages) {
            if (m.severity !== 2) continue;
            const rel = file.filePath.replace(`${process.cwd()}/`, "");
            console.error(`  ${rel}:${m.line}:${m.column}  ${m.ruleId ?? "?"}  ${m.message}`);
        }
    }
    process.exit(1);
}

if (errors < BASELINE_ERRORS) {
    console.log(`[lint] baseline can be lowered to ${errors} in scripts/lint-baseline.mjs`);
}
process.exit(0);
