import { test, expect, settled } from "../support/fixtures";
import type { Page } from "@playwright/test";

// Same fake OpenAI-compatible server the harness boots for every run (see
// e2e/support/fake-upstream.mjs + boot.mjs).
const UPSTREAM = `http://127.0.0.1:${process.env.FAKE_UPSTREAM_PORT || 4599}/v1`;

function uniqueName(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
}

/** A scratch provider is only a vehicle to reach the model form — provider
 *  CRUD itself is covered by providers-crud.spec.ts. Created via the same
 *  in-page fetch the app itself uses (see ensureProvider in fixtures.ts),
 *  so no extra UI flow needs re-testing here. */
async function createScratchProvider(page: Page, name: string): Promise<void> {
    const result = await page.evaluate(
        async ({ name, upstream }) => {
            const res = await fetch("/api/providers", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name,
                    base_url: upstream,
                    api_key: "sk-e2e",
                    adapter_id: "openai",
                    enabled: true,
                }),
            });
            return { ok: res.ok, status: res.status, text: await res.text() };
        },
        { name, upstream: UPSTREAM },
    );
    if (!result.ok) {
        throw new Error(`scratch provider setup failed: ${result.status} ${result.text}`);
    }
}

/** Deleting the provider cascades to its models (models.providerId has
 *  onDelete: "cascade" — lib/server/db/schema.ts), so this alone cleans up
 *  everything a test creates underneath it. */
async function deleteProviderByName(page: Page, name: string): Promise<void> {
    await page
        .evaluate(async (n) => {
            await fetch(`/api/providers/${encodeURIComponent(n)}`, {
                method: "DELETE",
                credentials: "include",
            });
        }, name)
        .catch(() => { /* already gone — fine */ });
}

function modelRow(page: Page, name: string) {
    return page.locator("tr").filter({ hasText: name });
}

