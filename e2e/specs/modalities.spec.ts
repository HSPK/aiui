import { test, expect, settled } from "../support/fixtures";
import type { Page } from "@playwright/test";

// Depth pass over the five non-chat playground modalities. The fake
// upstream (e2e/support/fake-upstream.mjs) only implements
// /chat/completions, /embeddings and /models, so the five pages split
// into two groups:
//
//   - embedding: "e2e-embedding" is naturally discovered (its name
//     matches the embedding capability's heuristic — see
//     components/playground/modality-filters.ts CAPABILITY_HEURISTIC),
//     fully supported end-to-end. This is the one modality where a
//     genuine successful generation is asserted.
//   - image / video / audio.speech / audio.transcription: none of the
//     "e2e" provider's discovered models match these capabilities'
//     name heuristics, so nothing would be selectable under natural
//     discovery alone. Each test creates ONE throwaway DB-backed model
//     override (admin `POST /api/models` with an explicit `type` —
//     see lib/schemas/model.ts modelCreateSchema, decoupled from name
//     heuristics) so that "a model can be picked" and "the primary
//     action is reachable" are both genuinely true, per the
//     assignment. The fake upstream has no route for these families
//     (images/generations, audio/speech, audio/transcriptions,
//     videos), so the attempted generation 404s. The gateway
//     (lib/server/gateway/index.ts: `if (!upstream.ok) return {
//     response: new Response(text, { status: upstream.status }) }`)
//     forwards that through as a clean, non-throwing HTTP error rather
//     than a 5xx/crash, and every one of these four playground
//     components shares the exact same try/catch → `patchXXX({error:
//     msg})` → `<ModalityShell error>` pattern, so the resulting UI is
//     always the shared, uniform destructive error card — never a
//     fabricated success and never an unhandled exception.
//
// Self-cleaning: every model created here is deleted in a `finally`
// block; every name is globally unique (timestamp + random suffix) so
// parallel workers — and the shared throwaway DB every spec file in
// this project runs against — never collide on name or on selection.

