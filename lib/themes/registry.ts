import type { ThemeDescriptor } from "./types";

const registry = new Map<string, ThemeDescriptor>();
const insertionOrder: string[] = [];

export const DEFAULT_THEME_ID = "default";

export function registerTheme(theme: ThemeDescriptor): void {
    if (!registry.has(theme.id)) insertionOrder.push(theme.id);
    registry.set(theme.id, theme);
}

export function getTheme(id: string): ThemeDescriptor | undefined {
    return registry.get(id);
}

export function getAllThemes(): ThemeDescriptor[] {
    return insertionOrder.map((id) => registry.get(id)!).filter(Boolean);
}

export function resolveTheme(id: string | undefined | null): ThemeDescriptor {
    return (id && registry.get(id)) || registry.get(DEFAULT_THEME_ID)!;
}

/**
 * Compile every registered theme into a single CSS string suitable for an
 * inline <style> tag. Each preset emits selectors of the form:
 *   :root[data-theme="<id>"] { --token: value; }
 *   :root[data-theme="<id>"].dark { --token: value; }
 */
export function compileThemeStylesheet(): string {
    const blocks: string[] = [];
    for (const theme of getAllThemes()) {
        const light = formatBlock(theme.tokens.light);
        const dark = formatBlock(theme.tokens.dark);
        if (light) blocks.push(`:root[data-theme="${theme.id}"]{${light}}`);
        if (dark) blocks.push(`:root[data-theme="${theme.id}"].dark{${dark}}`);
    }
    return blocks.join("\n");
}

function formatBlock(tokens: Record<string, string>): string {
    return Object.entries(tokens)
        .map(([k, v]) => `--${k}:${v};`)
        .join("");
}
