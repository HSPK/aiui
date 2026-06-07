import { registerTheme } from "../registry";

registerTheme({
    id: "default",
    label: "Default",
    description: "Clean monochrome — the original aiui surface.",
    flair: "minimal",
    tokens: { light: {}, dark: {} },
    preview: {
        swatches: [
            "oklch(1 0 0)",
            "oklch(0.205 0 0)",
            "oklch(0.97 0 0)",
            "oklch(0.708 0 0)",
        ],
        glyph: "·",
    },
});
