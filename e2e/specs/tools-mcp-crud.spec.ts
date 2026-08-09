import { test, expect, settled } from "../support/fixtures";
import type { Page } from "@playwright/test";

function uniqueName(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
}

function toolRow(page: Page, name: string) {
    return page.locator("tr").filter({ hasText: name });
}

function mcpRow(page: Page, name: string) {
    return page.locator("tr").filter({ hasText: name });
}

/** Best-effort cleanup via the same REST endpoint the app itself uses —
 *  both /api/tools/:id and /api/mcp/servers/:id resolve id-or-name
 *  (lib/server/tools/service.ts findByIdOrName, lib/server/mcp/service.ts
 *  findByIdOrName), so deleting by the display name works directly. */
async function deleteToolByName(page: Page, name: string): Promise<void> {
    await page
        .evaluate(async (n) => {
            await fetch(`/api/tools/${encodeURIComponent(n)}`, { method: "DELETE", credentials: "include" });
        }, name)
        .catch(() => { /* already gone / never created — fine */ });
}

async function deleteMcpServerByName(page: Page, name: string): Promise<void> {
    await page
        .evaluate(async (n) => {
            await fetch(`/api/mcp/servers/${encodeURIComponent(n)}`, { method: "DELETE", credentials: "include" });
        }, name)
        .catch(() => { /* already gone / never created — fine */ });
}

/** Settings is a single hash-routed page (app/(dashboard)/settings/page.tsx)
 *  — clicking the "Tools" nav button updates window.location.hash, which
 *  (unlike component state) survives a plain page.reload(), so callers only
 *  need this once per test. */
async function openToolsSection(page: Page): Promise<void> {
    await page.getByRole("button", { name: "Tools", exact: true }).click();
    await expect(page.getByRole("button", { name: "Add tool" })).toBeVisible();
}

test.describe("tools CRUD", () => {
    const createdNames: string[] = [];

    test.afterEach(async ({ page }) => {
        // Safety net: if an assertion above threw mid-test, don't leave the
        // shared DB with an orphan tool for other specs to trip over.
        for (const name of createdNames.splice(0)) {
            await deleteToolByName(page, name);
        }
    });

    test("create, edit, toggle enabled, and delete a tool through the UI", async ({ authedPage: page }) => {
        const toolName = uniqueName("e2e-tool");
        createdNames.push(toolName);
        const initialParams = {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
        };
        const editedParams = {
            type: "object",
            properties: { query: { type: "string" }, limit: { type: "number" } },
            required: ["query"],
        };

        await page.goto("/settings");
        await settled(page);
        await openToolsSection(page);

        // ---- create ----
        await page.getByRole("button", { name: "Add tool" }).click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole("heading", { name: "Add tool" })).toBeVisible();

        // ---- validation: empty name is rejected client-side, nothing submitted ----
        await page.getByRole("button", { name: "Save" }).click();
        await expect(page.getByText("Name required")).toBeVisible();
        await expect(dialog).toBeVisible();

        // ---- validation: malformed webhook URL reaches the server and is rejected ----
        await page.getByLabel("Name", { exact: true }).fill(toolName);
        await page.getByLabel("Webhook URL", { exact: true }).fill("not-a-valid-url");
        await page.getByRole("button", { name: "Save" }).click();
        await expect(page.getByText(/webhook_url must be a URL/)).toBeVisible();
        await expect(dialog).toBeVisible();
        await expect(toolRow(page, toolName)).toHaveCount(0);

        await page.getByLabel("Webhook URL", { exact: true }).fill("https://example.com/hooks/e2e-create");
        await page.getByLabel("Description", { exact: true }).fill("Echoes the query back");
        await page.getByLabel("Parameters (JSON Schema)", { exact: true }).fill(JSON.stringify(initialParams, null, 2));

        await page.getByRole("button", { name: "Save" }).click();
        await expect(page.getByText("Saved")).toBeVisible();
        await expect(dialog).toBeHidden();

        const row = toolRow(page, toolName);
        await expect(row).toBeVisible();
        await expect(row.getByText("on", { exact: true })).toBeVisible();
        await expect(row.getByText("https://example.com/hooks/e2e-create")).toBeVisible();

        // ---- survives a reload (proves it persisted, not just cached) ----
        await page.reload();
        await settled(page);
        await expect(toolRow(page, toolName)).toBeVisible();

        // ---- edit: description, params, webhook, and disable ----
        await toolRow(page, toolName).getByTitle("Edit", { exact: true }).click();
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole("heading", { name: "Edit", exact: true })).toBeVisible();
        await expect(page.getByLabel("Webhook URL", { exact: true })).toHaveValue("https://example.com/hooks/e2e-create");
        await expect(page.getByLabel("Parameters (JSON Schema)", { exact: true })).toHaveValue(JSON.stringify(initialParams, null, 2));

        await page.getByLabel("Webhook URL", { exact: true }).fill("https://example.com/hooks/e2e-edited");
        await page.getByLabel("Description", { exact: true }).fill("Echoes the query back, capped");
        await page.getByLabel("Parameters (JSON Schema)", { exact: true }).fill(JSON.stringify(editedParams, null, 2));

        const enabledSwitch = page.getByLabel("Enabled", { exact: true });
        await expect(enabledSwitch).toHaveAttribute("aria-checked", "true");
        await enabledSwitch.click();
        await expect(enabledSwitch).toHaveAttribute("aria-checked", "false");

        await page.getByRole("button", { name: "Save" }).click();
        await expect(page.getByText("Saved")).toBeVisible();
        await expect(dialog).toBeHidden();

        await expect(toolRow(page, toolName).getByText("off", { exact: true })).toBeVisible();

        // ---- edits + disabled state survive a reload ----
        await page.reload();
        await settled(page);
        await expect(toolRow(page, toolName).getByText("off", { exact: true })).toBeVisible();

        await toolRow(page, toolName).getByTitle("Edit", { exact: true }).click();
        await expect(dialog).toBeVisible();
        await expect(page.getByLabel("Webhook URL", { exact: true })).toHaveValue("https://example.com/hooks/e2e-edited");
        await expect(page.getByLabel("Parameters (JSON Schema)", { exact: true })).toHaveValue(JSON.stringify(editedParams, null, 2));
        await expect(page.getByLabel("Enabled", { exact: true })).toHaveAttribute("aria-checked", "false");

        // ---- re-enable, then delete ----
        await page.getByLabel("Enabled", { exact: true }).click();
        await page.getByRole("button", { name: "Save" }).click();
        await expect(page.getByText("Saved")).toBeVisible();
        await expect(dialog).toBeHidden();

        await toolRow(page, toolName).getByTitle("Delete", { exact: true }).click();
        const confirm = page.getByRole("alertdialog");
        await expect(confirm).toBeVisible();
        await confirm.getByRole("button", { name: "Delete" }).click();
        await expect(page.getByText("Tool deleted")).toBeVisible();
        await expect(toolRow(page, toolName)).toHaveCount(0);

        await page.reload();
        await settled(page);
        await expect(toolRow(page, toolName)).toHaveCount(0);

        createdNames.splice(createdNames.indexOf(toolName), 1);
    });
});

