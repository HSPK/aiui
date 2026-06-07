// Public entry point. Importing this guarantees the registry is populated
// before any consumer asks for themes.
import "./register";

export {
    DEFAULT_THEME_ID,
    compileThemeStylesheet,
    getAllThemes,
    getTheme,
    resolveTheme,
} from "./registry";
export {
    THEME_BOOTSTRAP_SCRIPT,
    THEME_STORAGE_KEY,
    readStoredTheme,
    writeStoredTheme,
} from "./storage";
export type { StoredTheme, StoredThemeScheme } from "./storage";
export type { ThemeDescriptor, ThemeFlair, ThemePreview, ThemeTokens } from "./types";
