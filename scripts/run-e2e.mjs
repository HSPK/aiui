#!/usr/bin/env node
// Sequential runner for all scripts/e2e-*.mjs suites.
//
// Each suite spawns its own Next server + stub upstream(s) on a
// unique port range, so we can't easily parallelize them without
// port collisions. Sequential keeps the output readable and
// matches what CI scripts expect (one failure → exit 1).
//
// `bun run test` invokes this. Add new suites by dropping
// `scripts/e2e-<name>.mjs` files alongside; the runner picks them
// up via glob.

import { spawn } from "node:child_process"
import { readdirSync } from "node:fs"
import { resolve } from "node:path"

const SCRIPTS_DIR = resolve(process.cwd(), "scripts")
const suites = readdirSync(SCRIPTS_DIR)
    .filter((f) => f.startsWith("e2e-") && f.endsWith(".mjs"))
    .sort()

if (suites.length === 0) {
    console.error("no e2e-*.mjs suites found in scripts/")
    process.exit(1)
}

const startedAt = Date.now()
let totalPassed = 0
let totalExpectations = 0
const failures = []

for (const suite of suites) {
    const t0 = Date.now()
    const child = spawn(process.execPath, [resolve(SCRIPTS_DIR, suite)], {
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
    })
    let tail = ""
    let buf = ""
    child.stdout.on("data", (c) => {
        buf += c.toString()
    })
    child.stderr.on("data", (c) => {
        buf += c.toString()
    })
    const code = await new Promise((r) => child.once("exit", (c) => r(c)))
    const elapsed = Date.now() - t0
    tail = buf.trim().split("\n").slice(-1)[0]
    const m = tail.match(/(\d+)\/(\d+) expectations passed/)
    if (m) {
        const [, p, t] = m
        totalPassed += Number(p)
        totalExpectations += Number(t)
    }
    const tag = code === 0 ? "✓" : "✗"
    console.log(`${tag} ${suite.padEnd(36)} ${tail} (${elapsed}ms)`)
    if (code !== 0) {
        failures.push({ suite, code, tail, output: buf.split("\n").slice(-30).join("\n") })
    }
}

const totalElapsed = Date.now() - startedAt
console.log(`\nTotal: ${totalPassed}/${totalExpectations} expectations across ${suites.length} suites in ${(totalElapsed / 1000).toFixed(1)}s`)

if (failures.length > 0) {
    console.log(`\n${failures.length} suite(s) failed:`)
    for (const f of failures) {
        console.log(`\n=== ${f.suite} (exit ${f.code}) ===`)
        console.log(f.output)
    }
    process.exit(1)
}
process.exit(0)
