import { registerTheme } from "../registry";

registerTheme({
    id: "terminal",
    label: "Terminal",
    description: "Phosphor-green on near-black, monospace everywhere.",
    flair: "cool",
    forceScheme: "dark",
    tokens: {
        light: {},
        dark: {
            background: "oklch(0.13 0.015 145)",
            foreground: "oklch(0.92 0.18 145)",
            card: "oklch(0.16 0.02 145)",
            "card-foreground": "oklch(0.92 0.18 145)",
            popover: "oklch(0.16 0.02 145)",
            "popover-foreground": "oklch(0.92 0.18 145)",
            primary: "oklch(0.85 0.20 145)",
            "primary-foreground": "oklch(0.13 0.015 145)",
            secondary: "oklch(0.22 0.04 145)",
            "secondary-foreground": "oklch(0.92 0.18 145)",
            muted: "oklch(0.22 0.04 145)",
            "muted-foreground": "oklch(0.65 0.12 145)",
            accent: "oklch(0.25 0.06 145)",
            "accent-foreground": "oklch(0.92 0.18 145)",
            destructive: "oklch(0.72 0.22 28)",
            border: "oklch(0.85 0.18 145 / 18%)",
            input: "oklch(0.85 0.18 145 / 14%)",
            ring: "oklch(0.85 0.18 145 / 50%)",
            radius: "0.25rem",
            "font-sans": "var(--font-geist-mono)",
        },
    },
    preview: {
        swatches: [
            "oklch(0.13 0.015 145)",
            "oklch(0.85 0.20 145)",
            "oklch(0.22 0.04 145)",
            "oklch(0.65 0.12 145)",
        ],
        glyph: "❯",
    },
});