test.describe("MCP servers CRUD", () => {
    const createdNames: string[] = [];

    test.afterEach(async ({ page }) => {
        for (const name of createdNames.splice(0)) {
            await deleteMcpServerByName(page, name);
        }
    });

    test("adds a server from the preset catalogue, edits it, switches transport tabs, and deletes it", async ({ authedPage: page }) => {
        const serverName = uniqueName("e2e-mcp");
        createdNames.push(serverName);
        const BOGUS_COMMAND = "this-command-does-not-exist-e2e";

        // The catalogue lives at a fixed, linkable URL — reaching it directly
        // mirrors models-crud.spec.ts navigating straight to a provider's
        // detail page rather than clicking through every intermediate list.
        await page.goto("/mcp/presets");
        await settled(page);

        // "time" is a safe, minimal stdio preset (lib/server/mcp/presets.ts)
        // with no required secrets — searching for it narrows the catalogue
        // to exactly one card (no other preset's name/description mentions
        // "time").
        await page.getByPlaceholder("Search…").fill("time");
        // Button label depends on whether a server named "time" already
        // exists in the shared DB from a previous/parallel run — both do
        // the same thing (open the same pre-filled create dialog).
        const useButton = page.getByRole("button", { name: /use preset|add another/i });
        await expect(useButton).toBeVisible();
        await useButton.click();

        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole("heading", { name: "Add MCP server" })).toBeVisible();

        // "add and fill": the preset pre-fills name / description / command.
        await expect(page.getByLabel("Name")).toHaveValue("time");
        await expect(page.getByLabel("Description", { exact: true })).toHaveValue("Time-zone-aware date / time queries.");
        await expect(page.getByLabel("Command")).toHaveValue("uvx");

        // Validation in this form is via a disabled Save button, not a toast
        // (components/tools/mcp-form-dialog.tsx canSubmit) — confirm that.
        await page.getByLabel("Name").fill("");
        await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();

        // Rename to a globally-unique value (the raw preset name collides
        // across parallel workers / repeat runs — mcp_servers.name is
        // unique) and replace the command with an obviously-bogus one so
        // the background health check can run and fail fast without ever
        // spawning a real process.
        await page.getByLabel("Name").fill(serverName);
        await page.getByLabel("Command").fill(BOGUS_COMMAND);
        await expect(page.getByRole("button", { name: "Save" })).toBeEnabled();
        await page.getByRole("button", { name: "Save" }).click();

        await expect(page.getByText("Saved")).toBeVisible();
        await expect(page).toHaveURL(/\/mcp\?selected=/);

        // Saving from the catalogue redirects to /mcp?selected=<id>, which
        // auto-opens the new server's details sheet — and would keep
        // reopening it on every later reload in this test, since
        // selectedId is seeded straight from that URL query param
        // (app/(dashboard)/mcp/page.tsx). Navigate to the bare list URL
        // instead of just dismissing the sheet so later reloads land on
        // the plain table.
        await page.goto("/mcp");
        await settled(page);
        await expect(page.getByRole("dialog")).toBeHidden();

        const row = mcpRow(page, serverName);
        await expect(row).toBeVisible();
        await expect(row.getByText(BOGUS_COMMAND)).toBeVisible();

        // The health check actually ran (against a command that can't
        // spawn) and the UI surfaces the failure gracefully — no hang, no
        // crash, no false "connected" state. The list auto-polls every 2s
        // while any row is still "Checking…" (mcpServers.useList
        // refetchInterval), so this needs no manual refresh.
        await expect(row.getByText("Failed", { exact: true })).toBeVisible();

        // ---- enabled toggle, directly from the table ----
        const rowSwitch = row.getByRole("switch");
        await expect(rowSwitch).toHaveAttribute("aria-checked", "true");
        await rowSwitch.click();
        await expect(rowSwitch).toHaveAttribute("aria-checked", "false");
        await page.reload();
        await settled(page);
        await expect(mcpRow(page, serverName).getByRole("switch")).toHaveAttribute("aria-checked", "false");
        await mcpRow(page, serverName).getByRole("switch").click();
        await expect(mcpRow(page, serverName).getByRole("switch")).toHaveAttribute("aria-checked", "true");

        // ---- edit: transport tabs swap the visible fields ----
        await mcpRow(page, serverName).getByTitle("Edit", { exact: true }).click();
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole("heading", { name: `Edit ${serverName}` })).toBeVisible();
        await expect(page.getByLabel("Command")).toHaveValue(BOGUS_COMMAND);
        await expect(page.getByLabel("Args", { exact: true })).toBeVisible();
        await expect(page.getByLabel("Env", { exact: true })).toBeVisible();
        await expect(page.getByLabel("cwd", { exact: true })).toBeVisible();
        await expect(page.getByLabel("URL")).toBeHidden();

        await page.getByRole("tab", { name: "http" }).click();
        await expect(page.getByLabel("URL")).toBeVisible();
        await expect(page.getByLabel("Headers", { exact: true })).toBeVisible();
        await expect(page.getByLabel("Command")).toBeHidden();
        await expect(page.getByLabel("Args", { exact: true })).toBeHidden();

        // Switch back without saving — the original stdio config (set
        // above) must have been preserved, not reset by the tab switch.
        await page.getByRole("tab", { name: "stdio" }).click();
        await expect(page.getByLabel("Command")).toHaveValue(BOGUS_COMMAND);
        await expect(page.getByLabel("URL")).toBeHidden();

        await page.getByLabel("Description", { exact: true }).fill("Renamed by e2e test");
        await page.getByRole("button", { name: "Save" }).click();
        await expect(page.getByText("Saved")).toBeVisible();
        await expect(dialog).toBeHidden();

        // ---- edit survives a reload ----
        await page.reload();
        await settled(page);
        await expect(mcpRow(page, serverName)).toBeVisible();
        await mcpRow(page, serverName).getByTitle("Edit", { exact: true }).click();
        await expect(dialog).toBeVisible();
        await expect(page.getByLabel("Description", { exact: true })).toHaveValue("Renamed by e2e test");
        await expect(page.getByLabel("Command")).toHaveValue(BOGUS_COMMAND);
        await page.getByRole("button", { name: "Cancel" }).click();
        await expect(dialog).toBeHidden();

        // ---- delete ----
        await mcpRow(page, serverName).getByTitle("Delete", { exact: true }).click();
        const confirm = page.getByRole("alertdialog");
        await expect(confirm).toBeVisible();
        await confirm.getByRole("button", { name: "Delete" }).click();
        await expect(page.getByText("Server deleted")).toBeVisible();
        await expect(mcpRow(page, serverName)).toHaveCount(0);

        await page.reload();
        await settled(page);
        await expect(mcpRow(page, serverName)).toHaveCount(0);

        createdNames.splice(createdNames.indexOf(serverName), 1);
    });
});