function uniqueName(label: string): string {
    return `e2e-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Creates a throwaway DB-backed model override pinned to an explicit
 *  capability `type`, against the "e2e" provider the `authedPage`
 *  fixture already registered (see fixtures.ts `ensureProvider`).
 *  `upstream_model_id` is never validated against the provider's real
 *  catalog (lib/server/models/service.ts `createModel`), so any value
 *  is safe — the fake upstream simply 404s when it's actually used.
 *  Runs entirely inside the page via `fetch` so the Secure session
 *  cookie is sent, mirroring `ensureProvider`'s own pattern. */
async function createModalityModel(page: Page, opts: { name: string; type: string }): Promise<void> {
    const result = await page.evaluate(async (opts) => {
        const providersRes = await fetch("/api/providers", { credentials: "include" });
        const providersBody = await providersRes.json();
        const provider = (providersBody.data ?? []).find((p: { name: string }) => p.name === "e2e");
        if (!provider) return { ok: false, status: 0, text: "e2e provider not found" };
        const res = await fetch("/api/models", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                name: opts.name,
                provider_id: provider.id,
                upstream_model_id: opts.name,
                type: opts.type,
                enabled: true,
            }),
        });
        return { ok: res.ok, status: res.status, text: await res.text() };
    }, opts);
    if (!result.ok) throw new Error(`model create failed: ${result.status} ${result.text}`);
}

async function deleteModel(page: Page, name: string): Promise<void> {
    await page.evaluate(async (name) => {
        await fetch(`/api/models/${encodeURIComponent(name)}`, { method: "DELETE", credentials: "include" });
    }, name);
}

/** The shared destructive error card (components/playground/modality-shell.tsx
 *  `ErrorCard`) is the only element carrying the literal `border-destructive/50`
 *  class. A looser `[class*="border-destructive"]` also matches unrelated
 *  buttons/inputs whose base Tailwind classes include
 *  `aria-invalid:border-destructive` (any submit button, the "Params"
 *  popover trigger, the model search input, ...), so the exact
 *  `/50` opacity suffix is required for a unique match. */
function errorCard(page: Page) {
    return page.locator('[class*="border-destructive/50"]');
}

/** Scopes a button lookup to `<main>`, excluding Radix's Popover content
 *  portal (rendered outside `<main>`, at the document root). Radix keeps
 *  a just-closed popover's content in the DOM for its exit animation, so
 *  an unscoped `getByRole("button", { name })` right after picking a
 *  model can match BOTH the trigger (now showing the selection) and the
 *  stale popover row — a strict-mode violation. */
function mainButton(page: Page, name: string) {
    return page.getByRole("main").getByRole("button", { name });
}

test.describe("modality playgrounds", () => {
    test("embedding: a model can be picked and a real comparison result renders", async ({ authedPage: page }) => {
        await page.goto("/playground/embedding");
        await settled(page);

        // Renders + a model can be picked: natural discovery already
        // exposes "e2e-embedding" (fake-upstream.mjs's /models list, name
        // matches the embedding capability's heuristic) — no synthetic
        // model needed for this one.
        await expect(page.getByRole("button", { name: /pick models/i })).toBeVisible();
        await page.getByRole("button", { name: /pick models/i }).click();
        await page.getByPlaceholder(/search embedding models/i).fill("e2e-embedding");
        // Not `exact` — the row's accessible name is "<provider-initials> e2e-embedding"
        // (ProviderIcon renders a text-fallback badge before the model name).
        // `.first()` — models-crud.spec.ts / providers-crud.spec.ts both
        // register scratch providers pointed at this same fake upstream
        // (to reach their own forms), so while one of those tests is
        // mid-flight "e2e-embedding" can legitimately be discovered twice
        // — once per provider row. Either duplicate is equally correct to
        // click; the store only keys off the model's name string.
        await page.getByRole("button", { name: "e2e-embedding" }).first().click();
        // `exact` — "1 model" is otherwise also a substring of the
        // "Run · 1 model" submit button, both live in `<main>`.
        await expect(page.getByRole("button", { name: "1 model", exact: true })).toBeVisible();
        await page.keyboard.press("Escape");

        await page.locator("#embed-query").fill("modalities-embedding-query-t7u8");
        await page.locator("#embed-docs").fill("first document line\nsecond document line");

        // Primary action reachable.
        const runButton = page.getByRole("button", { name: /run · 1 model/i });
        await expect(runButton).toBeEnabled();
        await runButton.click();

        // A genuine success: the empty hint is replaced by real content —
        // the exact query text plus a per-model result card. Scoped to the
        // result card's title specifically (`[data-slot="card-title"]") —
        // a plain text match also hits the (still DOM-present-during-close-
        // animation) multi-select trigger/row that repeat the model name.
        await expect(page.getByText("Comparison table will appear here")).toHaveCount(0);
        await expect(page.getByText("modalities-embedding-query-t7u8")).toBeVisible();
        await expect(page.locator('[data-slot="card-title"]').filter({ hasText: "e2e-embedding" })).toBeVisible();
    });

    test("image: a model can be picked and an attempted generation surfaces a sane error, not a crash", async ({ authedPage: page }) => {
        const name = uniqueName("image");
        try {
            await createModalityModel(page, { name, type: "image" });
            await page.goto("/playground/image");
            await settled(page);

            await expect(page.getByRole("button", { name: /select a model/i })).toBeVisible();
            await page.getByRole("button", { name: /select a model/i }).click();
            await page.getByPlaceholder(/search image models/i).fill(name);
            await page.getByRole("button", { name }).click();

            // A model can be picked: the trigger now shows it selected.
            await expect(mainButton(page, name)).toBeVisible();

            await page.locator("#image-prompt").fill("a red bicycle leaning against a brick wall");
            const genButton = page.getByRole("button", { name: /generate/i });
            await expect(genButton).toBeEnabled();
            await genButton.click();

            // Sane error, not a crash: the shared destructive error card
            // renders with a real (non-empty) message, and the page stays
            // interactive — never a fabricated "success" image grid.
            await expect(errorCard(page)).toBeVisible({ timeout: 20_000 });
            expect((await errorCard(page).innerText()).trim().length).toBeGreaterThan(0);
            await expect(mainButton(page, name)).toBeEnabled();
            await expect(genButton).toBeEnabled();
        } finally {
            await deleteModel(page, name);
        }
    });

    test("video: a model can be picked and an attempted generation surfaces a sane error, not a crash", async ({ authedPage: page }) => {
        const name = uniqueName("video");
        try {
            await createModalityModel(page, { name, type: "video" });
            await page.goto("/playground/video");
            await settled(page);

            await expect(page.getByRole("button", { name: /select a model/i })).toBeVisible();
            await page.getByRole("button", { name: /select a model/i }).click();
            await page.getByPlaceholder(/search video models/i).fill(name);
            await page.getByRole("button", { name }).click();
            await expect(mainButton(page, name)).toBeVisible();

            await page.locator("#video-prompt").fill("a drone shot soaring over a misty forest");
            const genButton = page.getByRole("button", { name: /generate/i });
            await expect(genButton).toBeEnabled();
            await genButton.click();

            // The job never gets created (the fake upstream 404s on the
            // create call itself), so this never enters the polling loop —
            // just the same shared error card as the other modalities.
            await expect(errorCard(page)).toBeVisible({ timeout: 20_000 });
            expect((await errorCard(page).innerText()).trim().length).toBeGreaterThan(0);
            await expect(genButton).toBeEnabled();
            await expect(genButton).toHaveText(/generate/i);
        } finally {
            await deleteModel(page, name);
        }
    });

    test("audio speech (TTS): a model can be picked and an attempted generation surfaces a sane error, not a crash", async ({ authedPage: page }) => {
        const name = uniqueName("speech");
        try {
            await createModalityModel(page, { name, type: "audio.speech" });
            await page.goto("/playground/audio/speech");
            await settled(page);

            await expect(page.getByRole("button", { name: /select a model/i })).toBeVisible();
            await page.getByRole("button", { name: /select a model/i }).click();
            await page.getByPlaceholder(/search audio\.speech models/i).fill(name);
            await page.getByRole("button", { name }).click();
            await expect(mainButton(page, name)).toBeVisible();

            await page.locator("#tts-text").fill("The quick brown fox jumps over the lazy dog.");
            const genButton = page.getByRole("button", { name: "Generate", exact: true });
            await expect(genButton).toBeEnabled();
            await genButton.click();

            await expect(errorCard(page)).toBeVisible({ timeout: 20_000 });
            expect((await errorCard(page).innerText()).trim().length).toBeGreaterThan(0);
            await expect(genButton).toBeEnabled();
        } finally {
            await deleteModel(page, name);
        }
    });

    test("audio transcription: a model can be picked and an attempted generation surfaces a sane error, not a crash", async ({ authedPage: page }) => {
        const name = uniqueName("transcribe");
        try {
            await createModalityModel(page, { name, type: "audio.transcription" });
            await page.goto("/playground/audio/transcription");
            await settled(page);

            await expect(page.getByRole("button", { name: /select a model/i })).toBeVisible();
            await page.getByRole("button", { name: /select a model/i }).click();
            await page.getByPlaceholder(/search audio\.transcription models/i).fill(name);
            await page.getByRole("button", { name }).click();
            await expect(mainButton(page, name)).toBeVisible();

            // The file's actual bytes are irrelevant — the request 404s
            // upstream before any real decoding would happen. Content-type
            // validation client-side only checks size (see
            // transcription-playground.tsx `acceptFile`), so an in-memory
            // buffer is enough; no disk I/O needed.
            await page.locator('input[type="file"]').setInputFiles({
                name: "sample.wav",
                mimeType: "audio/wav",
                buffer: Buffer.from("RIFF-fake-wav-content-for-e2e-only"),
            });

            const runButton = page.getByRole("button", { name: "Transcribe", exact: true });
            await expect(runButton).toBeEnabled();
            await runButton.click();

            await expect(errorCard(page)).toBeVisible({ timeout: 20_000 });
            expect((await errorCard(page).innerText()).trim().length).toBeGreaterThan(0);
            await expect(runButton).toBeEnabled();
        } finally {
            await deleteModel(page, name);
        }
    });
});
