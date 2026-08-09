import { expect } from "../support/fixtures";
import type { Page } from "@playwright/test";

/**
 * `ensureModelSelected` (e2e/perf/support/chat.ts) just waits for "e2e-chat"
 * text to appear, trusting the playground's own auto-select effect
 * (components/playground/model-selector.tsx) to have already landed on it.
 * That effect always grabs `chatModels[0]` — whichever `type === "chat"`
 * model the API happens to return first — with no preference for
 * "e2e-chat" specifically.
 *
 * This suite's `e2e` project runs spec *files* concurrently across workers
 * (playwright.config.ts: `fullyParallel: false` only serializes tests
 * *within* one file). Two independent things can transiently make
 * "e2e-chat" NOT the obvious/only choice while other spec files' tests are
 * mid-flight:
 *   1. `models-crud.spec.ts` creates a scratch model without ever setting
 *      an explicit `type` in its form, and
 *      `lib/server/models/service.ts:250` defaults an omitted `type` to
 *      `"chat"` — so the shared DB briefly has a *second* chat-capable
 *      model.
 *   2. `models-crud.spec.ts` / `providers-crud.spec.ts` both register
 *      throwaway scratch *providers* pointed at the exact same fake
 *      upstream URL as the shared "e2e" provider (see fixtures.ts
 *      `ensureProvider`) to reach their own forms. Discovery
 *      (lib/server/discovery.ts) is per-provider, so for as long as one of
 *      those scratch providers exists, "e2e-chat" (and "e2e-embedding") is
 *      legitimately discovered *twice* — once per provider row — which is
 *      correct discovery behaviour, not a bug, but means a model picker's
 *      row list can transiently contain two entries with the exact same
 *      name.
 * If a chat test in this file happens to load `/playground/chat` during
 * either window, `chatModels[0]` can land on a different model than
 * "e2e-chat", and/or the picker can show a duplicate "e2e-chat" row.
 *
 * This picks "e2e-chat" explicitly and deterministically instead of
 * trusting auto-select, and tolerates a duplicate row (any of them behaves
 * identically — the store only ever keys off the model's name string), so
 * every test in these chat specs is immune to whatever else transiently
 * exists in the shared model catalog.
 */
export async function ensureChatModel(page: Page): Promise<void> {
    const trigger = page.getByRole("button", { name: "Select models" });
    await expect(trigger).toBeVisible({ timeout: 20_000 });
    await expect(trigger).toBeEnabled();
    await trigger.click();

    // Scoped to the dropdown's own portal container (rendered onto
    // `document.body`, distinct from `model-config-popover.tsx`'s similar
    // popover which uses `rounded-xl` instead of `rounded-lg`) — an
    // unscoped page-wide lookup for "e2e-chat" also matches the model chip
    // that may already be showing near the composer (same ProviderIcon +
    // name pattern), a strict-mode violation.
    const dropdown = page.locator("div.rounded-lg.border.bg-popover.text-popover-foreground.shadow-xl");
    await expect(dropdown).toBeVisible();

    // Force single-model mode so picking *replaces* the selection instead
    // of adding to it — if the other transient model is already selected
    // (see above), a plain add would leave both selected and fan the next
    // send out across both.
    const singleModeToggle = dropdown.locator("button[aria-pressed]");
    await expect(singleModeToggle).toBeVisible();
    if ((await singleModeToggle.getAttribute("aria-pressed")) === "false") {
        await singleModeToggle.click();
    }

    await dropdown.getByPlaceholder("Search models...").fill("e2e-chat");
    // Anchored at the end of the string: "e2e-chat-fast" (also exposed by
    // the fake upstream) doesn't qualify, only "e2e-chat" does — and this
    // also tolerates ProviderIcon's "E2" initials-badge text rendered
    // immediately before the model name inside the row's accessible name.
    // `.first()` — a transient duplicate-provider discovery collision (see
    // above) can render this row twice; either is equally correct to click.
    await dropdown.getByRole("button", { name: /e2e-chat$/i }).first().click();

    await expect(page.locator("body")).toContainText(/e2e-chat/i, { timeout: 20_000 });
}
