import { test, expect, settled } from "../support/fixtures";
import type { Page } from "@playwright/test";

function uniqueName(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10_000)}`.toLowerCase();
}

function userRow(page: Page, username: string) {
    return page.locator("tr").filter({ hasText: username });
}

function apiKeyRow(page: Page, name: string) {
    return page.locator("tr").filter({ hasText: name });
}

/** Isolate a row by username regardless of how many users the shared DB
 *  has accumulated across other specs / parallel workers (the users list
 *  is paginated at 20/page, newest first). */
async function filterUsersByUsername(page: Page, username: string): Promise<void> {
    await page.getByPlaceholder("Username").fill(username);
    await page.getByRole("button", { name: "Filter" }).click();
}

/** Mirrors fixtures.ts's loginViaUi, parameterized for a non-admin account
 *  fixtures.ts itself only logs in as ADMIN and must not be modified. */
async function loginAs(page: Page, username: string, password: string): Promise<void> {
    await page.goto("/login");
    await page.waitForLoadState("domcontentloaded");
    await page.getByLabel(/username/i).fill(username);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole("button", { name: /sign in|log in/i }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20_000 });
}

/** Vehicle for the role-prefill check below — creates a user directly via
 *  the same REST endpoint the UI's own form posts to, so that test doesn't
 *  have to re-drive the whole "Add User" dialog just to get a second admin
 *  account to inspect. */
async function createScratchUser(page: Page, username: string, password: string, role: "user" | "admin"): Promise<void> {
    const result = await page.evaluate(
        async ({ username, password, role }) => {
            const res = await fetch("/api/users", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, password, role }),
            });
            return { ok: res.ok, status: res.status, text: await res.text() };
        },
        { username, password, role },
    );
    if (!result.ok) {
        throw new Error(`scratch user setup failed: ${result.status} ${result.text}`);
    }
}

async function deleteUserByUsername(page: Page, username: string): Promise<void> {
    await page
        .evaluate(async (u) => {
            await fetch(`/api/users/${encodeURIComponent(u)}`, { method: "DELETE", credentials: "include" });
        }, username)
        .catch(() => { /* already gone / never created — fine */ });
}

/** apiKeys has no delete-by-name endpoint (DELETE /api/apikeys/:id expects
 *  the row's UUID) — look the id up from the same list endpoint the table
 *  itself reads before deleting. */
async function deleteApiKeyByName(page: Page, name: string): Promise<void> {
    await page
        .evaluate(async (n) => {
            const res = await fetch("/api/apikeys", { credentials: "include" });
            if (!res.ok) return;
            const body = await res.json();
            const match = (body?.data ?? []).find((k: { name: string; id: string }) => k.name === n);
            if (match) {
                await fetch(`/api/apikeys/${encodeURIComponent(match.id)}`, { method: "DELETE", credentials: "include" });
            }
        }, name)
        .catch(() => { /* already gone / never created — fine */ });
}

test.describe("users CRUD", () => {
    const createdUsernames: string[] = [];

    test.afterEach(async ({ page }) => {
        // Safety net: if an assertion above threw mid-test, don't leave the
        // shared DB with orphan users for other specs to trip over.
        for (const username of createdUsernames.splice(0)) {
            await deleteUserByUsername(page, username);
        }
    });

    test("creates a user, enforces the admin gate for non-admins, and changes their role", async ({ authedPage: page, browser }) => {
        const username = uniqueName("e2e-user");
        const password = "e2e-test-pw-1234";
        createdUsernames.push(username);

        await page.goto("/settings/users");
        await settled(page);

        // ---- create ----
        await page.getByRole("button", { name: "Add User" }).click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole("heading", { name: "Add User" })).toBeVisible();

        // ---- validation: nothing submitted without a username/password ----
        await page.getByRole("button", { name: "Create", exact: true }).click();
        await expect(page.getByText("Please enter a username")).toBeVisible();
        await expect(dialog).toBeVisible();

        await page.getByLabel("Username", { exact: true }).fill(username);
        await page.getByRole("button", { name: "Create", exact: true }).click();
        await expect(page.getByText("Please enter a password")).toBeVisible();
        await expect(dialog).toBeVisible();

        await page.getByLabel("Password", { exact: true }).fill(password);
        await page.getByRole("button", { name: "Create", exact: true }).click();
        await expect(page.getByText("User created successfully")).toBeVisible();
        await expect(dialog).toBeHidden();

        await filterUsersByUsername(page, username);
        const row = userRow(page, username);
        await expect(row).toBeVisible();
        await expect(row.getByText("user", { exact: true })).toBeVisible();

        // ---- survives a reload (proves it persisted, not just cached) ----
        await page.reload();
        await settled(page);
        await filterUsersByUsername(page, username);
        await expect(userRow(page, username)).toBeVisible();

        // ---- admin gate: a non-admin can reach neither the page nor the API ----
        const guestContext = await browser.newContext();
        try {
            const guestPage = await guestContext.newPage();
            await loginAs(guestPage, username, password);
            await guestPage.goto("/settings/users");
            await expect(guestPage.getByRole("heading", { name: "Access Denied" })).toBeVisible();
            await expect(guestPage.getByRole("button", { name: "Add User" })).toHaveCount(0);

            const guestStatus = await guestPage.evaluate(async () => {
                const res = await fetch("/api/users", { credentials: "include" });
                return res.status;
            });
            expect(guestStatus).toBe(403);
        } finally {
            await guestContext.close();
        }

        // ---- change role to admin (clicking the row opens Edit directly) ----
        await userRow(page, username).click();
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole("heading", { name: `Edit user "${username}"` })).toBeVisible();
        await expect(page.getByLabel("Username", { exact: true })).toBeDisabled();

        await page.getByLabel("Role", { exact: true }).click();
        await page.getByRole("option", { name: "Admin", exact: true }).click();
        await expect(page.getByLabel("Role", { exact: true })).toHaveText(/Admin/);

        await page.getByRole("button", { name: "Save" }).click();
        await expect(page.getByText("User updated successfully")).toBeVisible();
        await expect(dialog).toBeHidden();

        await expect(userRow(page, username).getByText("admin", { exact: true })).toBeVisible();

        // ---- survives a reload ----
        await page.reload();
        await settled(page);
        await filterUsersByUsername(page, username);
        await expect(userRow(page, username).getByText("admin", { exact: true })).toBeVisible();

        // Deletion through the row menu has its own dedicated regression
        // test below; cleanup here is via the shared afterEach safety net.
    });

    // Empirically checks for a recurrence of the confirmed Radix Select
    // controlled-value bug (see models-crud.spec.ts, "the Add model dialog
    // pre-selects the provider it was opened from"). components/users/
    // user-form-dialog.tsx's Role <Select> follows the exact same shape:
    // `useState<"admin"|"user">("user")` as the mount-time default, then a
    // useEffect calls `setRole(user.role)` *after* the dialog has already
    // mounted with that default and before SelectContent has ever been
    // opened. Editing an existing ADMIN user is the one case where the
    // effect's value ("admin") actually differs from the default ("user"),
    // which is exactly the transition that triggers the bug for the
    // Provider select. This test documents the expected/correct behaviour.
    test("the Edit user dialog pre-selects an existing admin's role correctly", async ({ authedPage: page }) => {
        const username = uniqueName("e2e-user-roleprefill");
        createdUsernames.push(username);
        await createScratchUser(page, username, "e2e-test-pw-1234", "admin");

        await page.goto("/settings/users");
        await settled(page);
        await filterUsersByUsername(page, username);

        await userRow(page, username).click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole("heading", { name: `Edit user "${username}"` })).toBeVisible();

        // Correct behaviour: without touching the Role field, it should
        // already display this user's actual stored role ("admin"), not
        // silently reset to the form's default ("user").
        await expect(page.getByLabel("Role", { exact: true })).toHaveText(/Admin/);

        await page.getByRole("button", { name: "Cancel" }).click();
    });

    // REGRESSION TEST for a fixed bug: components/users/users-table.tsx
    // renders the whole <tr> with onClick={() => onRowClick?.(row.original)}
    // (line 204) so a click anywhere in the row opened the Edit dialog —
    // including inside the per-row actions <DropdownMenu>. That menu's
    // content is rendered through a Radix Portal (components/ui/
    // dropdown-menu.tsx), so in the real DOM the "Delete" item was not a
    // descendant of the <tr> at all — but React dispatches synthetic events
    // based on the *React* tree, not the DOM tree, and a portalled node is
    // still a React descendant of where it's rendered from. Clicking
    // "Delete" (users-table.tsx:151-152, onClick={() => onDelete(user)})
    // therefore also bubbled up and fired the row's onClick, calling
    // setEditingUser(user) at the same time as setDeletingUser(user)
    // (app/(dashboard)/settings/users/page.tsx). Both dialogs' `open`
    // conditions became true in the same render, and only the Edit
    // <Dialog> ended up visible — the delete <AlertDialog> never appeared,
    // leaving admins with no working way to delete a user through the UI.
    //
    // Fixed in components/ui/dropdown-menu.tsx by stopping propagation on
    // DropdownMenuContent's onClick, so menu item clicks never leak to an
    // ancestor's handler. This test guards against a regression.
    test("deleting a user from the row menu shows a confirmation dialog, not the edit dialog, and removes the user", async ({ authedPage: page }) => {
        const username = uniqueName("e2e-user-delete");
        createdUsernames.push(username);
        await createScratchUser(page, username, "e2e-test-pw-1234", "user");

        await page.goto("/settings/users");
        await settled(page);
        await filterUsersByUsername(page, username);

        const row = userRow(page, username);
        await expect(row).toBeVisible();
        await row.hover();
        await row.getByRole("button", { name: "Open menu" }).click();
        await page.getByRole("menuitem", { name: "Delete" }).click();

        // Correct behaviour: a confirmation prompt naming the user, not the
        // unrelated Edit dialog.
        const confirm = page.getByRole("alertdialog");
        await expect(confirm).toBeVisible();
        await expect(confirm.getByText(username)).toBeVisible();
        await expect(page.getByRole("dialog").filter({ hasText: "Edit user" })).toHaveCount(0);

        await confirm.getByRole("button", { name: "Delete" }).click();
        await expect(page.getByText("User deleted successfully")).toBeVisible();
        await expect(userRow(page, username)).toHaveCount(0);

        // ---- survives a reload (proves the delete actually persisted) ----
        await page.reload();
        await settled(page);
        await filterUsersByUsername(page, username);
        await expect(userRow(page, username)).toHaveCount(0);
    });
});

test.describe("API keys", () => {
    const createdKeyNames: string[] = [];

    test.afterEach(async ({ page }) => {
        for (const name of createdKeyNames.splice(0)) {
            await deleteApiKeyByName(page, name);
        }
    });

    test("creates an API key, reveals the plaintext exactly once, then revokes it", async ({ authedPage: page }) => {
        const keyName = uniqueName("e2e-key");
        createdKeyNames.push(keyName);

        await page.goto("/settings/api-keys");
        await settled(page);

        // ---- create ----
        await page.getByRole("button", { name: "Create key" }).click();
        const createDialog = page.getByRole("dialog").filter({ hasText: "New API Key" });
        await expect(createDialog).toBeVisible();

        await page.getByLabel("Name", { exact: true }).fill(keyName);
        await page.getByLabel("Expiration", { exact: true }).selectOption("30");

        await page.getByRole("button", { name: "Create", exact: true }).click();
        await expect(createDialog).toBeHidden();

        // ---- the plaintext is shown exactly once, right after creation ----
        const revealDialog = page.getByRole("dialog").filter({ hasText: `Key created: ${keyName}` });
        await expect(revealDialog).toBeVisible();
        const plaintext = (await revealDialog.locator("code").innerText()).trim();
        expect(plaintext.startsWith("sk-loom-")).toBe(true);
        expect(plaintext.length).toBeGreaterThan(20);

        await revealDialog.getByRole("button", { name: "Done" }).click();
        await expect(revealDialog).toBeHidden();

        // ---- never shown again anywhere on the page ----
        await expect(page.getByText(plaintext)).toHaveCount(0);

        const row = apiKeyRow(page, keyName);
        await expect(row).toBeVisible();
        await expect(row.getByText(plaintext)).toHaveCount(0);
        // Only a masked prefix is rendered in the list.
        await expect(row.getByText(/…/)).toBeVisible();
        // A 30-day expiry was chosen — it must not show "Never".
        await expect(row.getByText("Never")).toHaveCount(0);

        // ---- survives a reload; a refetch never re-exposes the raw key ----
        await page.reload();
        await settled(page);
        await expect(apiKeyRow(page, keyName)).toBeVisible();
        await expect(apiKeyRow(page, keyName).getByText("Never")).toHaveCount(0);

        const listBodyText = await page.evaluate(async () => {
            const res = await fetch("/api/apikeys", { credentials: "include" });
            return res.text();
        });
        expect(listBodyText.includes(plaintext)).toBe(false);

        // ---- revoke ----
        await apiKeyRow(page, keyName).getByRole("button").click();
        const confirm = page.getByRole("alertdialog");
        await expect(confirm).toBeVisible();
        await expect(confirm.getByText(keyName)).toBeVisible();
        await confirm.getByRole("button", { name: "Revoke" }).click();
        await expect(page.getByText("API key revoked")).toBeVisible();
        await expect(apiKeyRow(page, keyName)).toHaveCount(0);

        await page.reload();
        await settled(page);
        await expect(apiKeyRow(page, keyName)).toHaveCount(0);

        createdKeyNames.splice(createdKeyNames.indexOf(keyName), 1);
    });
});
