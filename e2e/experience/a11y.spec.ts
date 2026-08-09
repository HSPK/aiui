import AxeBuilder from "@axe-core/playwright";
import { test, expect, settled } from "../support/fixtures";
import { recordMetric } from "../perf/support/report";
import { composer } from "../perf/support/chat";

// Accessibility audit with axe-core.
//
// Nothing in the jsdom component suite can catch these: contrast, landmark
// structure, missing accessible names and focus-order problems only exist once
// something is actually laid out and painted. Serious/critical violations are
// treated as failures; minor/moderate ones are recorded so they're visible
// without blocking the build on a colour-token nit.

const PAGES = ["/playground/chat", "/logs", "/providers", "/mcp", "/settings", "/settings/users"] as const;

// Rules that fail the build. `color-contrast` is deliberately NOT here: the
// muted-foreground design token currently sits at ~3.2:1 against table
// headers and ~2.7:1 for placeholder text, below the 4.5:1 WCAG AA bar. That
// is a design-token decision for the maintainers, not something a test run
// should silently change — so contrast is tracked with a non-regressing
// baseline below instead of blocking.
const BLOCKING_RULES = new Set([
    "button-name", "link-name", "image-alt", "input-image-alt",
    "aria-required-attr", "aria-valid-attr-value", "aria-roles",
    "label", "form-field-multiple-labels", "duplicate-id-active",
    "frame-title", "html-has-lang", "valid-lang",
]);

// Known contrast debt per page, counted as DISTINCT violation signatures
// (rule + element class list) rather than raw node counts — a table with 200
// rows would otherwise report 200 "violations" for one bad token and the
// baseline would swing with test data. Tightening these is good; loosening
// them requires a deliberate edit, which is the point.
const CONTRAST_BASELINE: Record<string, number> = {
    "/playground/chat": 3,
    // Higher than an empty table reports: other specs seed log rows, and each
    // rendered cell style is its own signature. Headroom keeps the ratchet
    // meaningful without making it order-dependent.
    "/logs": 9,
    "/providers": 0,
    "/mcp": 2,
    "/settings": 1,
    "/settings/users": 4,
};

test.describe("accessibility", () => {
    for (const path of PAGES) {
        test(`${path} has no blocking axe violations`, async ({ authedPage: page }) => {
            await page.goto(path);
            await settled(page);

            const results = await new AxeBuilder({ page })
                .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
                // Radix renders portalled overlays outside the landmark tree;
                // the region rule fires on the portal root, not on our markup.
                .disableRules(["region"])
                .analyze();

            const blocking = results.violations.filter((v) => BLOCKING_RULES.has(v.id));
            const contrast = results.violations.filter((v) => v.id === "color-contrast");
            const contrastSignatures = new Set(
                contrast.flatMap((v) =>
                    v.nodes.map((n) => {
                        const cls = /class="([^"]*)"/.exec(n.html)?.[1] ?? n.target.join(" ");
                        return `${v.id}|${cls.split(/\s+/).slice(0, 6).join(" ")}`;
                    }),
                ),
            );
            const contrastNodes = contrastSignatures.size;
            const advisory = results.violations.filter((v) => !BLOCKING_RULES.has(v.id) && v.id !== "color-contrast");

            recordMetric({
                group: "a11y",
                name: path,
                values: {
                    blocking: blocking.length,
                    contrast_signatures: contrastNodes,
                    advisory: advisory.length,
                    rules_passed: results.passes.length,
                },
                notes: results.violations.map((v) => `${v.impact}:${v.id}`).join(", "),
            });

            const detail = blocking
                .map((v) => `${v.id} (${v.impact}) — ${v.help}\n    ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join("\n    ")}`)
                .join("\n  ");

            expect(blocking, `blocking a11y violations on ${path}:\n  ${detail}`).toEqual([]);

            // Ratchet: contrast debt may shrink, never grow.
            expect(
                contrastNodes,
                `${path} gained new colour-contrast violations (${contrastNodes} distinct vs baseline ${CONTRAST_BASELINE[path] ?? 0}):\n  ` +
                [...contrastSignatures].join("\n  ") + "\n" +
                `Fix the contrast or lower the baseline deliberately.`,
            ).toBeLessThanOrEqual(CONTRAST_BASELINE[path] ?? 0);
        });
    }

    // Empty pages hide controls. The conversation row's action menu, for one,
    // only exists once there is a conversation — and it was missing a name.
    test("every interactive control on a POPULATED chat page has an accessible name", async ({ authedPage: page }) => {
        await page.goto("/playground/chat");
        await settled(page);

        const input = composer(page);
        await expect(input).toBeVisible({ timeout: 20_000 });
        await input.fill("a11y seed tokens=5 delay=2");
        await input.press("Enter");
        await expect.poll(async () => (await page.locator("body").innerText()).includes("Streaming responsiveness"),
            { timeout: 20_000 }).toBe(true);
        await page.reload();
        await settled(page);

        const unnamed = await page.evaluate(() => {
            const bad: string[] = [];
            for (const el of Array.from(document.querySelectorAll("button, a[href], [role=button]"))) {
                const style = getComputedStyle(el);
                if (style.display === "none" || style.visibility === "hidden") continue;
                const name =
                    el.getAttribute("aria-label") ||
                    el.getAttribute("title") ||
                    (el.getAttribute("aria-labelledby") ? "labelled" : "") ||
                    (el.textContent ?? "").trim();
                if (!name) bad.push(el.outerHTML.slice(0, 120));
            }
            return bad;
        });

        expect(unnamed, `controls with no accessible name:\n${unnamed.join("\n")}`).toEqual([]);
    });
});
