/**
 * Theme registry shape. Each preset is a self-contained descriptor;
 * adding a new theme = a new file under presets/ that calls registerTheme().
 *
 * Tokens are CSS variable names (without the `--` prefix) mapped to values.
 * Anything not overridden inherits from app/globals.css :root / .dark.
 */

export type ThemeFlair = "minimal" | "cool";

export interface ThemePreview {
    /** 4 hex/oklch swatches used by the picker tile. */
    swatches: [string, string, string, string];
    /** Optional emoji or short glyph shown on the tile. */
    glyph?: string;
}

export interface ThemeTokens {
    light: Record<string, string>;
    dark: Record<string, string>;
}

export interface ThemeDescriptor {
    id: string;
    label: string;
    description: string;
    flair: ThemeFlair;
    /** When set, the theme forces this color scheme regardless of next-themes. */
    forceScheme?: "light" | "dark";
    tokens: ThemeTokens;
    preview: ThemePreview;
}
