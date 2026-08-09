import { test, expect, settled } from "../support/fixtures";
import type { Page } from "@playwright/test";

// Same fake OpenAI-compatible server the harness boots for every run (see
// e2e/support/fake-upstream.mjs + boot.mjs). Pointing every provider we
// create at it keeps discovery fast, deterministic, and free of real
// network calls.
const UPSTREAM = `http://127.0.0.1:${process.env.FAKE_UPSTREAM_PORT || 4599}/v1`;

function uniqueName(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
}

/** Scope a locator to the single provider card containing `name` — cards
 *  have no explicit role, so we anchor on the smallest container that
 *  holds both the card's heading text and its (always-in-DOM,
 *  hover-revealed) action buttons. */
function providerCard(page: Page, name: string) {
    return page
        .locator("div")
        .filter({ hasText: name })
        .filter({ has: page.getByTitle("Edit") })
        .last();
}

/** Best-effort cleanup via the same fetch the app itself uses (see
 *  ensureProvider in fixtures.ts) — deleteProvider() accepts id OR name. */
async function deleteProviderByName(page: Page, name: string): Promise<void> {
    await page
        .evaluate(async (n) => {
            await fetch(`/api/providers/${encodeURIComponent(n)}`, {
                method: "DELETE",
                credentials: "include",
            });
        }, name)
        .catch(() => { /* already gone / never created — fine */ });
}