test.describe("models CRUD", () => {
    let providerName: string;

    test.beforeEach(async ({ authedPage: page }) => {
        providerName = uniqueName("e2e-models-provider");
        await createScratchProvider(page, providerName);
    });

    test.afterEach(async ({ page }) => {
        await deleteProviderByName(page, providerName);
    });

    test("registers a model override, edits its params, toggles enabled, then deletes it", async ({ authedPage: page }) => {
        const modelName = uniqueName("e2e-model");

        await page.goto(`/providers/${encodeURIComponent(providerName)}`);
        await settled(page);
        await expect(page.getByRole("heading", { name: providerName })).toBeVisible();

        // ---- register (create) ----
        await page.getByRole("button", { name: "Add model" }).click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole("heading", { name: "Add model" })).toBeVisible();

        await page.getByLabel("Display name", { exact: true }).fill(modelName);
        await page.getByLabel("Upstream model ID", { exact: true }).fill("e2e-chat");
        await page.getByLabel("Context window", { exact: true }).fill("8192");
        await page.getByLabel("Max tokens", { exact: true }).fill("1024");

        // Work around a confirmed defect (see the dedicated failing test
        // below): the Provider select is meant to arrive pre-selected with
        // the provider we navigated in from, but its value silently resets
        // to empty right after the dialog mounts (a Radix Select
        // controlled-value quirk — radix-ui/primitives#3693), so an
        // explicit re-selection is required for the create to succeed at
        // all right now.
        const providerField = dialog.locator("div").filter({ hasText: "Provider" }).last();
        await providerField.getByRole("combobox").click();
        await page.getByRole("option", { name: providerName }).click();

        await page.getByRole("button", { name: "Create" }).click();
        await expect(page.getByText("Saved")).toBeVisible();
        await expect(dialog).toBeHidden();

        const row = modelRow(page, modelName);
        await expect(row).toBeVisible();
        await expect(row.getByText("override", { exact: true })).toBeVisible();
        await expect(row.getByText("8k", { exact: true })).toBeVisible();

        // ---- survives a reload (proves it persisted) ----
        await page.reload();
        await settled(page);
        await expect(modelRow(page, modelName)).toBeVisible();

        // ---- edit: context window, max tokens, and the upstream API variant pin ----
        await modelRow(page, modelName).getByTitle("Edit").click();
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole("heading", { name: "Edit" })).toBeVisible();
        await expect(page.getByLabel("Context window", { exact: true })).toHaveValue("8192");

        await page.getByLabel("Context window", { exact: true }).fill("16384");
        await page.getByLabel("Max tokens", { exact: true }).fill("2048");

        // The "Upstream API" Select has no htmlFor/id association to its
        // label (components/providers/model-form.tsx) so it can't be
        // reached via getByLabel — scope by the nearest container instead.
        const upstreamApiField = page.locator("div").filter({ hasText: "Upstream API" }).last();
        const upstreamApiTrigger = upstreamApiField.getByRole("combobox");
        await expect(upstreamApiTrigger).toBeVisible();
        await expect(upstreamApiTrigger).toHaveText(/chat\.completions/);
        await upstreamApiTrigger.click();
        await page.getByRole("option", { name: "responses" }).click();
        await expect(upstreamApiTrigger).toHaveText(/^responses$/);

        await page.getByRole("button", { name: "Save" }).click();
        await expect(page.getByText("Saved")).toBeVisible();
        await expect(dialog).toBeHidden();

        // ---- edits survive a reload ----
        await page.reload();
        await settled(page);
        await expect(modelRow(page, modelName).getByText("16k", { exact: true })).toBeVisible();

        await modelRow(page, modelName).getByTitle("Edit").click();
        await expect(dialog).toBeVisible();
        await expect(page.getByLabel("Context window", { exact: true })).toHaveValue("16384");
        await expect(page.getByLabel("Max tokens", { exact: true })).toHaveValue("2048");
        const upstreamApiField2 = page.locator("div").filter({ hasText: "Upstream API" }).last();
        await expect(upstreamApiField2.getByRole("combobox")).toHaveText(/^responses$/);

        // ---- toggle enabled off ----
        const enabledSwitch = page.getByLabel("Enabled", { exact: true });
        await expect(enabledSwitch).toHaveAttribute("aria-checked", "true");
        await enabledSwitch.click();
        await expect(enabledSwitch).toHaveAttribute("aria-checked", "false");
        await page.getByRole("button", { name: "Save" }).click();
        await expect(page.getByText("Saved")).toBeVisible();
        await expect(dialog).toBeHidden();

        await page.reload();
        await settled(page);
        await expect(modelRow(page, modelName).getByText("Disabled", { exact: true })).toBeVisible();

        // ---- re-enable, then delete ----
        await modelRow(page, modelName).getByTitle("Edit").click();
        await expect(dialog).toBeVisible();
        await expect(page.getByLabel("Enabled", { exact: true })).toHaveAttribute("aria-checked", "false");
        await page.getByLabel("Enabled", { exact: true }).click();
        await page.getByRole("button", { name: "Save" }).click();
        await expect(page.getByText("Saved")).toBeVisible();
        await expect(dialog).toBeHidden();

        await modelRow(page, modelName).getByTitle("Delete").click();
        const confirm = page.getByRole("alertdialog");
        await expect(confirm).toBeVisible();
        await confirm.getByRole("button", { name: "Delete" }).click();
        await expect(page.getByText("Model deleted")).toBeVisible();
        await expect(modelRow(page, modelName)).toHaveCount(0);

        await page.reload();
        await settled(page);
        await expect(modelRow(page, modelName)).toHaveCount(0);
    });

    // GENUINE BUG: opening "Add model" from a provider's detail page passes
    // defaultProviderId={provider.id} (components/providers/model-form.tsx)
    // intending to pre-select that provider so the admin doesn't have to.
    // In practice the Provider <Select>'s controlled value is seeded by a
    // useEffect *after* first mount, before its SelectContent has ever been
    // opened — a known Radix Select controlled-value quirk
    // (radix-ui/primitives#3693 / #3249) fires onValueChange("") right
    // back, silently clearing it. The trigger is left showing the
    // "Select provider" placeholder and submitting without manually
    // re-picking the provider always fails with a "Provider required"
    // toast. Every admin who trusts the visibly-empty-looking field (or
    // simply doesn't notice it needs re-clicking) has their model creation
    // silently rejected. Confirmed via runtime tracing of providerId state
    // across renders: it is set to defaultProviderId once, then reset to ""
    // on the very next render, with no further user input.
    test("the Add model dialog pre-selects the provider it was opened from (currently broken — tracked bug)", async ({ authedPage: page }) => {
        test.fail();
        const modelName = uniqueName("e2e-model-providerfill");

        await page.goto(`/providers/${encodeURIComponent(providerName)}`);
        await settled(page);

        await page.getByRole("button", { name: "Add model" }).click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();

        // Correct behaviour: without ever touching the Provider field, an
        // admin creating a model from a provider's own detail page should
        // be able to fill just the model-specific fields and submit.
        await page.getByLabel("Display name", { exact: true }).fill(modelName);
        await page.getByLabel("Upstream model ID", { exact: true }).fill("e2e-chat");
        await page.getByRole("button", { name: "Create" }).click();
        await expect(page.getByText("Saved")).toBeVisible({ timeout: 5_000 });

        // Clean up if this ever starts passing.
        await modelRow(page, modelName).getByTitle("Delete").click();
        await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
    });

    // GENUINE GAP: model.timeout and model.max_retries are full first-class,
    // persisted, per-model fields (lib/schemas/model.ts — modelDTOSchema /
    // modelCreateSchema / modelUpdateSchema all define `timeout` [default
    // 3600s] and `max_retries` [default 2]; lib/server/db/schema.ts models
    // table has matching `timeout`/`max_retries` columns with those SQL
    // defaults) but components/providers/model-form.tsx — the only UI for
    // creating/editing a model override — has no input for either. An
    // admin has no way, anywhere in the console, to give one model a
    // shorter timeout or a different retry count than the hardcoded
    // defaults. This test documents the expected/correct behaviour (a
    // labeled, editable "Timeout" field) and is expected to fail until
    // that field is added.
    test("model timeout is configurable from the model form (currently missing — tracked gap)", async ({ authedPage: page }) => {
        test.fail();
        const modelName = uniqueName("e2e-model-timeout");

        await page.goto(`/providers/${encodeURIComponent(providerName)}`);
        await settled(page);

        await page.getByRole("button", { name: "Add model" }).click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();

        await page.getByLabel("Display name", { exact: true }).fill(modelName);
        await page.getByLabel("Upstream model ID", { exact: true }).fill("e2e-chat");

        // This is the assertion documenting correct behaviour — a labeled
        // field the admin can use to set a per-model request timeout.
        await expect(page.getByLabel(/timeout/i)).toBeVisible({ timeout: 5_000 });
        await page.getByLabel(/timeout/i).fill("30");

        await page.getByRole("button", { name: "Create" }).click();
        await expect(page.getByText("Saved")).toBeVisible();
    });
});
