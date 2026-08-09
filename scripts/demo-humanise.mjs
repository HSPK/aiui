// Makes the seeded traffic look like a month of real usage.
//
// The requests themselves are real — they went through the gateway and
// were logged by it — but they all happened just now, against a local
// upstream that answers in microseconds. Two things therefore need
// adjusting before the dashboard is worth showing:
//
//   1. Timestamps. Spread over the trailing 30 days with a weekday /
//      weekend rhythm and a mild upward trend, so the trend chart has a
//      shape instead of a single spike.
//   2. Latencies. A 2 ms average is an artifact of the loopback
//      upstream and would misrepresent what a real deployment looks
//      like, so each row gets a plausible per-model TTFT and total
//      drawn around published-ish figures. A small error rate is mixed
//      in for the same reason: a dashboard that can only ever render 0%
//      shows nothing about the feature.
//
//   node scripts/demo-humanise.mjs /data/loom.db

import Database from "better-sqlite3";

const DB_PATH = process.argv[2] || "/data/loom.db";
const DAYS = 30;

// [ttft floor, ttft spread, per-token ms] — bigger models start slower
// and decode slower.
const PROFILE = {
    "gpt-4o": [320, 260, 11],
    "gpt-4o-mini": [180, 140, 6],
    "o3-mini": [700, 900, 14],
    "claude-sonnet-4": [380, 300, 12],
    "claude-haiku-4": [160, 130, 5],
    "llama-3.3-70b-instruct": [240, 200, 9],
    "llama-3.3-70b-versatile": [90, 70, 3],
    "mistral-large": [280, 220, 10],
    "claude-opus-4": [520, 420, 18],
    "qwen2.5-coder-32b": [200, 180, 7],
    "text-embedding-3-small": [40, 30, 0],
    "text-embedding-3-large": [60, 45, 0],
};
const DEFAULT_PROFILE = [250, 200, 9];

// Deterministic PRNG so re-running produces the same screenshots.
let seed = 20260809;
const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const jitter = (base, spread) => Math.round(base + rnd() * spread);

const db = new Database(DB_PATH);

const rows = db.prepare("SELECT id, model_name, capability, completion_tokens FROM generation_logs").all();
// Shuffle so every model and capability is represented on every day —
// otherwise the backfill follows insertion order and the chart shows all
// the chat traffic first, then a block of embeddings.
for (let i = rows.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [rows[i], rows[j]] = [rows[j], rows[i]];
}

const dayWeight = (daysAgo) => {
    const dow = new Date(Date.now() - daysAgo * 86400000).getUTCDay();
    const weekend = dow === 0 || dow === 6 ? 0.4 : 1;
    const growth = 0.7 + ((DAYS - 1 - daysAgo) / (DAYS - 1)) * 0.6;
    return weekend * growth;
};

const weights = [];
for (let d = DAYS - 1; d >= 0; d--) weights.push({ d, w: dayWeight(d) });
const totalWeight = weights.reduce((s, e) => s + e.w, 0);

const update = db.prepare(`
    UPDATE generation_logs
       SET created_at = ?, updated_at = ?,
           first_token_latency_ms = ?, total_latency_ms = ?, status = ?, reason = ?
     WHERE id = ?
`);

let i = 0;
let failed = 0;

function stamp(daysAgo) {
    const t = new Date(Date.now() - daysAgo * 86400000);
    // Office hours, so the "recent activity" list reads naturally.
    t.setUTCHours(8 + Math.floor(rnd() * 11), Math.floor(rnd() * 60), Math.floor(rnd() * 60), 0);
    return t.toISOString();
}

function apply(row, daysAgo) {
    const [floor, spread, perToken] = PROFILE[row.model_name] ?? DEFAULT_PROFILE;
    const ttft = jitter(floor, spread);
    const decode = Math.round((row.completion_tokens ?? 0) * perToken * (0.8 + rnd() * 0.5));
    const total = ttft + decode;

    // ~1.5% of traffic fails, the way it does against real providers.
    const fails = rnd() < 0.015;
    if (fails) failed++;

    const iso = stamp(daysAgo);
    update.run(
        iso, iso,
        row.capability === "embedding" ? null : ttft,
        fails ? jitter(900, 400) : total,
        fails ? "failed" : "completed",
        fails ? "upstream returned 429: rate limit exceeded" : null,
        row.id,
    );
}

const tx = db.transaction(() => {
    for (const { d, w } of weights) {
        const count = Math.round((rows.length * w) / totalWeight);
        for (let k = 0; k < count && i < rows.length; k++, i++) apply(rows[i], d);
    }
    for (; i < rows.length; i++) apply(rows[i], 0);
});
tx();

const byDay = db.prepare(`
    SELECT substr(created_at, 1, 10) AS day, count(*) AS n
      FROM generation_logs GROUP BY day ORDER BY day DESC LIMIT 5
`).all();
const latency = db.prepare(`
    SELECT round(avg(total_latency_ms)) AS avg_ms, round(avg(first_token_latency_ms)) AS avg_ttft
      FROM generation_logs WHERE status = 'completed'
`).get();

console.log(`humanised ${rows.length} logs (${failed} failed)`);
console.log(`avg total ${latency.avg_ms}ms · avg ttft ${latency.avg_ttft}ms`);
console.log(byDay);