test.describe("providers CRUD", () => {
    const createdNames: string[] = [];

    test.afterEach(async ({ page }) => {
        // Safety net: if an assertion above threw mid-test, don't leave the
        // shared DB with orphan providers for other specs to trip over.
        for (const name of createdNames.splice(0)) {
            await deleteProviderByName(page, name);
        }
    });

    test("create, edit, disable/enable, and delete a provider through the UI", async ({ authedPage: page }) => {
        const name = uniqueName("e2e-provider");
        createdNames.push(name);

        await page.goto("/providers");
        await settled(page);

        // ---- create ----
        await page.getByRole("button", { name: "Add provider" }).click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole("heading", { name: "Add Provider" })).toBeVisible();

        await page.getByLabel("Name", { exact: true }).fill(name);
        await page.getByLabel("Base URL", { exact: true }).fill(UPSTREAM);
        await page.getByLabel("API Key", { exact: true }).fill("sk-e2e-super-secret-value");
        await page.getByRole("button", { name: "Create" }).click();

        await expect(page.getByText("Provider created")).toBeVisible();
        await expect(dialog).toBeHidden();

        const card = providerCard(page, name);
        await expect(card).toBeVisible();
        // Discovery against the local fake upstream runs synchronously as
        // part of the list response — the 3 fake models show up without a
        // manual refresh.
        await expect(card.getByText("3", { exact: true })).toBeVisible();

        // ---- survives a reload (proves it persisted, not just cached) ----
        await page.reload();
        await settled(page);
        await expect(providerCard(page, name)).toBeVisible();

        // ---- edit: base_url + default params ----
        await providerCard(page, name).hover();
        await providerCard(page, name).getByTitle("Edit").click();
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole("heading", { name: "Edit Provider" })).toBeVisible();

        // The server never returns the stored plaintext key — the field
        // must start empty even though we set one on create.
        await expect(page.getByLabel("API Key", { exact: true })).toHaveValue("");

        const editedUrl = `http://localhost:${new URL(UPSTREAM).port}/v1`;
        await page.getByLabel("Base URL", { exact: true }).fill(editedUrl);
        await page.getByLabel("Default params (JSON)", { exact: true }).fill('{\n  "temperature": 0.5\n}');
        await page.getByRole("button", { name: "Save" }).click();
        await expect(page.getByText("Provider updated")).toBeVisible();
        await expect(dialog).toBeHidden();

        // ---- edits survive a reload ----
        await page.reload();
        await settled(page);
        await providerCard(page, name).hover();
        await providerCard(page, name).getByTitle("Edit").click();
        await expect(dialog).toBeVisible();
        await expect(page.getByLabel("Base URL", { exact: true })).toHaveValue(editedUrl);
        await expect(page.getByLabel("Default params (JSON)", { exact: true })).toHaveValue(/"temperature":\s*0\.5/);
        // Still never re-renders the secret, even after other edits.
        await expect(page.getByLabel("API Key", { exact: true })).toHaveValue("");

        // ---- disable ----
        const enabledSwitch = page.getByLabel("Enabled", { exact: true });
        await expect(enabledSwitch).toHaveAttribute("aria-checked", "true");
        await enabledSwitch.click();
        await expect(enabledSwitch).toHaveAttribute("aria-checked", "false");
        await page.getByRole("button", { name: "Save" }).click();
        await expect(page.getByText("Provider updated")).toBeVisible();
        await expect(dialog).toBeHidden();

        // Disabling excludes the provider from discovery — the model count
        // on the card drops to 0. Verify this survives a reload too.
        await page.reload();
        await settled(page);
        await expect(providerCard(page, name).getByText("0", { exact: true })).toBeVisible();

        // ---- re-enable ----
        await providerCard(page, name).hover();
        await providerCard(page, name).getByTitle("Edit").click();
        await expect(dialog).toBeVisible();
        await expect(page.getByLabel("Enabled", { exact: true })).toHaveAttribute("aria-checked", "false");
        await page.getByLabel("Enabled", { exact: true }).click();
        await expect(page.getByLabel("Enabled", { exact: true })).toHaveAttribute("aria-checked", "true");
        await page.getByRole("button", { name: "Save" }).click();
        await expect(page.getByText("Provider updated")).toBeVisible();
        await expect(dialog).toBeHidden();

        await page.reload();
        await settled(page);
        await expect(providerCard(page, name).getByText("3", { exact: true })).toBeVisible();

        // ---- delete ----
        await providerCard(page, name).hover();
        await providerCard(page, name).getByTitle("Delete").click();
        const confirm = page.getByRole("alertdialog");
        await expect(confirm).toBeVisible();
        await confirm.getByRole("button", { name: "Delete" }).click();
        await expect(page.getByText("Provider deleted")).toBeVisible();
        await expect(providerCard(page, name)).toHaveCount(0);

        // Survives reload (i.e. actually gone, not just removed from cache).
        await page.reload();
        await settled(page);
        await expect(providerCard(page, name)).toHaveCount(0);

        createdNames.splice(createdNames.indexOf(name), 1);
    });

    test("rejects an empty name and a malformed base_url without creating anything", async ({ authedPage: page }) => {
        const badUrlName = uniqueName("e2e-provider-badurl");

        await page.goto("/providers");
        await settled(page);

        await page.getByRole("button", { name: "Add provider" }).click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();

        // ---- empty name ----
        await page.getByLabel("Base URL", { exact: true }).fill(UPSTREAM);
        await page.getByRole("button", { name: "Create" }).click();
        await expect(page.getByText("Name required")).toBeVisible();
        await expect(dialog).toBeVisible(); // dialog stays open, nothing submitted

        // ---- malformed base_url reaches the server and is rejected ----
        await page.getByLabel("Name", { exact: true }).fill(badUrlName);
        await page.getByLabel("Base URL", { exact: true }).fill("not-a-url");
        await page.getByRole("button", { name: "Create" }).click();
        await expect(page.getByText(/base_url must be a URL/)).toBeVisible();
        await expect(dialog).toBeVisible();

        await page.getByRole("button", { name: "Cancel" }).click();
        await expect(dialog).toBeHidden();

        // Neither invalid attempt actually created a provider.
        await expect(providerCard(page, badUrlName)).toHaveCount(0);
        await page.reload();
        await settled(page);
        await expect(providerCard(page, badUrlName)).toHaveCount(0);
    });
});
